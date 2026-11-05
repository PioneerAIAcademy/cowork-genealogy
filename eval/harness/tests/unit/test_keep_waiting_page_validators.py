"""Direct tests for keeping a read page: `test_research.test_keeps_waiting_page`,
and the `sources` arm of `test_universal.test_ownership_table` that lets
`extraction_append` fill a page onto an existing source.

`testpaths` excludes `validators/`, which is why these cases live here.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import test_keeps_waiting_page as check  # noqa: E402
from test_universal import test_ownership_table as check_ownership  # noqa: E402

ARK = "ark:/61903/3:1:33S7-9YBC-V6L"
TEST = {"skill": "research", "type": "positive", "tags": ["keeps-waiting-page"]}
RESEARCH_SKILL = {"name": "research"}
CALL = {"tool": "mcp__genealogy__extraction_append", "args": {"projectPath": "/p", "attachWaitingPages": True}}


def state() -> dict:
    return {"research_json": {
        "project": {"id": "rp_001", "objective": "x", "updated": "2026-01-01T00:00:00Z"},
        "questions": [], "plans": [], "log": [],
        "sources": [{"id": "src_001", "citation": "1860 census", "image_ark": ARK}],
        "assertions": [], "person_evidence": [], "conflicts": [], "hypotheses": [],
        "timelines": [], "proof_summaries": [], "evaluations": [], "localities": [],
    }}


def kept() -> dict:
    after = state()
    after["research_json"]["sources"][0].update(transcription="Patrick Flynn, 15", image_filename="images/p.jpg")
    return after


def test_a_kept_page_passes():
    check(state(), kept(), [CALL], TEST)


def test_any_server_spelling_counts():
    call = {**CALL, "tool": "mcp__remote-devices__Genealogy_Research__extraction_append"}
    check(state(), kept(), [call], TEST)


def test_other_tests_are_skipped():
    with pytest.raises(pytest.skip.Exception):
        check(state(), state(), [], {"tags": []})


@pytest.mark.parametrize("calls", [
    [],
    [{"tool": "mcp__genealogy__research_append", "args": {"attachWaitingPages": True}}],
    [{"tool": "mcp__genealogy__extraction_append", "args": {"projectPath": "/p", "recordIds": ["X"]}}],
    [{"tool": "mcp__genealogy__extraction_append", "args": {"attachWaitingPages": "true"}}],
])
def test_no_keeping_call_fails(calls):
    with pytest.raises(AssertionError, match="kept the waiting page"):
        check(state(), kept(), calls, TEST)


def test_a_page_left_off_fails():
    with pytest.raises(AssertionError, match="Still no page"):
        check(state(), state(), [CALL], TEST)


def test_a_second_source_fails():
    after = kept()
    after["research_json"]["sources"].append({"id": "src_002", "citation": "the page"})
    with pytest.raises(AssertionError, match="new source"):
        check(state(), after, [CALL], TEST)


def test_an_assertion_fails():
    after = kept()
    after["research_json"]["assertions"].append({"id": "a_001"})
    with pytest.raises(AssertionError, match="no assertion"):
        check(state(), after, [CALL], TEST)


def test_a_scenario_with_nothing_waiting_fails_rather_than_passing_empty():
    before = state()
    del before["research_json"]["sources"][0]["image_ark"]
    with pytest.raises(AssertionError, match="no source waiting"):
        check(before, kept(), [CALL], TEST)


# ── ownership: what `extraction_append` may change on an existing source ─────


def test_ownership_accepts_a_kept_page():
    check_ownership(state(), kept(), RESEARCH_SKILL, TEST, [CALL])


def test_ownership_accepts_a_truncated_page():
    after = kept()
    after["research_json"]["sources"][0]["transcription_truncated"] = True
    check_ownership(state(), after, RESEARCH_SKILL, TEST, [CALL])


def test_ownership_accepts_a_new_source_beside_a_kept_page():
    after = kept()
    after["research_json"]["sources"].append({"id": "src_002", "citation": "another"})
    check_ownership(state(), after, RESEARCH_SKILL, TEST, [CALL])


def test_ownership_refuses_a_page_with_no_call():
    with pytest.raises(AssertionError):
        check_ownership(state(), kept(), RESEARCH_SKILL, TEST, [])


def test_ownership_refuses_any_other_field_changed_beside_the_page():
    after = kept()
    after["research_json"]["sources"][0]["citation"] = "rewritten"
    with pytest.raises(AssertionError):
        check_ownership(state(), after, RESEARCH_SKILL, TEST, [CALL])


def test_ownership_refuses_a_removed_source():
    before = state()
    before["research_json"]["sources"].append({"id": "src_002", "citation": "gone"})
    with pytest.raises(AssertionError):
        check_ownership(before, kept(), RESEARCH_SKILL, TEST, [CALL])


def test_ownership_refuses_a_rewritten_page():
    before = kept()
    after = copy.deepcopy(before)
    after["research_json"]["sources"][0]["transcription"] = "a different reading"
    with pytest.raises(AssertionError):
        check_ownership(before, after, RESEARCH_SKILL, TEST, [CALL])
