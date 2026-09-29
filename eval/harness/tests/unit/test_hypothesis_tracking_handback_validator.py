"""Direct tests for the hypothesis-tracking Step 0 hand-back validator.

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/`
is collected by `make harness-test`; this file is where the validator's real
pass/fail set is pinned. It guards `ut_hypothesis_tracking_018`, which is
`grade_on_invariant`, so this validator is that test's whole verdict.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_hypothesis_tracking import (  # noqa: E402
    test_scope_handback_writes_nothing as check,
)

TEST = {"tags": ["scope-handback", "handback-to-conflict-resolution", "direct-arm"]}
STATE = {"research_json": {"hypotheses": [], "conflicts": []}}
REPLY = "Hand-back: conflict-resolution — this weighs a fact conflict, not a hypothesis."


def test_passes_a_clean_handback():
    check([], STATE, STATE, REPLY, TEST)


def test_passes_a_backticked_name_and_a_read_only_tool_call():
    calls = [{"tool": "mcp__genealogy__validate_research_schema", "args": {}}]
    check(calls, STATE, STATE, "Hand-back: `conflict-resolution` — a fact conflict.", TEST)


def test_fails_on_a_research_append_call():
    calls = [{"tool": "mcp__genealogy__research_append", "args": {"section": "hypotheses"}}]
    with pytest.raises(AssertionError, match="research_append"):
        check(calls, STATE, STATE, REPLY, TEST)


def test_fails_when_research_json_changed_without_a_writer_call():
    after = {"research_json": {"hypotheses": [{"id": "h_009"}], "conflicts": []}}
    with pytest.raises(AssertionError, match="unchanged"):
        check([], STATE, after, REPLY, TEST)


def test_fails_when_the_wrong_destination_is_named():
    with pytest.raises(AssertionError, match="Hand-back: conflict-resolution"):
        check([], STATE, STATE, "Hand-back: timeline — a timeline task.", TEST)


def test_fails_when_no_handback_line_is_written():
    with pytest.raises(AssertionError, match="no hand-back"):
        check([], STATE, STATE, "Please use conflict-resolution for this.", TEST)


def test_fails_on_an_empty_reply():
    with pytest.raises(AssertionError, match="no hand-back"):
        check([], STATE, STATE, "", TEST)


def test_fails_without_a_destination_tag():
    with pytest.raises(AssertionError, match="handback-to-"):
        check([], STATE, STATE, REPLY, {"tags": ["scope-handback"]})


def test_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check([], STATE, STATE, "", {"tags": ["direct-arm"]})
