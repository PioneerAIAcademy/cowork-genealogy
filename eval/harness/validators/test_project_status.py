"""Skill-specific validators for the project-status skill.

project-status is a read-only summary skill — it reads both project
files (research.json + tree.gedcomx.json) and produces a narrative
status report for the user. It must not modify either file and does
not call MCP tools.

The rubric (rubric.md) keeps the narrative-judgment dimensions
(completeness of summary, accuracy, actionability). The mechanical
"didn't modify anything" + "didn't call any MCP tool" rules live here.

See test_universal.py module docstring for the full validator
function-signature contract.
"""

from __future__ import annotations

import pytest


# --- Tool allowlist ---

def test_no_mcp_tools_called(tool_calls):
    """project-status is read-only narrative analysis — no *research* MCP
    calls. The universal `validate_research_schema` is exempted: post
    commit 861d3c9 it's the built-in schema verifier any skill may
    call, not a research tool."""
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
        and tc.get("tool", "").rsplit("__", 1)[-1] != "validate_research_schema"
    ]
    assert not mcp_calls, (
        f"project-status should not call MCP tools (other than "
        f"validate_research_schema), but called: "
        f"{[tc['tool'] for tc in mcp_calls]}"
    )


# --- Read-only enforcement ---

def test_research_json_unmodified(before_state, after_state, test):
    """project-status must not modify research.json.

    Skipped on negative tests: the LLM is expected to route away to
    another skill (e.g. proof-conclusion), which may legitimately
    modify project files as part of its own contract. This validator
    only applies when project-status itself is supposed to run.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert before == after, (
        "project-status modified research.json — this skill is read-only. "
        "Per SKILL.md: 'Never modify project files.'"
    )


def test_tree_gedcomx_unmodified(before_state, after_state, test):
    """project-status must not modify tree.gedcomx.json.

    Skipped on negative tests (see test_research_json_unmodified).
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
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
        "project-status modified tree.gedcomx.json — this skill is read-only."
    )
