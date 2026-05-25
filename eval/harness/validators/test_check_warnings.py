"""Skill-specific validators for the check-warnings skill.

check-warnings is a read-only analysis skill — it scans research.json
for impossibilities and anomalies and produces narrative output, but
does not modify research.json or tree.gedcomx.json. It also does not
call MCP tools.

The rubric (rubric.md) keeps the narrative-judgment dimensions
(detection accuracy, severity classification, actionability). The
mechanical "didn't modify anything" + "didn't call any MCP tool" rules
live here.

See test_universal.py module docstring for the full validator
function-signature contract.
"""

from __future__ import annotations

import pytest


# --- Tool allowlist ---

def test_no_mcp_tools_called(tool_calls):
    """check-warnings is a pure analysis skill — it should not call any
    *research* MCP tool. It reads research.json/tree.gedcomx.json
    directly. The universal `validate_research_schema` is exempted:
    post commit 861d3c9 it's the built-in schema verifier any skill may
    call, not a research tool."""
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
        and tc.get("tool", "").rsplit("__", 1)[-1] != "validate_research_schema"
    ]
    assert not mcp_calls, (
        f"check-warnings should not call MCP tools (other than "
        f"validate_research_schema), but called: "
        f"{[tc['tool'] for tc in mcp_calls]}"
    )


# --- Read-only enforcement ---

def test_research_json_unmodified(before_state, after_state):
    """check-warnings must not modify research.json. The skill reports
    warnings as narrative output — the project file is read-only input."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert before == after, (
        "check-warnings modified research.json — this skill is read-only. "
        "Warnings should be reported as narrative, not written into the file."
    )


def test_tree_gedcomx_unmodified(before_state, after_state):
    """check-warnings must not modify tree.gedcomx.json either."""
    before = (
        before_state.get("tree_gedcomx_json")
        or before_state.get("tree_gedcomx")
    )
    after = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if before is None or after is None:
        pytest.skip("Missing tree.gedcomx.json for diff")
    assert before == after, (
        "check-warnings modified tree.gedcomx.json — this skill is read-only."
    )
