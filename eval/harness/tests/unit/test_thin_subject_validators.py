"""Direct tests for the thin-subject validators of search-records and research (issue #2213 d29).

Same reason as `test_search_records_pre1880_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

`extraction_append` refuses the thin hit in code (its tests:
`tests/tools/extraction-append.test.ts`, "a thin subject's search hit is
refused"), so the validator grades the outcome — the record never reaches
research.json — not whether the agent called the tool.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import test_thin_subject_hit_not_extracted as research_check  # noqa: E402
from test_search_records import test_thin_subject_hit_not_extracted as search_check  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[4]
UNIT = REPO_ROOT / "eval/tests/unit"
CASES = [
    (search_check, json.loads((UNIT / "search-records/thin-subject-namesake-gate.json").read_text(encoding="utf-8"))["test"]),
    (research_check, json.loads((UNIT / "research/thin-subject-pending-hit-not-extracted.json").read_text(encoding="utf-8"))["test"]),
]
UNTAGGED = {"tags": ["search"]}
both = pytest.mark.parametrize("check,TEST", CASES, ids=["search-records", "research"])


BEFORE = {"research_json": {"assertions": []}}


def state(*record_ids):
    return {"research_json": {"assertions": [{"id": f"a_{i}", "record_id": r} for i, r in enumerate(record_ids)]}}


@both
def test_the_committed_test_is_tagged(check, TEST):
    assert "subject-too-thin" in TEST["tags"]


@both
def test_passes_when_the_hit_never_lands(check, TEST):
    check(BEFORE, state(), [], TEST)


@both
def test_passes_when_assertions_were_there_before(check, TEST):
    check(state("ark:/61903/1:1:ZZZZ-ZZZ"), state("ark:/61903/1:1:ZZZZ-ZZZ"), [], TEST)


@both
@pytest.mark.parametrize("rid", ["M9TB-7QX", "https://familysearch.org/ark:/61903/1:1:M9TB-7QX", "ark:/61903/1:1:M9TB-7Q2"])
def test_fails_when_the_hit_or_a_co_resident_persona_lands(check, TEST, rid):
    with pytest.raises(AssertionError, match="new assertions"):
        check(BEFORE, state(rid), [], TEST)


@both
@pytest.mark.parametrize("agent", ["record-structurer", "genealogy-research:record-structurer"])
def test_fails_on_a_structurer_spawn(check, TEST, agent):
    spawn = [{"tool": "Agent", "args": {"subagent_type": agent, "prompt": "..."}}]
    with pytest.raises(AssertionError, match="record-structurer"):
        check(BEFORE, state(), spawn, TEST)


@both
def test_ignores_other_spawns(check, TEST):
    check(BEFORE, state(), [{"tool": "Agent", "args": {"subagent_type": "research-plan"}}], TEST)


@both
def test_skips_untagged(check, TEST):
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE, state("M9TB-7QX"), [], UNTAGGED)
