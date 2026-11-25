"""Both harnesses add the hosted planes' relay note to each main-thread agent return.

The shipped `agent_relay_note.py` adds it on the hosted planes only; the harnesses
measure that main thread, so they add it from the hook's own text.
"""

import ast
import asyncio
import importlib.util
from pathlib import Path

from harness.context_policy import RELAY_NOTE, relay_note_context, relay_note_hook

_HARNESS = Path(__file__).resolve().parents[2]
_HOOK = _HARNESS.parents[1] / "packages" / "engine" / "plugin" / "hooks" / "agent_relay_note.py"


def test_the_note_is_the_shipped_hook_text():
    spec = importlib.util.spec_from_file_location("_relay_for_test", _HOOK)
    hook = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hook)
    assert RELAY_NOTE == hook.RELAY_NOTE


def test_it_is_added_to_a_main_thread_agent_return_only():
    assert relay_note_context({"tool_name": "Agent"}) == RELAY_NOTE
    assert relay_note_context({"tool_name": "Task"}) == RELAY_NOTE
    assert relay_note_context({"tool_name": "Agent", "agent_id": "a1"}) is None
    assert relay_note_context({"tool_name": "Read"}) is None
    out = asyncio.run(relay_note_hook({"tool_name": "Agent"}, None, None))
    assert out == {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": RELAY_NOTE}}
    assert asyncio.run(relay_note_hook({"tool_name": "Read"}, None, None)) == {}


def test_historical_context_gets_the_note_for_its_own_relay_rule():
    for agent in ("historical-context", "plugin:historical-context", "genealogy-research:historical-context"):
        note = relay_note_context({"tool_name": "Agent", "tool_input": {"subagent_type": agent}})
        assert note != RELAY_NOTE
        assert "above its `### Search implications` heading" in note
        assert "after the final `---`" not in note
    other = {"tool_name": "Agent", "tool_input": {"subagent_type": "search-records"}}
    assert relay_note_context(other) == RELAY_NOTE
    assert relay_note_context({"tool_name": "Agent", "tool_input": "not a dict"}) == RELAY_NOTE


def _names(rel: str) -> set[str]:
    tree = ast.parse((_HARNESS / rel).read_text(encoding="utf-8"))
    return {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}


def test_both_harnesses_add_it():
    assert "relay_note_context" in _names("harness/skill_runner.py")
    assert "relay_note_hook" in _names("e2e/orchestrator.py")
