"""Direct tests for the search-records asks-permission-instead-of-executing
validator.

Same reason as test_search_records_pre1880_validator.py: pyproject.toml sets
testpaths = ["tests"], so nothing under validators/ is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

What it guards: issue #1642 Finding 3 (mercyokum) -- ut_search_records_
nickname_bitsie (v1_2026-08-13_13-13-43): the skill searched only "Bitsie
Jackson," logged the nil, then asked whether to try "Mary" instead of just
running it.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_no_permission_ask_before_mandated_lever as check,
)


TAGGED = {"tags": ["search", "nickname", "asks-permission-instead-of-executing"]}
UNTAGGED = {"tags": ["search", "nickname"]}


def rs_call(args, total_matches=0, results=None):
    response = {"totalMatches": total_matches}
    if results is not None:
        response["results"] = results
    return {"tool": "mcp__genealogy__record_search", "args": args, "response": response}


def test_untagged_test_skips():
    calls = [rs_call({"givenName": "Bitsie"})]
    with pytest.raises(pytest.skip.Exception):
        check(calls, "Should I try Mary instead?", UNTAGGED)


def test_two_calls_skips():
    calls = [rs_call({"givenName": "Bitsie"}), rs_call({"givenName": "Mary"}, total_matches=1)]
    with pytest.raises(pytest.skip.Exception):
        check(calls, "Found it.", TAGGED)


def test_positive_search_skips():
    calls = [rs_call({"givenName": "Bitsie"}, total_matches=3)]
    with pytest.raises(pytest.skip.Exception):
        check(calls, "Should I extract these?", TAGGED)


def test_single_nil_with_no_question_passes():
    """A nil with a plain report (no question) is fine on its own."""
    calls = [rs_call({"givenName": "Bitsie"})]
    check(calls, "No results for Bitsie Jackson. Logged as log_003.", TAGGED)


def test_single_nil_asking_permission_fails():
    """The real ut_search_records_nickname_bitsie miss: one nil search,
    then asking permission to try the mandated fallback instead of having
    already run it."""
    calls = [rs_call({"givenName": "Bitsie"})]
    text = "No results for Bitsie Jackson. Should I try the formal name Mary instead?"
    with pytest.raises(AssertionError) as e:
        check(calls, text, TAGGED)
    assert "Finding 3" in str(e.value)
