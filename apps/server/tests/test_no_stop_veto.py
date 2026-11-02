"""Step mode phase 2: neither hosted plane vetoes a stop.

A step-mode turn ends at its boundary on purpose, and "Keep going" is the host's reply,
not a veto (docs/plan/research-step-mode.md, section A2 and Phase 2). The worker half is
in test_proto_worker.py, next to the fixture it drives.
"""

from __future__ import annotations

import ast
import importlib
from pathlib import Path

from app.agent import real_agent

_SERVER = Path(__file__).resolve().parents[1]
_VETO_NAMES = {"should_continue_run", "CONTINUE_REASON", "make_stop_hook"}


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
    return found


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
    ):
        assert _veto_names_in(ast.parse(planted)), planted
    assert not _veto_names_in(ast.parse("x = foreground_rewrite\n"))
