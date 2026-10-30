"""Direct tests for `test_research.test_hints_item_handoff_carries_its_ids`.

The validator runs only on a test tagged `asserts-hints-handoff` (issue #3153).
`testpaths` excludes `validators/`, which is why these cases live here. Each call
record is in the shape `skill_runner.builtin_call_record` writes.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import test_hints_item_handoff_carries_its_ids as check  # noqa: E402

TEST = {"skill": "research", "tags": ["routing", "routes-to:search-hints", "asserts-hints-handoff"]}
RATIONALE = (
    "Review pending FamilySearch hints on LKFW-9XH before searching — an attached "
    "hint may already answer the question."
)


def _state(items: list[dict], plan_status: str = "active") -> dict:
    return {"research_json": {"plans": [{"id": "pl_001", "status": plan_status, "items": items}]}}


HINTS = {"id": "pli_002", "record_type": "fs_hints", "status": "planned", "rationale": RATIONALE}
STATE = _state([HINTS, {"id": "pli_001", "record_type": "vital_record", "status": "planned"}])


def _spawn(agent: str, prompt: str) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": agent, "prompt": prompt}}


FULL = "Review the hints.\nplanItemId: pli_002\nplanId: pl_001\npersonId: LKFW-9XH\nprojectPath: /p"


def test_passes_when_the_handoff_carries_all_three_ids():
    check(TEST, [_spawn("search-hints", FULL)], STATE)


def test_passes_a_json_shaped_handoff():
    prompt = '{"planItemId": "pli_002", "planId": "pl_001", "personId": "LKFW-9XH"}'
    check(TEST, [_spawn("search-hints", prompt)], STATE)


@pytest.mark.parametrize(
    "prompt, missing",
    [
        (FULL.replace("planItemId: pli_002\n", ""), "planItemId pli_002"),
        (FULL.replace("planId: pl_001\n", ""), "planId pl_001"),
        (FULL.replace("personId: LKFW-9XH\n", ""), "personId LKFW-9XH"),
        (FULL.replace("pli_002", "pli_0021"), "planItemId pli_002"),
    ],
    ids=["no-item", "no-plan", "no-person", "id-prefix-only"],
)
def test_fails_when_an_id_is_missing(prompt, missing):
    with pytest.raises(AssertionError, match=missing):
        check(TEST, [_spawn("search-hints", prompt)], STATE)


def test_fails_when_search_hints_is_never_spawned():
    with pytest.raises(AssertionError, match="No recorded spawn"):
        check(TEST, [_spawn("search-records", FULL)], STATE)


def test_scenario_without_a_planned_hints_item_is_drift():
    with pytest.raises(AssertionError, match="Scenario drift"):
        check(TEST, [_spawn("search-hints", FULL)], _state([dict(HINTS, status="in_progress")]))


def test_skips_untagged():
    with pytest.raises(pytest.skip.Exception):
        check({"skill": "research", "tags": ["routing"]}, [], STATE)
