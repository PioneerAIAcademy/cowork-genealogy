"""Direct tests for the convert-dates validators.

Same reason as `test_search_familysearch_wiki_validators.py` and
`test_init_project_validator.py`: `pyproject.toml` sets `testpaths = ["tests"]`,
so nothing under `validators/` is collected by `make harness-test`, and a
validator's real pass/fail set would otherwise appear only inside a paid
per-skill run.

These exist to satisfy CLAUDE.md's "a new lint must be proven to fail" rule.
Every check added under issue #1654 is exercised against a state that must pass
AND the state that must fire, so the assertion is known to work before it gates
anything.

Provenance of the violating states, from the #1654 deep dive. The distinction
between observed and synthetic matters here, because the defect the dive found
made most of these unobservable: `convert_calendar` was registered nowhere, so
no tool call of any shape could appear in a run log.

  - VR-1's violation is REAL. `ut_convert_dates_004`, run
    `v1_2026-07-27_18-21-44`: `tool_calls: []` while the response opened "The
    convert_calendar arithmetic tool isn't available in this environment, so
    I'll apply the conversion directly using the regime tables from the skill."
    That shape held across all four committed run logs and all 56 runs, and base
    `Tool Arguments` was null in every one of them — the dimension covering tool
    work is only graded when `tool_calls` is non-empty, so the defect switched
    off its own check.

  - VR-4's violation is SYNTHETIC: a spurious conversion by the *correct* tool
    was impossible when no call was possible at all, and
    `test_only_convert_calendar_called` bans only OTHER tools, so nothing
    covered the positive no-op case.

  - VR-2 was written, tested, and then REMOVED — see the note in the validator
    module. Replaying it against the committed run log failed
    `ut_convert_dates_016`, a test that passed by requesting the correction,
    having the guarded tool refuse it, and relaying the refusal. Reading only
    `args`, a validator cannot tell correct probing from asserting a wrong year.
    Its rule now lives in `convertCalendar` plus five vitest cases.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validators as tests of this module and error on their
# harness-supplied fixtures. Same pattern as the sibling validator tests.
from test_convert_dates import (  # noqa: E402
    test_no_spurious_conversion as check_no_spurious,
    test_only_convert_calendar_called as check_only_cc,
    test_refusal_to_convert_makes_no_call as check_refusal,
    test_requires_tool_conversion_calls_the_tool as check_requires_call,
)

TOOL = "mcp__genealogy__convert_calendar"


def _tags(*tags, type="positive"):
    return {"type": type, "tags": list(tags)}


def _call(date, corrections, tool=TOOL):
    return {"tool": tool, "args": {"date": date, "corrections": corrections},
            "matched": {"kind": "live", "index": None}}


def _convert(**date):
    """A plain julianToGregorianDay call, the corpus's most common shape."""
    return _call(date, {"julianToGregorianDay": True})


# --- VR-1: requires-tool-conversion must call the tool -----------------

def test_vr1_passes_when_the_tool_was_called():
    check_requires_call([_convert(year=1900, month=2, day=14)],
                        _tags("requires-tool-conversion"))


def test_vr1_fires_on_the_observed_hand_arithmetic_run():
    """The real violation: ut_convert_dates_004, v1_2026-07-27_18-21-44,
    tool_calls empty because the tool was registered nowhere."""
    with pytest.raises(AssertionError, match="requires calendar arithmetic"):
        check_requires_call([], _tags("requires-tool-conversion"))


def test_vr1_fires_when_only_an_unrelated_tool_was_called():
    with pytest.raises(AssertionError, match="requires calendar arithmetic"):
        check_requires_call(
            [{"tool": "mcp__genealogy__place_search", "args": {}}],
            _tags("requires-tool-conversion"),
        )


def test_vr1_skips_when_the_tag_is_absent():
    """The gate is the tag, so an untagged test must not be forced to call —
    ut_convert_dates_004 lost the tag under F6 precisely because its correct
    answer is that the conversion is a specified input error."""
    with pytest.raises(pytest.skip.Exception):
        check_requires_call([], _tags("1582", "pre-adoption"))


def test_vr1_accepts_any_server_prefix():
    """Cowork exposes three spellings; the check must not pin one."""
    for tool in ("mcp__genealogy__convert_calendar",
                 "mcp__remote-devices__Genealogy_Research__convert_calendar",
                 "mcp__Genealogy_Research__convert_calendar"):
        check_requires_call([_call({"year": 1900}, {"julianToGregorianDay": True}, tool=tool)],
                            _tags("requires-tool-conversion"))


# --- VR-4: refusal-to-convert makes no call ---------------------------

def test_vr4_passes_when_no_conversion_was_attempted():
    check_refusal([], _tags("refusal-to-convert"))


def test_vr4_fires_on_a_spurious_conversion():
    """ut_convert_dates_008 ("15 March 1850, London") is already post-
    transition, so any offset applied to it is wrong. Unreachable before the
    tool was registered."""
    with pytest.raises(AssertionError, match="no conversion is needed"):
        check_refusal([_convert(year=1850, month=3, day=15)],
                      _tags("refusal-to-convert"))


def test_vr4_skips_when_the_tag_is_absent():
    with pytest.raises(pytest.skip.Exception):
        check_refusal([_convert(year=1900, month=2, day=14)],
                      _tags("julian-gregorian"))


# --- the two pre-existing checks still behave -------------------------

def test_only_convert_calendar_still_passes_on_a_clean_call():
    check_only_cc([_convert(year=1900, month=2, day=14)], _tags())


def test_only_convert_calendar_still_fires_on_a_foreign_tool():
    with pytest.raises(AssertionError, match="only call convert_calendar"):
        check_only_cc([{"tool": "mcp__genealogy__research_append", "args": {}}],
                      _tags())


def test_no_spurious_conversion_now_has_a_registered_tool_to_catch():
    """Before #1654 this assertion could not fail: it asserts convert_calendar
    was not called, for a tool registered nowhere, so it was green forever
    while `grade_on_invariant` rode on it. That is VR-3's general case; here is
    the specific proof it can now fire."""
    with pytest.raises(AssertionError, match="must not trigger a calendar conversion"):
        check_no_spurious([_convert(year=1821, month=2, day=15)],
                          _tags("no-spurious-conversion"))
