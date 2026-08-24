"""Positive controls for the two post-hoc shadow checks on their LIVE path.

Phase 5's requirement was that before any of these graduates, each needs a
synthetic fixture that makes it fire — offline and free, no live run. Two of the
three turned out not to need one: warnings-unchecked has fired live and stored
(`stribling-father-1821/run-2026-08-17_23-35-44`), and conflict-unpersisted
replays to four real corpus fires. **citation-nulling has never fired anywhere**,
so its zero was the one that stayed ambiguous, and this file is the control that
resolves it.

What these cover that nothing else does: `collect_post_hoc_shadow` is the
orchestrator's own call site, reading a real workspace off disk with
`read_research_json`. The predicate tests in `test_skill_invocation.py` hand the
detector a dict directly, and the replay tests in
`test_guardrail_shadow_report.py` read committed sidecars — neither touches this
path. It is the path where a broken workspace read is indistinguishable from a
clean project, because `read_research_json` returns None on a missing or
unparseable file and both detectors return `[]` on None.
"""

from __future__ import annotations

import json

from e2e.orchestrator import collect_post_hoc_shadow
from harness.skill_invocation import CITATION_NULLING_KIND, CONFLICT_UNPERSISTED_KIND


def _workspace(tmp_path, research):
    """A project directory shaped the way the orchestrator reads it."""
    (tmp_path / "research.json").write_text(json.dumps(research), encoding="utf-8")
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

    `read_research_json` returns None on unparseable JSON and both detectors
    return [] on None, so a corrupt workspace looks exactly like a clean project.
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
