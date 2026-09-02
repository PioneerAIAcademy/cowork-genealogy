"""Regression tests for the judge before-state summary.

`_summarize_before_state` exists so the judge can mechanically check
"references an id that isn't on file" / "fabricated a source" claims. That
check is only sound if the block shows *every* source id that was on file.

The generic `_summarize_response` samples any list longer than
`_RESPONSE_ARRAY_SAMPLE` (=3) down to its first three entries. Feeding the
before-state `sources` array through it unmodified silently dropped the 4th+
source, so the judge (and human annotators reading the same block) flagged a
correctly-cited later source — `src_004` / `S4` — as fabricated and failed
base Correctness. That was the root cause of flaky ut_validate_schema_007 /
ut_validate_schema_008. These tests pin the fix: the full id list must survive
regardless of how many sources exist.
"""

import json

from harness.judge import _RESPONSE_ARRAY_SAMPLE
from harness.orchestrator import (
    _summarize_before_state,
    _summarize_before_state_conflicts,
    _summarize_before_state_sources,
)


def _sources(prefix: str, n: int) -> list[dict]:
    # Give each source a long field so the per-string cap could plausibly bite;
    # the ids must survive regardless.
    return [
        {"id": f"{prefix}{i:03d}", "citation": "x" * 100, "notes": "y" * 100}
        for i in range(1, n + 1)
    ]


def test_all_ids_survive_beyond_array_sample():
    n = _RESPONSE_ARRAY_SAMPLE + 1  # the boundary that used to drop the last id
    summary = _summarize_before_state_sources(_sources("src_", n))
    assert summary["count"] == n
    assert summary["all_ids"] == [f"src_{i:03d}" for i in range(1, n + 1)]
    # The last id — the one the array-sampler dropped — is present.
    assert f"src_{n:03d}" in summary["all_ids"]


def test_full_id_list_present_for_large_project():
    summary = _summarize_before_state_sources(_sources("src_", 25))
    assert summary["count"] == 25
    assert len(summary["all_ids"]) == 25


def test_before_state_block_shows_fourth_source_id():
    # The exact ut_validate_schema_007/008 shape: research.json has 4 src_ ids,
    # tree.gedcomx.json has 4 S ids. The 4th of each must be visible to the
    # judge or it will call a correct citation a fabrication.
    before = {
        "research_json": {"sources": _sources("src_", 4)},
        "tree_gedcomx_json": {"sources": _sources("S", 4)},
    }
    rendered = _summarize_before_state(before)
    assert "src_004" in rendered
    assert "S004" in rendered


def test_detail_includes_every_source_not_just_the_first_three():
    """The id list alone is not enough — the judge needs each source's *content*.

    Second half of the same bug. After a37a7fe4 the judge could see `src_006` in
    `all_ids`, look for its citation in the detail sample, find nothing (the
    sampler had kept only the first three), and call a correctly-cited source
    fabricated. Verbatim from a real run against `mid-research-flynn`, whose 9
    sources include the genuine `src_006`:

        "The before-state shows only 9 sources (src_001 through src_009), and
         the sample detail provided does not include src_006. The skill
         fabricates the existence and ARK URL of this source"

    So the detail must carry one entry per source, in order, with its citation.
    """
    n = 9  # mid-research-flynn's source count; src_006 is the one that was lost
    summary = _summarize_before_state_sources(
        [
            {"id": f"src_{i:03d}", "citation": f"citation for source {i}"}
            for i in range(1, n + 1)
        ]
    )
    assert isinstance(summary["detail"], list), (
        "detail must be a plain list of sources, not the sampler's "
        "{_summary_truncated, _first_n} envelope"
    )
    assert len(summary["detail"]) == n
    assert summary["detail"][5]["citation"] == "citation for source 6"

    # And end to end: the rendered block a judge actually reads.
    rendered = _summarize_before_state({"research_json": {"sources": [
        {"id": f"src_{i:03d}", "citation": f"citation for source {i}"}
        for i in range(1, n + 1)
    ]}})
    assert "citation for source 6" in rendered
    assert "citation for source 9" in rendered


def test_short_lists_still_complete():
    summary = _summarize_before_state_sources(_sources("src_", 2))
    assert summary["count"] == 2
    assert summary["all_ids"] == ["src_001", "src_002"]


def test_non_list_and_empty_are_safe():
    assert _summarize_before_state_sources([]) == {
        "count": 0,
        "all_ids": [],
        "detail": [],
    }
    # Defensive: a malformed (non-list) sources value must not raise, and every
    # field must agree — count/all_ids/detail all derive from the type-guarded
    # `items`, so a non-list yields an internally consistent empty block (not
    # count:0 with a populated detail).
    weird = _summarize_before_state_sources({"unexpected": "shape"})
    assert weird == {"count": 0, "all_ids": [], "detail": []}


def test_sources_without_ids_are_counted_not_listed():
    summary = _summarize_before_state_sources([{"citation": "no id here"}])
    assert summary["count"] == 1
    assert summary["all_ids"] == []


def test_none_before_state_returns_none_sentinel():
    assert _summarize_before_state(None) == "(none)"
    assert _summarize_before_state({}) == "(none)"


def test_ids_render_before_detail():
    before = {"research_json": {"sources": _sources("src_", 4)}}
    rendered = _summarize_before_state(before)
    # The complete id list must come before the (clippable) heavy detail.
    assert rendered.index("all_ids") < rendered.index("per-entry detail")


def test_over_budget_drops_whole_sources_and_names_them(monkeypatch):
    """Over budget, cut whole sources off the tail — never mid-object.

    A raw `detail_section[:budget]` slice leaves the last source half-rendered
    and the rest gone without trace, while their ids stay listed above complete.
    That is the fabrication misgrade all over again, just relocated to large
    projects. So the dropped ids must be named, and the note must tell the judge
    the absence is a size limit rather than evidence of absence.
    """
    from harness import orchestrator

    monkeypatch.setattr(orchestrator, "_BEFORE_STATE_MAX_CHARS", 900)
    rendered = orchestrator._summarize_before_state(
        {"research_json": {"sources": _sources("src_", 12)}}
    )

    # Every id still present and complete — the non-negotiable part.
    for i in range(1, 13):
        assert f"src_{i:03d}" in rendered

    assert "per-entry detail omitted for prompt size" in rendered
    assert "not evidence that they are missing or fabricated" in rendered

    # The detail that survived is parseable JSON, i.e. no mid-object slice.
    body = rendered.split("per-entry detail (heavy fields truncated):\n", 1)[1]
    body = body.split("\n\n[per-entry detail omitted", 1)[0]
    kept = json.loads(body)
    assert isinstance(kept, list)
    assert len(kept) < 12, "nothing was dropped; the budget did not bite"
    assert all(set(e) == {"id", "citation", "notes"} for e in kept), (
        "a surviving source is truncated mid-object"
    )


def test_all_ids_survive_when_detail_blows_the_prompt_budget(monkeypatch):
    # The prompt-size cap must trim the heavy detail, never the ids — otherwise
    # a late source id gets stranded and the fabrication misgrade returns. Shrink
    # the cap so the detail section overruns it while the ids stay complete.
    from harness import orchestrator

    monkeypatch.setattr(orchestrator, "_BEFORE_STATE_MAX_CHARS", 200)
    before = {
        "research_json": {"sources": _sources("src_", 10)},
        "tree_gedcomx_json": {"sources": _sources("S", 10)},
    }
    rendered = orchestrator._summarize_before_state(before)
    for i in range(1, 11):
        assert f"src_{i:03d}" in rendered
        assert f"S{i:03d}" in rendered
    assert "per-entry detail omitted for prompt size" in rendered
    assert "not evidence that they are missing or fabricated" in rendered


# --- conflicts[] rendering (#1902 / #1956) -------------------------------------
#
# Before this fix, the judge saw only `sources` in the before-state block. A
# skill could write "no conflicts on file, so encoding X is safe" while a
# resolved conflict on file said the opposite, and the judge — grading against a
# rubric that says "check conflicts[]" — could only repeat the skill's own
# testimony back to itself, because conflicts[] never reached the prompt. These
# tests pin that the conflicts and, critically, the *values* their preferred /
# competing assertions carry are rendered, since the judge compares a URL
# parameter (a place name) against a value, never against an assertion id.

_FLYNN_CONFLICT = {
    "id": "c_001",
    "conflict_type": "fact",
    "status": "resolved",
    "disputed_attribute": "birthplace",
    "identity_question": None,
    "competing_assertion_ids": ["a_002", "a_009"],
    "preferred_assertion_id": "a_002",
    "weighing_analysis": "w" * 100,
    "resolution_rationale": "r" * 100,
}
_FLYNN_ASSERTIONS = [
    {
        "id": "a_002",
        "fact_type": "birth",
        "value": "age 5",
        "structured_value": {"year": 1845, "place": "Ireland"},
        "place": "Ireland",
        "date": "~1845",
    },
    {
        "id": "a_009",
        "fact_type": "birth",
        "value": "born Pennsylvania",
        "structured_value": {"year": 1845, "place": "Pennsylvania"},
        "place": "Pennsylvania",
        "date": "1845",
    },
]


def test_conflicts_summary_resolves_assertion_values():
    summary = _summarize_before_state_conflicts([_FLYNN_CONFLICT], _FLYNN_ASSERTIONS)
    assert summary["count"] == 1
    assert summary["all_ids"] == ["c_001"]
    entry = summary["detail"][0]
    assert entry["status"] == "resolved"
    assert entry["disputed_attribute"] == "birthplace"
    # The preferred assertion resolves to its VALUE, not just its id.
    assert entry["preferred"]["place"] == "Ireland"
    # Every competing assertion resolves too — both candidate places are present.
    competing_places = {c.get("place") for c in entry["competing"]}
    assert competing_places == {"Ireland", "Pennsylvania"}


def test_before_state_renders_conflict_values_end_to_end():
    """The exact mid-research-flynn shape: the judge must see c_001 AND both
    candidate places, or it cannot check a 'no conflict on file' claim (#1956).
    Fails on main — conflicts[] never reached the before-state block."""
    before = {
        "research_json": {
            "sources": _sources("src_", 2),  # sources present regardless
            "conflicts": [_FLYNN_CONFLICT],
            "assertions": _FLYNN_ASSERTIONS,
        }
    }
    rendered = _summarize_before_state(before)
    assert "c_001" in rendered
    assert "Ireland" in rendered
    assert "Pennsylvania" in rendered


def test_conflicts_render_even_without_sources():
    """A project can carry conflicts but no sources. The old emptiness guard
    (`if not labelled: return "(none)"`) fired before conflicts were considered,
    so this would have returned the sentinel and hidden the conflict."""
    before = {"research_json": {"conflicts": [_FLYNN_CONFLICT], "assertions": _FLYNN_ASSERTIONS}}
    rendered = _summarize_before_state(before)
    assert rendered != "(none)"
    assert "c_001" in rendered
    assert "Ireland" in rendered


def test_conflict_dangling_assertion_ref_does_not_crash():
    conflict = {
        "id": "c_099",
        "conflict_type": "fact",
        "status": "unresolved",
        "preferred_assertion_id": "a_missing",
        "competing_assertion_ids": ["a_missing", "a_002"],
    }
    summary = _summarize_before_state_conflicts([conflict], _FLYNN_ASSERTIONS)
    entry = summary["detail"][0]
    assert entry["preferred"] == {"id": "a_missing", "_unresolved": True}
    # The resolvable competing id still resolves alongside the dangling one.
    assert {"id": "a_missing", "_unresolved": True} in entry["competing"]
    assert any(c.get("place") == "Ireland" for c in entry["competing"])


def test_identity_conflict_null_disputed_attribute_is_safe():
    # Identity conflicts carry disputed_attribute:null and identity_question set.
    # Rendering must not crash; #1933 owns the rule refinement, not this fix.
    conflict = {
        "id": "c_050",
        "conflict_type": "identity",
        "status": "moot",
        "disputed_attribute": None,
        "identity_question": "Are these two Patrick Flynns the same person?",
        "competing_assertion_ids": ["a_002"],
        "preferred_assertion_id": None,
    }
    summary = _summarize_before_state_conflicts([conflict], _FLYNN_ASSERTIONS)
    entry = summary["detail"][0]
    assert entry["identity_question"].startswith("Are these")
    assert entry["preferred"] is None
    assert entry["competing"][0]["place"] == "Ireland"


def test_conflicts_non_list_and_empty_are_safe():
    assert _summarize_before_state_conflicts([], []) == {
        "count": 0,
        "all_ids": [],
        "detail": [],
    }
    assert _summarize_before_state_conflicts(None, None) == {
        "count": 0,
        "all_ids": [],
        "detail": [],
    }


def test_conflict_values_win_the_budget_over_source_detail(monkeypatch):
    """Conflicts are rendered before the source blocks, so under budget pressure
    their resolved values survive while source *detail* (not ids) yields first.

    This pins the ordering: the resolved conflict value is the grounding evidence
    a 'no conflict on file' claim turns on, so it must not be the first thing a
    tight prompt-size budget drops. One heavy source and a light conflict, with a
    budget that holds the small conflict detail but not the fat source citation —
    so if the ordering ever flips, the conflict value is what disappears."""
    from harness import orchestrator

    light_conflict = {
        "id": "c_001",
        "conflict_type": "fact",
        "status": "resolved",
        "disputed_attribute": "birthplace",
        "preferred_assertion_id": "a_002",
        "competing_assertion_ids": ["a_002", "a_009"],
    }
    # Source detail (~0.9KB) and conflict detail (~1.1KB) each fit the budget
    # alone, but not together — so whichever is rendered first consumes the
    # budget and the other's detail is dropped. That is what makes this test
    # discriminate the ordering rather than just drop an oversized source.
    heavy_source = [{"id": "src_001", "citation": "x" * 600, "notes": "y" * 200}]
    monkeypatch.setattr(orchestrator, "_BEFORE_STATE_MAX_CHARS", 1620)
    before = {
        "research_json": {
            "sources": heavy_source,
            "conflicts": [light_conflict],
            "assertions": _FLYNN_ASSERTIONS,
        }
    }
    rendered = orchestrator._summarize_before_state(before)
    # The conflict's resolved values survive the squeeze...
    assert "Ireland" in rendered
    assert "Pennsylvania" in rendered
    # ...while the fat source detail is what yields (its id stays complete above).
    assert "detail omitted for prompt size: src_001" in rendered
    assert "src_001" in rendered  # id still present in the never-clipped id list
