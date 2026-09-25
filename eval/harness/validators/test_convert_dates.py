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
    a cosmetic reformatting request (ut_convert_dates_010), a question
    about the *history* of a calendar convention (ut_convert_dates_003), or
    a question about whether a date string passes the research.json schema
    (ut_convert_dates_012).
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

def test_day_offset_calls_name_a_jurisdiction(tool_calls, test):
    """A `julianToGregorianDay` call must carry a `jurisdiction` (issue #2260).

    The adoption table moved out of SKILL.md into the tool, so the body no
    longer states when a place switched. `jurisdiction` is how the model gets
    that back, and a day-offset call without one is the model deciding the
    regime from memory -- the failure mode the move was meant to end.

    Gated on the CORRECTION, not on the `requires-tool-conversion` tag, and
    deliberately: `ut_convert_dates_001` carries that tag and its prompt
    ("3rd day of 2nd month 1845") names no place at all. A tag-gated check
    would fail it deterministically for a jurisdiction that does not exist.
    The Quaker era comes from the date, not the place; only the day offset
    depends on where the record is from.

    Nothing else can see this. `make engine-test` proves the tool HONOURS a
    jurisdiction; only a run log shows whether the model PASSED one, and every
    figure here describes the eval corpus, not production
    (docs/architecture.md 9.4).
    """
    # The skill body sanctions one omission: "Omit `jurisdiction` only when the
    # record names no place." A test whose record genuinely names none declares
    # it with this tag, and the check stands down -- otherwise the guard fails
    # the model for following its own instructions. No fixture carries the tag
    # today; every day-offset record in the corpus names a place. It exists so
    # that a placeless one can be added without the guard misfiring, rather than
    # the guard passing by luck.
    if "record-names-no-place" in (test.get("tags") or []):
        pytest.skip("the record names no place; the body permits omitting jurisdiction")

    offenders = []
    for tc in _calendar_calls(tool_calls):
        args = tc.get("args") or tc.get("arguments") or {}
        if not isinstance(args, dict):
            continue
        corrections = args.get("corrections") or {}
        if not isinstance(corrections, dict) or not corrections.get("julianToGregorianDay"):
            continue
        jurisdiction = args.get("jurisdiction")
        if not (isinstance(jurisdiction, str) and jurisdiction.strip()):
            offenders.append(args)

    assert not offenders, (
        f"{len(offenders)} convert_calendar call(s) requested julianToGregorianDay "
        "with no jurisdiction. The tool holds the adoption table now; pass the "
        "place the record names so it can say which calendar was in force. "
        f"First offender: {offenders[0] if offenders else None}"
    )


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


# --- VR-5: a no-gregorian-equivalent test must be rejected by the tool -

def test_no_gregorian_equivalent_gets_tool_rejection(tool_calls, test):
    """A positive test tagged `no-gregorian-equivalent` must call
    convert_calendar with julianToGregorianDay, and the tool must
    actually reject it (issue #2098).

    This tag marks a Julian date before 15 October 1582, where the
    Gregorian calendar did not yet exist anywhere and the tool refuses
    the day-offset by design. Whether the skill's *narration* correctly
    withholds a "Gregorian date" field for that rejection is genealogical
    judgment the judge grades (rubric: Genealogical presentation, Tool
    response interpretation) -- this validator only guards the mechanical
    half: that a rejection genuinely happened, deterministically, rather
    than the judge crediting a narration that never called the tool or
    that got lucky on a call the tool actually accepted.
    """
    if "no-gregorian-equivalent" not in (test.get("tags") or []):
        pytest.skip("only applies to tests tagged no-gregorian-equivalent")
    calls = _calendar_calls(tool_calls)
    assert calls, (
        "this test's date precedes the Gregorian calendar's existence, so "
        "convert_calendar must be called to surface the tool's rejection "
        "rather than assumed by narration alone"
    )
    accepted = [tc for tc in calls if (tc.get("response") or {}).get("ok")]
    assert not accepted, (
        "this test's date is before 1582-10-15, so every convert_calendar "
        f"call must return ok: false; at least one returned ok: true: "
        f"{accepted}"
    )
