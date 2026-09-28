"""Direct tests for check-warnings' V3, `test_conflict_resolution_hand_back`.

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/` is
collected on its own; a gating validator with no test of its own is a check that
nobody has watched fail. Same pattern as `test_person_evidence_validators.py`.

V3 grades the hand-back the check-warnings agent returns for a source conflict
(lead ruling 2026-09-23, issue #2118): no tool call, the owner named in the
caller-facing lines before the final `---`, and never after it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix so pytest does not collect it here.
from test_check_warnings import (  # noqa: E402
    test_conflict_resolution_hand_back as check_hand_back,
)

HAND_BACK = {"type": "negative", "tags": ["negative", "boundary", "hand-back", "direct-arm"]}

RESEARCHER = (
    "Two records disagree about where he was born, which is a different kind of "
    "problem from a date that cannot be true, so nothing was checked here.\n"
    "Next, the two records will be compared to see which one is right."
)

GOOD = (
    "Hand-back: conflict-resolution — two sources disagree on the birth county.\n"
    "---\n" + RESEARCHER
)

WARNINGS_CALL = {"tool": "person_warnings", "args": {"personId": "I1"}, "response": {}}


def test_well_formed_hand_back_passes():
    check_hand_back([], GOOD, HAND_BACK)


def test_reflowed_caller_line_passes():
    reply = (
        "This is a source conflict, not a warning.\n"
        "Hand-back:\n  conflict-resolution — the census and the death certificate\n"
        "  disagree about County Kerry vs County Cork.\n"
        "---\n" + RESEARCHER
    )
    check_hand_back([], reply, HAND_BACK)


def test_owner_spelled_in_capitals_passes():
    check_hand_back([], GOOD.replace("conflict-resolution", "Conflict-Resolution", 1), HAND_BACK)


def test_a_separator_inside_the_caller_lines_splits_at_the_last_one():
    reply = "Notes\n---\nHand-back: conflict-resolution — birth county.\n---\n" + RESEARCHER
    check_hand_back([], reply, HAND_BACK)


def test_a_tool_call_fails():
    with pytest.raises(AssertionError, match="makes no tool call"):
        check_hand_back([WARNINGS_CALL], GOOD, HAND_BACK)


def test_no_owner_named_fails():
    reply = "Hand-back: this is a source conflict.\n---\n" + RESEARCHER
    with pytest.raises(AssertionError, match="never name conflict-resolution"):
        check_hand_back([], reply, HAND_BACK)


def test_owner_named_only_after_the_separator_fails():
    reply = (
        "Hand-back: this is a source conflict.\n---\n"
        "Two records disagree about where he was born.\n"
        "Next, conflict-resolution will compare them."
    )
    with pytest.raises(AssertionError, match="never name conflict-resolution"):
        check_hand_back([], reply, HAND_BACK)


def test_owner_named_on_both_sides_fails():
    reply = GOOD + "\nconflict-resolution will take it from here."
    with pytest.raises(AssertionError, match="named after the final"):
        check_hand_back([], reply, HAND_BACK)


def test_missing_separator_fails_on_its_own_message():
    reply = "Hand-back: conflict-resolution — birth county.\n" + RESEARCHER
    with pytest.raises(AssertionError, match="separator absent"):
        check_hand_back([], reply, HAND_BACK)


def test_empty_reply_fails_on_the_separator():
    with pytest.raises(AssertionError, match="separator absent"):
        check_hand_back([], "", HAND_BACK)


def test_a_markdown_rule_with_text_is_not_a_separator():
    reply = "Hand-back: conflict-resolution — birth county.\n--- end ---\n" + RESEARCHER
    with pytest.raises(AssertionError, match="separator absent"):
        check_hand_back([], reply, HAND_BACK)


def test_skips_without_the_hand_back_tag():
    with pytest.raises(pytest.skip.Exception):
        check_hand_back([WARNINGS_CALL], "", {"type": "positive", "tags": ["direct-arm"]})
