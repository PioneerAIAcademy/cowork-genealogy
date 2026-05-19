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
    """translation is a pure model task — it shouldn't call any MCP tool.
    The skill has no `allowed-tools` in its frontmatter (the universal
    allowlist also catches this; the explicit check here surfaces the
    expectation in this skill's validator file)."""
    if test.get("type") != "positive":
        pytest.skip("negative tests are graded by routing, not tool use")
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
    ]
    assert not mcp_calls, (
        "translation should not call MCP tools, but called: "
        f"{[tc['tool'] for tc in mcp_calls]}"
    )
