"""Issue #4011: both harnesses add the collections sentence to each user message.

Every production path carries it to the main thread: the hosted planes append
`continue_policy.COLLECTIONS_GUIDANCE`, and Cowork gets `COLLECTIONS_NOTE` from the
plugin's `no_project_route.py` hook as context on the message. The harnesses add it the
Cowork way. Without it `ut_research_ken` stays red with the fix shipped; as the whole
system prompt it broke routing (ut_research_027). The options are built inline, so the
wiring is asserted on the source, as `test_skill_runner_mcp_isolation.py` does.
"""

import ast
import asyncio
import importlib.util
from pathlib import Path

from harness.context_policy import COLLECTIONS_NOTE, collections_note_hook

_HARNESS = Path(__file__).resolve().parents[2]
_HOOK = _HARNESS.parents[1] / "packages" / "engine" / "plugin" / "hooks" / "no_project_route.py"


def _options_kwargs(path: Path) -> dict:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "ClaudeAgentOptions":
            return {kw.arg: kw.value for kw in node.keywords if kw.arg}
    raise AssertionError(f"no ClaudeAgentOptions(...) call in {path.name}")


def test_the_note_is_the_shipped_hook_sentence():
    spec = importlib.util.spec_from_file_location("_route_hook_for_test", _HOOK)
    hook = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hook)
    assert COLLECTIONS_NOTE == hook.COLLECTIONS_NOTE
    assert "collections_search" in COLLECTIONS_NOTE


def test_the_hook_adds_it_to_a_researcher_message_only():
    out = asyncio.run(collections_note_hook({"prompt": "What Kenyan records can I search?"}, None, None))
    assert out["hookSpecificOutput"] == {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": COLLECTIONS_NOTE,
    }
    hand_back = {"prompt": '<agent-message from="a1">done</agent-message>'}
    assert asyncio.run(collections_note_hook(hand_back, None, None)) == {}
    assert asyncio.run(collections_note_hook({}, None, None)) == {}


def test_both_harnesses_bind_it_and_leave_the_system_prompt_empty():
    for path in (_HARNESS / "harness" / "skill_runner.py", _HARNESS / "e2e" / "orchestrator.py"):
        kwargs = _options_kwargs(path)
        assert "system_prompt" not in kwargs, f"{path.name}: the note rides the message, not the system prompt"
        hooks = kwargs.get("hooks")
        assert isinstance(hooks, ast.Dict), f"{path.name} passes no hooks dict"
        entries = {k.value: v for k, v in zip(hooks.keys, hooks.values) if isinstance(k, ast.Constant)}
        assert "UserPromptSubmit" in entries, f"{path.name} binds no UserPromptSubmit hook"
        names = {n.id for n in ast.walk(entries["UserPromptSubmit"]) if isinstance(n, ast.Name)}
        assert "collections_note_hook" in names, f"{path.name} must bind collections_note_hook"
