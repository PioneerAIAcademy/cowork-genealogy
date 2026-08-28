"""Direct tests for the search-records jurisdictionHints-followed validator.

Same reason as test_search_records_pre1880_validator.py: pyproject.toml sets
testpaths = ["tests"], so nothing under validators/ is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

What it guards: issue #1642 Finding 1 (mercyokum) -- when a record_search
response carries a non-empty jurisdictionHints, the next 1-2 record_search
calls must try the top-ranked candidate's place before reverting.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_jurisdiction_hints_followed as check,
)


TAGGED = {"tags": ["search", "marriage", "jurisdiction-hints-followed"]}
UNTAGGED = {"tags": ["search", "marriage"]}


def rs_call(args, response=None):
    return {"tool": "mcp__genealogy__record_search", "args": args, "response": response or {}}


def hint_response(place):
    return {
        "jurisdictionHints": {
            "searchedPlace": "Newberry, South Carolina",
            "candidates": [
                {"place": place, "earliestYear": 1850, "whose": "I2", "fromFact": "Residence"},
            ],
            "note": "...",
        }
    }


def test_no_calls_skips():
    with pytest.raises(pytest.skip.Exception):
        check([], TAGGED)


def test_untagged_test_skips():
    calls = [rs_call({"surname": "Neal"}, hint_response("Yell, Arkansas"))]
    with pytest.raises(pytest.skip.Exception):
        check(calls, UNTAGGED)


def test_no_hint_returned_skips():
    calls = [rs_call({"surname": "Neal"}, {})]
    with pytest.raises(pytest.skip.Exception):
        check(calls, TAGGED)


def test_hint_followed_by_matching_next_call_passes():
    """jurisdictionHints on call 1, and call 2 sets recordCountry to the
    top candidate's place -- the correct behavior."""
    calls = [
        rs_call({"surname": "Neal", "recordCountry": "South Carolina"}, hint_response("Yell, Arkansas")),
        rs_call({"surname": "Neal", "recordCountry": "Arkansas"}),
    ]
    check(calls, TAGGED)


def test_hint_followed_two_calls_later_passes():
    """The rule allows the NEXT 1-2 calls, not only the very next one."""
    calls = [
        rs_call({"surname": "Neal", "recordCountry": "South Carolina"}, hint_response("Yell, Arkansas")),
        rs_call({"surname": "Neal", "givenName": "James"}),
        rs_call({"surname": "Neal", "residencePlace": "Yell County, Arkansas"}),
    ]
    check(calls, TAGGED)


def test_hint_ignored_reverting_to_prior_jurisdiction_fails():
    """The real jimmie-jewel-neal miss: a jurisdictionHints candidate names
    Arkansas, and every subsequent call stays scoped to South Carolina --
    exactly the failure issue #1642 Finding 1 describes."""
    calls = [
        rs_call({"surname": "Neal", "recordCountry": "South Carolina"}, hint_response("Yell, Arkansas")),
        rs_call({"surname": "Neal", "recordCountry": "South Carolina", "givenName": "James"}),
        rs_call({"surname": "Neal", "recordCountry": "South Carolina", "givenName": "William"}),
    ]
    with pytest.raises(AssertionError) as e:
        check(calls, TAGGED)
    assert "Yell, Arkansas" in str(e.value)
