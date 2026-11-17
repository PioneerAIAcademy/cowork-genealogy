"""Direct tests for `test_census_search_answer_carried_census_block`.

Nothing under validators/ is collected by `make harness-test`, so without this
file the check would ship unexecuted. Both directions: a census search answered
without the block fails, in each shape that can happen, and each legitimate
shape passes or skips.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

import test_search_records as mod  # noqa: E402

check = mod.test_census_search_answer_carried_census_block

TEST_ID = "ut_search_records_d02"
TAGGED = {"id": TEST_ID, "tags": ["search", "census-search"]}
BLOCK = {"schedules": [{"year": 1850, "census": "United States", "collectionId": "1401638"}], "note": "n"}


def _search(response, tool="mcp__genealogy__record_search", **args):
    return {"tool": tool, "args": {"surname": "Flynn", "projectPath": "/tmp/x", **args}, "response": response}


def test_a_census_search_answered_without_the_block_fails():
    with pytest.raises(AssertionError) as e:
        check([_search({"totalMatches": 1, "results": [{}]})], TAGGED)
    assert "census" in str(e.value)
    assert "projectPath" not in str(e.value)


def test_a_nil_search_without_the_block_fails():
    with pytest.raises(AssertionError):
        check([_search({"totalMatches": 0, "results": []})], TAGGED)


def test_a_block_on_another_tool_does_not_count():
    calls = [
        _search({"totalMatches": 1, "results": [{}]}),
        {"tool": "mcp__genealogy__record_read", "args": {}, "response": {"census": BLOCK}},
    ]
    with pytest.raises(AssertionError):
        check(calls, TAGGED)


def test_a_block_on_any_one_search_passes():
    calls = [
        _search({"totalMatches": 0, "results": []}),
        _search({"totalMatches": 1, "census": BLOCK, "results": [{}]}, recordType="census"),
    ]
    check(calls, TAGGED)


def test_an_empty_schedule_list_still_counts_as_the_block():
    check([_search({"totalMatches": 0, "census": {"schedules": [], "indexedYears": [1855], "note": "n"}, "results": []})], TAGGED)


def test_the_bridged_and_bare_spellings_pass():
    for tool in ("mcp__remote-devices__Genealogy_Research__record_search", "mcp__Genealogy_Research__record_search"):
        check([_search({"census": BLOCK, "results": []}, tool=tool)], TAGGED)


def test_an_untagged_test_skips():
    with pytest.raises(pytest.skip.Exception):
        check([_search({"results": []})], {"id": "ut_search_records_021", "tags": ["search"]})


def test_no_search_skips():
    with pytest.raises(pytest.skip.Exception):
        check([], TAGGED)


def test_only_refused_searches_skip():
    with pytest.raises(pytest.skip.Exception):
        check([_search({"error": "fixture_not_found"})], TAGGED)


def test_a_listed_test_that_lost_its_tag_fails():
    with pytest.raises(AssertionError) as e:
        check([_search({"census": BLOCK, "results": []})], {"id": TEST_ID, "tags": ["search"]})
    assert "census-search" in str(e.value)


def test_a_tagged_test_missing_from_the_list_fails():
    with pytest.raises(AssertionError) as e:
        check([_search({"census": BLOCK, "results": []})], {"id": "ut_search_records_zzz", "tags": ["census-search"]})
    assert "_CENSUS_SEARCH_TEST_IDS" in str(e.value)
