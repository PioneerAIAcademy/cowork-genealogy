"""The harness's foreground rewrite behaves as the hosted alpha's does.

`harness/delegation.py` copies `foreground_rewrite` from
apps/server/app/agent/continue_policy.py, which this venv cannot import. Both
are lifted with `ast` (the write-lockdown parity test's method) and run on the
same inputs, so a change to either that the other lacks fails here. Extraction
failing is a hard error, never a skip.
"""

from __future__ import annotations

import ast
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

REPO = Path(__file__).resolve().parents[4]
COPIES = {
    "hosted": REPO / "apps/server/app/agent/continue_policy.py",
    "harness": REPO / "eval/harness/harness/delegation.py",
}

VECTORS = [
    ("Agent", {"subagent_type": "record-extractor", "prompt": "x"}),
    ("Task", {"subagent_type": "image-reader"}),
    ("Agent", {"subagent_type": "a", "run_in_background": True}),
    ("Agent", {"subagent_type": "a", "run_in_background": False}),
    ("Agent", {"subagent_type": "a", "run_in_background": None}),
    ("Agent", {"subagent_type": "a", "run_in_background": 0}),
    ("Agent", None),
    ("Agent", {}),
    ("Skill", {"skill": "record-extraction"}),
    ("mcp__genealogy__record_read", {"recordId": "x"}),
    ("Bash", {"command": "ls", "run_in_background": True}),
]


def _lift(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    wanted = {"DELEGATION_TOOLS", "foreground_rewrite"}
    nodes = [
        n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in wanted)
        or (isinstance(n, ast.Assign) and any(getattr(t, "id", None) in wanted for t in n.targets))
    ]
    found = {n.name if isinstance(n, ast.FunctionDef) else n.targets[0].id for n in nodes}
    assert found == wanted, f"{path}: could not extract {sorted(wanted - found)}"
    namespace: dict[str, Any] = {"Mapping": Mapping, "Any": Any}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), namespace)
    return namespace["foreground_rewrite"]


@pytest.mark.parametrize("tool_name,tool_input", VECTORS)
def test_harness_rewrite_matches_hosted(tool_name, tool_input):
    hosted, harness = _lift(COPIES["hosted"]), _lift(COPIES["harness"])
    assert harness(tool_name, tool_input) == hosted(tool_name, tool_input)


def test_a_delegation_is_rewritten_to_the_foreground():
    rewrite = _lift(COPIES["harness"])
    out = rewrite("Agent", {"subagent_type": "a"})
    assert out["hookSpecificOutput"]["updatedInput"]["run_in_background"] is False
    assert rewrite("Agent", {"subagent_type": "a", "run_in_background": False}) is None
