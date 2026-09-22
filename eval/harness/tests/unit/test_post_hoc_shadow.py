"""Positive controls for the three post-hoc shadow checks on their LIVE path.

Phase 5's requirement was that before any detector graduates, each needs a
synthetic fixture that makes it fire — offline and free, no live run. Of the
three it named (citation-nulling, conflict-unpersisted, warnings-unchecked — NOT
the three this file now drives, which is a different set), two turned out not to
need one: warnings-unchecked has fired live and stored
(`stribling-father-1821/run-2026-08-17_23-35-44`), and conflict-unpersisted
replays to four real corpus fires. **citation-nulling has never fired anywhere**,
so its zero was the one that stayed ambiguous, and this file is the control that
resolves it. The agreement arm arrived later and is in the same position: it has
never fired on the corpus, so its controls here are the only thing that
distinguishes a silent detector from a working one.

What these cover that nothing else does: `collect_post_hoc_shadow` is the
orchestrator's own call site, reading a real workspace off disk with
`read_research_json` and `read_tree_json`. The predicate tests in
`test_skill_invocation.py` hand the detectors a dict directly, and the replay
tests in `test_guardrail_shadow_report.py` read committed sidecars — neither
touches this path. It is the path where a broken workspace read is
indistinguishable from a clean project, because both readers return None on a
missing or unparseable file and every detector here returns `[]` on None. The
agreement check reads BOTH documents, so it carries that ambiguity twice.
"""

from __future__ import annotations

import json

from e2e.orchestrator import collect_post_hoc_shadow
from harness.skill_invocation import (
    CITATION_NULLING_KIND,
    CONFLICT_UNPERSISTED_KIND,
    TREE_FACT_ASSERTION_KIND,
)

# The corrected reading and the stale one from the run that produced issue #2472.
CORRECTED_PLACE = "Odessa, Francis No. 127, Saskatchewan, Canada"
STALE_PLACE = "Wellburn, Thames Centre, Middlesex, Ontario, Canada"


def _assertion(**overrides):
    """The corrected assertion a materialized fact is checked against."""
    base = {
        "id": "a_011",
        "source_id": "src_001",
        "fact_type": "immigration",
        "place": CORRECTED_PLACE,
        "standard_place": CORRECTED_PLACE,
        "date": "1924",
    }
    base.update(overrides)
    return base


def _materialized_research(**overrides):
    return {"assertions": [_assertion(**overrides)]}


def _backlinked_tree(**fact_overrides):
    """A tree whose single person fact is backlinked to `a_011` and, by default,
    agrees with it. Each disagreement test overrides exactly one attribute."""
    fact = {
        "id": "F4",
        "type": "Immigration",
        "assertion_id": "a_011",
        "sources": [{"ref": "S1"}],
        "place": CORRECTED_PLACE,
        "standard_place": CORRECTED_PLACE,
        "date": "1924",
    }
    fact.update(fact_overrides)
    return {
        "persons": [{"id": "I1", "facts": [fact]}],
        "relationships": [],
        "sources": [{"id": "S1", "title": "Border crossing manifest"}],
    }


def _workspace(tmp_path, research, tree=None):
    """A project directory shaped the way the orchestrator reads it.

    The tree is always written, because a workspace with no `tree.gedcomx.json`
    makes the agreement arm answer `[]` for want of a document, and a positive
    control built on such a workspace would pass without exercising anything.

    The default tree AGREES with `_assertion()` — it is present and scanned, and
    silent. It must stay that way: `test_both_checks_fire_together_and_are_told_apart_by_kind`
    asserts set equality over the kinds and `test_emit_is_called_once_per_firing_check`
    asserts exactly two emits, so a firing default would red both.
    `test_the_default_tree_is_read_not_merely_written` is what proves the default
    is a document this check actually reaches.
    """
    (tmp_path / "research.json").write_text(json.dumps(research), encoding="utf-8")
    (tmp_path / "tree.gedcomx.json").write_text(
        json.dumps(_backlinked_tree() if tree is None else tree), encoding="utf-8"
    )
    return tmp_path


def _concluded_with_citation(citation):
    """A written conclusion whose supporting assertion reaches one source."""
    return {
        "proof_summaries": [
            {"id": "ps_001", "question_id": "q_001", "supporting_assertion_ids": ["a_001"]}
        ],
        "assertions": [{"id": "a_001", "source_id": "src_001", "fact_type": "birth"}],
        "sources": [{"id": "src_001", "citation": citation}],
    }


def _concluded_claiming_a_resolution(conflicts):
    return {
        "proof_summaries": [
            {"id": "ps_001", "question_id": "q_001", "resolved_conflict_ids": []}
        ],
        "questions": [
            {
                "id": "q_001",
                "exhaustive_declaration": {
                    "stop_criteria": {
                        "conflict_resolution": "Birth-year conflict resolved -- census age estimated."
                    }
                },
            }
        ],
        "conflicts": conflicts,
    }


def test_citation_nulling_fires_on_the_live_path(tmp_path):
    """THE control Phase 5 asked for. A hand-built research.json on disk, read
    the way a real run reads it, producing a stored shadow entry."""
    ws = _workspace(tmp_path, _concluded_with_citation(""))
    out = collect_post_hoc_shadow(ws)
    assert len(out) == 1
    assert out[0]["kind"] == CITATION_NULLING_KIND
    assert out[0]["question_id"] == "q_001"
    assert "src_001" in out[0]["detail"]


def test_citation_nulling_silent_when_the_citation_is_present(tmp_path):
    ws = _workspace(
        tmp_path,
        _concluded_with_citation("1850 U.S. Census, Schuylkill Co., Pa., dwelling 84."),
    )
    assert collect_post_hoc_shadow(ws) == []


def test_conflict_unpersisted_fires_on_the_live_path(tmp_path):
    ws = _workspace(tmp_path, _concluded_claiming_a_resolution([]))
    out = collect_post_hoc_shadow(ws)
    assert len(out) == 1
    assert out[0]["kind"] == CONFLICT_UNPERSISTED_KIND


def test_conflict_unpersisted_silent_when_a_resolved_conflict_backs_it(tmp_path):
    ws = _workspace(
        tmp_path,
        _concluded_claiming_a_resolution(
            [{"id": "c_001", "status": "resolved", "blocks_question_ids": ["q_001"]}]
        ),
    )
    assert collect_post_hoc_shadow(ws) == []


def test_both_checks_fire_together_and_are_told_apart_by_kind(tmp_path):
    """They share one field, so a bucket that mixed them would misreport both."""
    research = {**_concluded_with_citation(""), **_concluded_claiming_a_resolution([])}
    research["proof_summaries"] = [
        {
            "id": "ps_001",
            "question_id": "q_001",
            "supporting_assertion_ids": ["a_001"],
            "resolved_conflict_ids": [],
        }
    ]
    out = collect_post_hoc_shadow(_workspace(tmp_path, research))
    assert {v["kind"] for v in out} == {CITATION_NULLING_KIND, CONFLICT_UNPERSISTED_KIND}


def test_a_missing_workspace_is_silent_rather_than_raising(tmp_path):
    """No research.json at all — an honest run that stopped early. It must not
    raise, and must not fire."""
    assert collect_post_hoc_shadow(tmp_path) == []


def test_an_unreadable_research_json_does_not_masquerade_as_clean(tmp_path):
    """The ambiguity this path carries, pinned so it is at least visible.

    `read_research_json` returns None on unparseable JSON and every detector here
    returns [] on None, so a corrupt workspace looks exactly like a clean project.
    This test does not fix that — it records it, so a future reader who expects a
    corrupt file to be reported finds the behaviour asserted rather than assumed.
    """
    (tmp_path / "research.json").write_text("{ not json", encoding="utf-8")
    assert collect_post_hoc_shadow(tmp_path) == []


def test_emit_is_called_once_per_firing_check(tmp_path):
    seen: list[str] = []
    research = {**_concluded_with_citation(""), **_concluded_claiming_a_resolution([])}
    research["proof_summaries"] = [
        {
            "id": "ps_001",
            "question_id": "q_001",
            "supporting_assertion_ids": ["a_001"],
            "resolved_conflict_ids": [],
        }
    ]
    collect_post_hoc_shadow(_workspace(tmp_path, research), emit=seen.append)
    assert len(seen) == 2
    assert any("citation" in m for m in seen)
    assert any("conflict" in m for m in seen)


def test_emit_is_optional(tmp_path):
    """The orchestrator always passes one; a test or a future caller need not."""
    assert collect_post_hoc_shadow(_workspace(tmp_path, _concluded_with_citation(""))) != []


# ── tree-fact/assertion agreement on the live path (issues #2472, #2558) ─────
# The predicate is the one `test_universal.py` asserts on; these drive it through
# `collect_post_hoc_shadow`, which is the only place the two documents are read
# off a real workspace. Both directions, because in shadow mode this check never
# fails a run: an over-firing predicate would surface only as a number somebody
# later quotes, so the accept cases are the half nothing else can catch.


def test_a_stale_place_on_a_backlinked_fact_fires_on_the_live_path(tmp_path):
    """The reported shape: the assertion was corrected, the fact was not."""
    ws = _workspace(
        tmp_path, _materialized_research(), tree=_backlinked_tree(place=STALE_PLACE)
    )
    out = collect_post_hoc_shadow(ws)
    assert len(out) == 1
    assert out[0]["kind"] == TREE_FACT_ASSERTION_KIND
    assert out[0]["field"] == "place"
    assert out[0]["fact_id"] == "F4"
    assert out[0]["assertion_id"] == "a_011"
    assert STALE_PLACE in out[0]["detail"] and CORRECTED_PLACE in out[0]["detail"]


def test_a_stale_standard_place_alone_fires(tmp_path):
    """The place-AUTHORITY half, which a display-string-only check would miss:
    `place` reads corrected while `standard_place` still names the old province."""
    ws = _workspace(
        tmp_path,
        _materialized_research(),
        tree=_backlinked_tree(standard_place="Thames Centre Township, Middlesex, Ontario, Canada"),
    )
    out = collect_post_hoc_shadow(ws)
    assert [v["field"] for v in out] == ["standard_place"]


def test_a_stale_date_fires(tmp_path):
    ws = _workspace(
        tmp_path, _materialized_research(), tree=_backlinked_tree(date="1925")
    )
    out = collect_post_hoc_shadow(ws)
    assert [v["field"] for v in out] == ["date"]


def test_the_default_tree_is_read_not_merely_written(tmp_path):
    """Non-vacuity control for every accept case below.

    They all pass `_workspace`'s default tree or a one-attribute variant of it,
    and a silent result would look identical whether the check exempted the shape
    or never saw the document at all. Diverging the ASSERTION from that same
    default tree fires, which can only happen if the default tree was written,
    parsed and reached the predicate.
    """
    ws = _workspace(tmp_path, _materialized_research(place=STALE_PLACE))
    assert [v["field"] for v in collect_post_hoc_shadow(ws)] == ["place"]


def test_a_whitespace_only_value_is_absent_not_disagreeing(tmp_path):
    """Skipped on either side: a fact carrying "   " asserts nothing about the
    assertion's value. Not a failure shape — pinned here because the issue that
    scoped this work proposed it as one."""
    # Two workspaces: one document per directory, so neither side's result can
    # be read off the other's.
    for side in ("a", "b"):
        (tmp_path / side).mkdir(parents=True, exist_ok=True)
    fact_side = _workspace(
        tmp_path / "a", _materialized_research(), tree=_backlinked_tree(place="   ")
    )
    assertion_side = _workspace(tmp_path / "b", _materialized_research(place="   "))
    assert collect_post_hoc_shadow(fact_side) == []
    assert collect_post_hoc_shadow(assertion_side) == []


def test_a_two_ref_fact_holding_another_assertions_value_is_accepted(tmp_path):
    """materialize_facts corroborates a second source onto the fact, filling an
    attribute from a DIFFERENT assertion, and research_append's rewrite then
    refuses to overwrite it. Firing here would be red forever on correct work."""
    ws = _workspace(
        tmp_path,
        _materialized_research(),
        tree=_backlinked_tree(place=STALE_PLACE, sources=[{"ref": "S1"}, {"ref": "S2"}]),
    )
    assert collect_post_hoc_shadow(ws) == []


def test_a_fact_whose_type_no_longer_matches_its_assertion_is_accepted(tmp_path):
    """The rewrite refuses such a fact because the two no longer describe the same
    thing, so firing here would report that refusal as drift."""
    ws = _workspace(
        tmp_path,
        _materialized_research(),
        tree=_backlinked_tree(type="Residence", place=STALE_PLACE),
    )
    assert collect_post_hoc_shadow(ws) == []


def test_an_unbacklinked_fact_is_accepted_however_stale(tmp_path):
    """Every fact in every project written before the backlink existed."""
    tree = _backlinked_tree(place=STALE_PLACE)
    del tree["persons"][0]["facts"][0]["assertion_id"]
    assert collect_post_hoc_shadow(_workspace(tmp_path, _materialized_research(), tree=tree)) == []


def test_a_missing_tree_is_silent_rather_than_raising(tmp_path):
    """An honest run that wrote research.json and never a tree. The arm must not
    raise, and must not fire."""
    (tmp_path / "research.json").write_text(json.dumps(_materialized_research()), encoding="utf-8")
    assert collect_post_hoc_shadow(tmp_path) == []


def test_an_unreadable_tree_does_not_masquerade_as_agreement(tmp_path):
    """Recorded, not fixed, exactly as its research.json twin above: a corrupt
    tree reads as a clean project, because `read_tree_json` answers None and the
    predicate answers [] on None."""
    (tmp_path / "research.json").write_text(json.dumps(_materialized_research()), encoding="utf-8")
    (tmp_path / "tree.gedcomx.json").write_text("{ not json", encoding="utf-8")
    assert collect_post_hoc_shadow(tmp_path) == []


def test_the_agreement_arm_emits_once_when_it_fires(tmp_path):
    seen: list[str] = []
    ws = _workspace(
        tmp_path, _materialized_research(), tree=_backlinked_tree(place=STALE_PLACE)
    )
    collect_post_hoc_shadow(ws, emit=seen.append)
    assert len(seen) == 1
    assert "disagree" in seen[0]


# ── the arm must never raise on the paid path ────────────────────────────────
# `collect_post_hoc_shadow` runs inside `_run_agent`, so an exception here aborts
# the run before any result file is written: the run is paid for and then thrown
# away. The two sibling detectors already wired at this site tolerate every shape
# below, and the docstrings on both sides of this one PROMISE that it does. A
# promise in prose is not a guard, which is what these pin.


def test_a_malformed_tree_does_not_raise_on_the_live_path(tmp_path):
    """Each shape is a document a `for x in y or []` reader iterates straight
    into a TypeError: the truthy non-list survives `or []`."""
    shapes = {
        "persons is not a list": {"persons": 9},
        "relationships is not a list": {"relationships": 9},
        "facts is not a list": {"persons": [{"id": "I1", "facts": 9}]},
        "a fact is not a dict": {"persons": [{"id": "I1", "facts": ["nope"]}]},
        "the tree is a JSON array": [],
    }
    for label, tree in shapes.items():
        ws = tmp_path / label.replace(" ", "_")
        ws.mkdir(parents=True, exist_ok=True)
        assert collect_post_hoc_shadow(_workspace(ws, _materialized_research(), tree=tree)) == [], label


def test_a_malformed_research_does_not_raise_on_the_live_path(tmp_path):
    """`assertions` holding a non-list, and an assertion whose `id` is unhashable
    — a bare dict comprehension keyed on `a.get("id")` raises TypeError on the
    second."""
    shapes = {
        "assertions is not a list": {"assertions": 9},
        "assertions is a mapping": {"assertions": {"a_011": {}}},
        "an assertion id is a list": {"assertions": [{"id": ["a_011"], "place": CORRECTED_PLACE}]},
        "an assertion is not a dict": {"assertions": ["nope"]},
    }
    for label, research in shapes.items():
        ws = tmp_path / label.replace(" ", "_")
        ws.mkdir(parents=True, exist_ok=True)
        assert collect_post_hoc_shadow(
            _workspace(ws, research, tree=_backlinked_tree(place=STALE_PLACE))
        ) == [], label


def test_a_tree_in_cp1252_is_silent_rather_than_raising(tmp_path):
    """The `encoding="utf-8"` class, on the read side. A tree holding a smart
    quote or an em dash written by a Windows tool decodes as invalid UTF-8;
    before `read_tree_json` caught `UnicodeDecodeError` that propagated out of
    `collect_post_hoc_shadow` and aborted the run. The sibling reader for
    research.json has always caught it.

    Written as bytes, not via `write_text`, because the point is a file this
    process would not have produced.
    """
    (tmp_path / "research.json").write_text(
        json.dumps(_materialized_research()), encoding="utf-8"
    )
    (tmp_path / "tree.gedcomx.json").write_bytes(
        json.dumps(_backlinked_tree(place="Odéssa"), ensure_ascii=False).encode("cp1252")
    )
    assert collect_post_hoc_shadow(tmp_path) == []
