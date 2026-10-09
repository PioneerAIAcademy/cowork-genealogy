"""Direct tests for `test_universal.test_skill_calls_name_a_shipped_skill`.

The guard exists because a leftover `Skill("<converted skill>")` passes its
suite: `stub_skills` answers the call and `handoffs()` records it (issue #2118).
Each case is a `builtin_tool_calls` record in the shape
`skill_runner.builtin_call_record` writes.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_universal import (  # noqa: E402
    test_skill_calls_name_a_shipped_skill as check,
)

from harness.workspace import DEFAULT_PLUGIN_SKILLS  # noqa: E402


def _skill(name: str, key: str = "skill", agent_id: str | None = None) -> dict:
    record = {"tool": "Skill", "args": {key: name}}
    if agent_id:
        record["agent_id"] = agent_id
    return record


def _spawn(agent: str) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": agent, "prompt": "p"}}


def test_premise_the_deleted_skill_has_no_directory_and_a_live_one_does():
    # Without this the must-fail cases below could pass for the wrong reason.
    assert not (DEFAULT_PLUGIN_SKILLS / "check-warnings").exists()
    assert (DEFAULT_PLUGIN_SKILLS / "conflict-resolution" / "SKILL.md").is_file()


@pytest.mark.parametrize(
    "calls",
    [
        [_skill("check-warnings")],
        [_skill("genealogy-research:check-warnings")],
        [_skill("check-warnings", key="name")],
        [_skill("conflict-resolution"), _skill("check-warnings")],
    ],
    ids=["bare", "namespaced", "name-key", "second-of-two"],
)
def test_a_skill_call_to_a_deleted_skill_fails(calls):
    with pytest.raises(AssertionError, match="check-warnings"):
        check(calls)


@pytest.mark.parametrize(
    "calls",
    [
        [],
        None,
        [_skill("conflict-resolution")],
        [_skill("genealogy-research:conflict-resolution")],
        [_spawn("check-warnings")],
        [_skill("check-warnings", agent_id="a1")],
        [{"tool": "Skill", "args": {}}],
        [{"tool": "Read", "args": {"file_path": "tree.gedcomx.json"}}],
    ],
    ids=[
        "no-calls", "none", "real-skill", "namespaced-real-skill",
        "agent-spawn", "subagent-side", "unreadable-name", "other-builtin",
    ],
)
def test_legitimate_calls_pass(calls):
    check(calls)
