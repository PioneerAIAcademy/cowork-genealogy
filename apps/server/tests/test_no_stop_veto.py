"""Step mode phase 2: neither hosted plane vetoes a stop or halts on `research_delivered`.

A step-mode turn ends at its boundary on purpose, and "Keep going" is the host's reply,
not a veto (docs/specs/research-step-mode-spec.md, section A2 and Phase 2). A one-off ask ends
on the model's own end of turn, so the delivered halt went too. The worker half is in
test_proto_worker.py, next to the fixture it drives.
"""

from __future__ import annotations

import ast
import importlib
from pathlib import Path

from app.agent import real_agent

_SERVER = Path(__file__).resolve().parents[1]
_VETO_NAMES = {"should_continue_run", "CONTINUE_REASON", "make_stop_hook",
               "DELIVERED_TOOL", "DELIVERY_GUIDANCE", "delivered_stop_reason"}
_DELIVERED_CALL = "mcp__genealogy__research_delivered"


class _Matcher:
    def __init__(self, **kw):
        self.kw = kw


def test_the_alpha_binds_no_stop_hook_even_with_a_cap_set(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTONOMOUS_MAX_NUDGES", "40")
    try:
        reloaded = importlib.reload(real_agent)
        hooks = reloaded._build_hooks(_Matcher, tmp_path)
    finally:
        monkeypatch.delenv("AUTONOMOUS_MAX_NUDGES", raising=False)
        importlib.reload(real_agent)
    assert "Stop" not in hooks


def _veto_names_in(tree: ast.AST) -> set[str]:
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in _VETO_NAMES:
            found.add(node.name)
        elif isinstance(node, ast.Assign):
            found |= {
                n.id for t in node.targets for n in ast.walk(t)
                if isinstance(n, ast.Name) and n.id in _VETO_NAMES
            }
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id in _VETO_NAMES:
                found.add(node.target.id)
        elif isinstance(node, ast.ImportFrom):
            found |= {a.name for a in node.names if a.name in _VETO_NAMES}
        elif _binds_a_stop_key(node):
            found.add("Stop")
    return found


def _is_stop(node: ast.AST | None) -> bool:
    return isinstance(node, ast.Constant) and node.value == "Stop"


def _binds_a_stop_key(node: ast.AST) -> bool:
    """A `Stop` hook bound under any name: `{"Stop": ...}`, `hooks["Stop"]` or `dict(Stop=...)`."""
    if isinstance(node, ast.Dict):
        return any(_is_stop(k) for k in node.keys)
    if isinstance(node, ast.Subscript):
        return _is_stop(node.slice)
    if isinstance(node, ast.Call):
        return any(k.arg == "Stop" for k in node.keywords)
    return False


def _offenders() -> dict[str, set[str]]:
    out = {}
    for root in ("app", "proto"):
        for path in sorted((_SERVER / root).rglob("*.py")):
            names = _veto_names_in(ast.parse(path.read_text(encoding="utf-8")))
            if names:
                out[str(path.relative_to(_SERVER))] = names
    return out


def test_no_hosted_module_defines_or_imports_the_veto():
    assert _offenders() == {}


def test_the_guard_sees_each_shape_of_a_planted_veto():
    for planted in (
        "def should_continue_run(**kw):\n    return True\n",
        "async def make_stop_hook():\n    pass\n",
        "CONTINUE_REASON = 'keep going'\n",
        "CONTINUE_REASON: str = 'keep going'\n",
        "CONTINUE_REASON, x = 'keep going', 1\n",
        "from app.agent.continue_policy import CONTINUE_REASON\n",
        "hooks['Stop'] = [matcher]\n",
        "hooks = {'Stop': [matcher]}\n",
        "hooks = dict(Stop=[matcher])\n",
        "hooks.update({'Stop': [matcher]})\n",
        "DELIVERED_TOOL = 'mcp__genealogy__research_delivered'\n",
        "DELIVERY_GUIDANCE = 'call research_delivered'\n",
        "def delivered_stop_reason(summary):\n    return summary\n",
        "from .continue_policy import DELIVERED_TOOL\n",
    ):
        assert _veto_names_in(ast.parse(planted)), planted
    for legitimate in (
        "x = foreground_rewrite\n",
        "reason = 'Stop'\n",
        "if event == 'Stop':\n    pass\n",
        "counts = {'stop': 1}\n",
    ):
        assert not _veto_names_in(ast.parse(legitimate)), legitimate


def test_the_alpha_does_not_halt_on_a_delivered_call(tmp_path):
    hooks = real_agent._build_hooks(_Matcher, tmp_path)
    count_only = hooks["PreToolUse"][0].kw["hooks"][0]
    import asyncio

    out = asyncio.run(count_only({"tool_name": _DELIVERED_CALL, "tool_input": {"summary": "x"}}, "t", None))
    assert out == {}


def test_the_alpha_still_routes_a_first_message_with_no_project_to_research(tmp_path):
    """#3768's hosted routing sentence lived in DELIVERY_GUIDANCE; it moved to the project
    note rather than going with the tool. The worker's twin is in test_proto_worker.py."""
    alpha = real_agent.build_options(tmp_path).system_prompt["append"]
    assert "a request to research a person is not a single lookup" in alpha
    assert "research_delivered" not in alpha
