"""Skill-specific validators for the translation skill.

translation is a pure model task — it translates foreign-language record
text and explains genealogically significant terms. Narrative quality
(accuracy, notation of uncertainty, cultural context) lives in the
rubric — graded by the LLM judge. The only mechanical check is that
the skill doesn't call MCP tools (it has none in its allowed-tools
frontmatter and shouldn't need any).

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import pytest


# --- Tool-call enforcement -------------------------------------------

def test_no_mcp_tools_called(tool_calls, test):
    """translation is a pure model task — it shouldn't call any *research*
    MCP tool. The universal `validate_research_schema` is exempted: post
    commit 861d3c9 it's the built-in schema verifier any skill may
    call, not a research tool."""
    if test.get("type") != "positive":
        pytest.skip("negative tests are graded by routing, not tool use")
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
        and tc.get("tool", "").rsplit("__", 1)[-1] != "validate_research_schema"
    ]
    assert not mcp_calls, (
        "translation should not call MCP tools (other than "
        f"validate_research_schema), but called: "
        f"{[tc['tool'] for tc in mcp_calls]}"
    )
