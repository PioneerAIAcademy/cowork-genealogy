"""Direct tests for `test_research.test_no_paired_skill_shortcut`.

The validator runs only on a test tagged `no-shortcut`, and `ut_research_015` is
the only one. Its Agent-spawn arm has never fired in a committed run, and no
other test proves it can fail, so these cases do. `testpaths` excludes
`validators/`, which is why they live here. Each call record is in the shape
`skill_runner.builtin_call_record` writes.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import (  # noqa: E402
    _paired_names,
    test_no_paired_skill_shortcut as check,
)

NO_SHORTCUT = {
    "skill": "research",
    "tags": ["routing", "routes-to:question-selection", "no-shortcut"],
}


def _spawn(agent: str, agent_id: str | None = None) -> dict:
    record = {"tool": "Agent", "args": {"subagent_type": agent, "prompt": "p"}}
    if agent_id:
        record["agent_id"] = agent_id
    return record


def test_premise_the_router_reaches_these_rows_by_spawn():
    # Without this the must-fail cases below could fail for the wrong reason.
    assert {"person-evidence", "question-selection"} <= _paired_names()


def test_the_expected_hand_off_passes():
    check(NO_SHORTCUT, ["research"], [_spawn("question-selection")])


def test_a_spawn_made_inside_a_subagent_is_not_the_routers():
    check(
        NO_SHORTCUT,
        ["research"],
        [_spawn("question-selection"), _spawn("person-evidence", agent_id="a1")],
    )


@pytest.mark.parametrize(
    ("skills_invoked", "calls", "reached"),
    [
        (["research"], [_spawn("question-selection"), _spawn("person-evidence")], r"Agent\(person-evidence\)"),
        (["research"], [_spawn("gps-mentor"), _spawn("question-selection")], r"Agent\(gps-mentor\)"),
        (["research", "locality-guide"], [_spawn("question-selection")], r"Skill\(locality-guide\)"),
    ],
    ids=["spawned-person-evidence", "spawned-gps-mentor", "skill-call-to-a-paired-row"],
)
def test_reaching_a_paired_row_fails(skills_invoked, calls, reached):
    with pytest.raises(AssertionError, match=rf"reached a paired row.*{reached}"):
        check(NO_SHORTCUT, skills_invoked, calls)


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check({"skill": "research", "tags": ["routing"]}, ["research"], [_spawn("person-evidence")])
