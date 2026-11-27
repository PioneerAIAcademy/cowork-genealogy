"""Direct tests for the search-records #4699 validator: a census nil under a
surname runs a surname-free search before "not found."

Same reason as test_search_records_nil_tyler_validators.py: nothing under
validators/ is collected by `make harness-test`, so the check is proven here
in both directions (CLAUDE.md, "A new lint must be proven to fail").
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_census_nil_runs_surname_free_search as census_check,
)

TAGGED = {"tags": ["search", "census", "census-nil-surname-free"]}
UNTAGGED = {"tags": ["search", "census"]}

SCHEDULES = [{"year": 1925, "census": "Iowa", "collectionId": "2224537"}]


def census_rs(args, total=0, schedules=True):
    response = {"totalMatches": total}
    if schedules:
        response["census"] = {"schedules": SCHEDULES}
    return {"tool": "mcp__genealogy__record_search", "args": args, "response": response}


def test_untagged_skips():
    with pytest.raises(pytest.skip.Exception):
        census_check([census_rs({"surname": "Buehner"})], UNTAGGED)


def test_no_census_nil_fails_loudly():
    """A census hit (totalMatches > 0) never reaches the nil this test grades."""
    with pytest.raises(AssertionError, match="never reached the nil"):
        census_check([census_rs({"surname": "Buehner"}, total=3)], TAGGED)


def test_surname_only_nil_with_no_drop_fails():
    calls = [
        census_rs({"surname": "Buehner", "recordCountry": "United States"}),
        census_rs({"surname": "Buchner", "recordCountry": "United States"}),
        census_rs({"surname": "Bu*ner", "recordCountry": "United States"}),
    ]
    with pytest.raises(AssertionError, match="kept a surname"):
        census_check(calls, TAGGED)


@pytest.mark.parametrize(
    "later",
    [
        {"givenName": "John", "recordCountry": "United States", "spouseGivenName": "Caroline"},
        {"recordCountry": "United States", "residencePlace": "Iowa", "otherGivenName": "Caroline"},
    ],
)
def test_dropping_surname_passes(later):
    calls = [
        census_rs({"surname": "Buehner", "recordCountry": "United States"}),
        census_rs(later, total=12),
    ]
    census_check(calls, TAGGED)


def test_a_hit_before_the_nil_does_not_count_as_the_nil():
    """A non-empty surname search is not the nil; the drop is graded after the first EMPTY one."""
    calls = [
        census_rs({"surname": "Buehner", "recordCountry": "United States"}, total=1),
        census_rs({"givenName": "John", "recordCountry": "United States"}, total=12),
        census_rs({"surname": "Buehner", "recordCountry": "United States"}, total=0),
    ]
    with pytest.raises(AssertionError, match="kept a surname"):
        census_check(calls, TAGGED)


def test_non_census_nil_does_not_count_as_the_trigger():
    """A surname-only nil with no `census.schedules` (not a collection the tool's own
    table covers) is an ordinary nil, not this rule's trigger — it must not be read as
    satisfying the requirement on its own, nor fail the test for keeping a surname after
    it, when no genuine census nil exists."""
    calls = [census_rs({"surname": "Buehner", "recordCountry": "United States"}, schedules=False)]
    with pytest.raises(AssertionError, match="never reached the nil"):
        census_check(calls, TAGGED)
