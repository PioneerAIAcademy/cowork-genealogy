"""Skill-specific validators for the convert-dates skill.

convert-dates keeps its `rubric.md` — the three dimensions (Conversion
accuracy, Ambiguity handling, Genealogical presentation) all require
reading narrative output for genealogical judgment and stay graded by
the LLM judge.

This file holds the mechanical checks: tool-allowlist enforcement for
positive tests. State-shape checks for specific dates are intentionally
not added here because the current test corpus uses `scenario: null`
(no research.json to diff). Add tag-gated state assertions if/when
future tests bind to a scenario.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import pytest


# --- Tool-allowlist enforcement ---------------------------------------

def test_only_convert_calendar_called(tool_calls, test):
    """Positive convert-dates tests should only call convert_calendar (if
    any MCP tool). Negative tests should not route here at all — graded
    by the negative-test outcome logic in orchestrator._compute_outcome."""
    if test.get("type") != "positive":
        pytest.skip("activation rules handle negative tests")
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
    ]
    bad = [
        tc["tool"] for tc in mcp_calls
        if "convert_calendar" not in tc.get("tool", "")
    ]
    assert not bad, (
        f"convert-dates positive tests should only call convert_calendar; "
        f"also called: {bad}"
    )
