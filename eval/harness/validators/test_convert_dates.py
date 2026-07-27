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


# --- Invariant for the plain-reformatting negative -------------------

def test_no_spurious_conversion_on_reformatting(tool_calls, test):
    """Invariant behind ut_convert_dates_010's `grade_on_invariant` flag,
    gated on the `no-spurious-conversion` tag.

    A cosmetic reformatting request ("reformat '15-Feb-1821' to 'February
    15, 1821'") involves no calendar-system change, so convert-dates must
    NOT perform a conversion. The router reliably loads convert-dates on
    the date-shaped input; what matters is that it declines to convert.
    Deterministic check: convert_calendar was never invoked. This is the
    real gate that keeps grade_on_invariant from passing vacuously.
    """
    if "no-spurious-conversion" not in (test.get("tags") or []):
        pytest.skip("only applies to the no-spurious-conversion negative test")
    converted = [
        tc["tool"] for tc in tool_calls
        if "convert_calendar" in tc.get("tool", "")
    ]
    assert not converted, (
        "a plain reformatting request must not trigger a calendar "
        f"conversion; convert_calendar was invoked: {converted}"
    )
