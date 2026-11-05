"""Direct tests for the search-records children-enumeration-unpinned validator.

Same reason as test_search_records_pre1880_validator.py: pyproject.toml sets
testpaths = ["tests"], so nothing under validators/ is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

What it guards: issue #3948 (maria-stockburger-son) -- a children enumeration
runs at least one parent-name record_search with no collectionId.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_children_enumeration_unpinned as check,
)


TAGGED = {"tags": ["search", "children-enumeration-unpinned"]}
UNTAGGED = {"tags": ["search"]}

PARENTS = {
    "fatherGivenName": "Johann Georg",
    "fatherSurname": "Meyer",
    "motherGivenName": "Maria Dorothea",
    "motherSurname": "Stockburger",
    "recordCountry": "Germany",
}


def rs_call(args, is_error=False, tool="mcp__genealogy__record_search"):
    return {"tool": tool, "args": args, "response": {}, "is_error": is_error}


def test_untagged_test_skips():
    with pytest.raises(pytest.skip.Exception):
        check([rs_call({**PARENTS, "collectionId": "3015626"})], UNTAGGED)


def test_pinned_only_fails():
    """The tester's run: every children search pinned to 3015626 or 1395660."""
    calls = [
        rs_call({**PARENTS, "collectionId": "3015626", "birthPlace": "Sankt Georgen, Baden"}),
        rs_call({**PARENTS, "collectionId": "3015626"}),
        rs_call({**PARENTS, "collectionId": "1395660"}),
    ]
    with pytest.raises(AssertionError) as e:
        check(calls, TAGGED)
    assert "3015626" in str(e.value) and "1395660" in str(e.value)


def test_pin_to_the_right_collection_still_fails():
    """A pin to 1473000 reaches the four children, but it is still a pin: the
    rule requires the unpinned search."""
    with pytest.raises(AssertionError):
        check([rs_call({**PARENTS, "collectionId": "1473000"})], TAGGED)


def test_batch_pin_fails():
    """batchNumber pins a search to one source, as collectionId does."""
    with pytest.raises(AssertionError) as e:
        check([rs_call({**PARENTS, "batchNumber": "C99999-1"})], TAGGED)
    assert "batchNumber=C99999-1" in str(e.value)


@pytest.mark.parametrize("field", ["birthPlace", "residencePlace", "anyPlace"])
def test_unpinned_but_place_anchored_fails(field):
    """No collection, but a Villingen place: Andreas, indexed under
    'Sankt Georgen, Freiburg', is still missed."""
    calls = [rs_call({**PARENTS, field: "Sankt Georgen im Schwarzwald, Villingen, Baden"})]
    with pytest.raises(AssertionError) as e:
        check(calls, TAGGED)
    assert field in str(e.value)


def test_place_on_pinned_search_does_not_count_against_unpinned_one():
    """A place on a pinned search is fine; only the unpinned search must be place-free."""
    calls = [
        rs_call({**PARENTS, "collectionId": "3015626", "birthPlace": "Oberkirnach"}),
        rs_call(dict(PARENTS)),
    ]
    check(calls, TAGGED)


def test_empty_place_counts_as_place_free():
    check([rs_call({**PARENTS, "birthPlace": "", "anyPlace": None})], TAGGED)


def test_no_parent_name_search_fails():
    calls = [rs_call({"surname": "Meyer", "recordCountry": "Germany"})]
    with pytest.raises(AssertionError) as e:
        check(calls, TAGGED)
    assert "named a parent" in str(e.value)


def test_no_calls_fails():
    with pytest.raises(AssertionError):
        check([], TAGGED)


def test_unpinned_search_after_pinned_passes():
    """The new rule: a pinned search may come first, as long as the unpinned one runs."""
    calls = [
        rs_call({**PARENTS, "collectionId": "3015626"}),
        rs_call(dict(PARENTS)),
    ]
    check(calls, TAGGED)


def test_unpinned_mother_names_only_passes():
    """The issue's legitimate variant: only the mother's names, no collectionId."""
    calls = [rs_call({"motherGivenName": "Maria Dorothea", "motherSurname": "Stockburger", "recordCountry": "Germany"})]
    check(calls, TAGGED)


def test_empty_collection_id_counts_as_unpinned():
    check([rs_call({**PARENTS, "collectionId": ""})], TAGGED)


def test_refused_unpinned_call_does_not_count():
    calls = [
        rs_call({**PARENTS, "collectionId": "3015626"}),
        rs_call(dict(PARENTS), is_error=True),
    ]
    with pytest.raises(AssertionError):
        check(calls, TAGGED)


@pytest.mark.parametrize(
    "tool",
    ["record_search", "mcp__genealogy__record_search", "mcp__Genealogy_Research__record_search"],
)
def test_every_tool_spelling_counts(tool):
    check([rs_call(dict(PARENTS), tool=tool)], TAGGED)


def test_stringified_args_are_read():
    """A model may serialize the arguments object as a JSON string."""
    import json

    check([rs_call(json.dumps(PARENTS))], TAGGED)
