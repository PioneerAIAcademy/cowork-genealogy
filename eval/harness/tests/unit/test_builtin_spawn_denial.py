"""Both harnesses deny a main-thread spawn of a built-in agent type, as the shipped
hook does (`guard_project_files.builtin_spawn_denied`): such an agent runs a step
without any plugin agent's instructions or tool limits."""

import ast
from pathlib import Path

import pytest

from harness.context_policy import builtin_spawn_denial

_HARNESS = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    "tool_input, name",
    [
        ({"prompt": "p"}, "general-purpose"),
        ({"subagent_type": None, "prompt": "p"}, "general-purpose"),
        ({"subagent_type": "claude", "prompt": "p"}, "claude"),
        ({"subagent_type": "Plan", "prompt": "p"}, "Plan"),
    ],
)
def test_a_main_thread_spawn_of_a_built_in_type_is_denied(tool_input, name):
    out = builtin_spawn_denial({"tool_name": "Agent", "tool_input": tool_input})
    assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert f'"{name}"' in out["hookSpecificOutput"]["permissionDecisionReason"]


@pytest.mark.parametrize(
    "payload",
    [
        {"tool_name": "Agent", "tool_input": {"subagent_type": "hypothesis-tracking"}},
        {"tool_name": "Agent", "tool_input": {"subagent_type": "claude"}, "agent_id": "a1"},
        {"tool_name": "Agent", "tool_input": {"subagent_type": ["claude"]}},
        {"tool_name": "Read", "tool_input": {"subagent_type": "claude"}},
    ],
    ids=["plugin-agent", "inside-a-subagent", "not-a-string", "not-a-spawn"],
)
def test_everything_else_passes(payload):
    assert builtin_spawn_denial(payload) is None


@pytest.mark.parametrize("rel", ["harness/skill_runner.py", "e2e/orchestrator.py"])
def test_both_harness_hooks_call_it(rel):
    tree = ast.parse((_HARNESS / rel).read_text(encoding="utf-8"))
    called = {
        n.func.id
        for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
    }
    assert "builtin_spawn_denial" in called, f"{rel} must deny a built-in spawn as the shipped hook does"
