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


# --- Invariant for the boundary negatives (no spurious conversion) ---

def test_no_spurious_conversion(tool_calls, test):
    """Invariant behind the `grade_on_invariant` flag on the convert-dates
    boundary negatives, gated on the `no-spurious-conversion` tag.

    Some near-miss inputs look date-shaped but need no calendar conversion:
    a cosmetic reformatting request (ut_convert_dates_010), or a question
    about the *history* of a calendar convention (ut_convert_dates_003).
    Whether or not the router loads convert-dates, it must NOT perform a
    calendar conversion on these. Deterministic check: convert_calendar was
    never invoked. This is the real gate that keeps grade_on_invariant from
    passing vacuously.
    """
    if "no-spurious-conversion" not in (test.get("tags") or []):
        pytest.skip("only applies to no-spurious-conversion negative tests")
    converted = [
        tc["tool"] for tc in tool_calls
        if "convert_calendar" in tc.get("tool", "")
    ]
    assert not converted, (
        "this boundary negative must not trigger a calendar conversion; "
        f"convert_calendar was invoked: {converted}"
    )


# --- VR-1: the tool must actually be called ---------------------------

def _calendar_calls(tool_calls):
    """Every convert_calendar call, whatever server prefix it carries."""
    return [tc for tc in tool_calls if "convert_calendar" in tc.get("tool", "")]


def test_requires_tool_conversion_calls_the_tool(tool_calls, test):
    """A test tagged `requires-tool-conversion` must show at least one
    convert_calendar call (issue #1654, VR-1).

    The skill body forbids hand arithmetic ("Do not fall back to hand
    arithmetic") and holds exactly one tool, so on a test whose correct answer
    IS calendar arithmetic the call is not optional. This is also the only
    check that keeps the offset correct by construction: the tool derives the
    Julian/Gregorian offset by JDN round-trip, so a call gets +12 for Julian
    14 Feb 1900 whatever the body's regime table happens to say. Prose can
    regress again -- and did, from leap-day thresholds to calendar-year bands
    -- but the tool cannot.

    Why this needed a validator: across four committed run logs and 56 runs
    the tool was never called once, because it was registered nowhere. Every
    run did the arithmetic by hand and was graded a pass, and the dimension
    that covers tool work (base Tool Arguments) is only graded when tool_calls
    is non-empty -- so the defect switched off the check that would have caught
    it. Nothing in the corpus could notice.

    Not gated on `type == "positive"`: the tag is the gate, and it is only ever
    applied to tests whose answer requires arithmetic.
    """
    if "requires-tool-conversion" not in (test.get("tags") or []):
        pytest.skip("only applies to tests tagged requires-tool-conversion")
    assert _calendar_calls(tool_calls), (
        "this test's answer requires calendar arithmetic, so convert_calendar "
        "must be called rather than computed by hand (SKILL.md: 'Do not fall "
        f"back to hand arithmetic'). Tool calls seen: "
        f"{[tc.get('tool') for tc in tool_calls] or 'none'}"
    )


# --- VR-2 is deliberately NOT a validator ------------------------------
#
# The rule — `doubleDatedYear` must not resolve a date outside Jan 1 - Mar 24 —
# is real and was the most expensive error the #1654 dive found: on March 25 the
# Old-Style year increments, so both styles already agree and resolving one
# shifts the event a year in the researcher's notes.
#
# It is enforced in `convertCalendar` itself (packages/engine/mcp-server/src/
# tools/convert-calendar.ts) plus five vitest cases, NOT here, and the reason is
# worth recording because it was found the hard way. Written as a validator it
# fails the best available behaviour: in run v1_2026-08-19_22-13-16,
# ut_convert_dates_016 requested the correction for 25 March, the tool refused
# it, and the skill relayed that refusal — "The tool confirms this date is
# outside the normal double-dating window and flags it as anomalous" — which is
# exactly what the body's `{ ok: false }` rule asks for. A validator reading only
# `args` cannot tell that apart from asserting a wrong year, so it would punish a
# correct run for probing.
#
# The general lesson: a rule the TOOL can enforce belongs in the tool, where it
# cannot be bypassed and where a wrong request is answered rather than merely
# recorded. A validator earns its place on what the tool cannot see — whether the
# call happened at all (VR-1), or whether one happened that should not have
# (VR-4).


# --- VR-4: a refusal-to-convert test must make no call ----------------

def test_refusal_to_convert_makes_no_call(tool_calls, test):
    """A positive test tagged `refusal-to-convert` must make no
    convert_calendar call at all (issue #1654, VR-4).

    On these the graded behaviour is recognising that no conversion is needed
    -- a post-transition date in a jurisdiction that had already adopted
    Gregorian, for instance. Performing one is the failure, not the answer.

    This is the positive-test counterpart to test_no_spurious_conversion above,
    which guards the boundary *negatives*. Neither existed for the positive
    no-op case: test_only_convert_calendar_called bans OTHER tools, so a
    spurious conversion by the correct tool passed every check. Before the tool
    was registered that gap was invisible, because no call was possible at all.
    """
    if "refusal-to-convert" not in (test.get("tags") or []):
        pytest.skip("only applies to tests tagged refusal-to-convert")
    converted = [tc.get("tool") for tc in _calendar_calls(tool_calls)]
    assert not converted, (
        "this test's correct answer is that no conversion is needed, so "
        f"convert_calendar should not have been called: {converted}"
    )
