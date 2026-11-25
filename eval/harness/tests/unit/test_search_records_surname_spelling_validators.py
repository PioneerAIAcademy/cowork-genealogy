"""Direct tests for the search-records #4777 validator: a written-out surname
spelling before FamilySearch is called exhausted.

Same reason as test_search_records_census_nil_validators.py: nothing under
validators/ is collected by `make harness-test`, so the check is proven here
in both directions (CLAUDE.md, "A new lint must be proven to fail").
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_surname_spelling_before_escalation as surname_check,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
TEST_PATH = REPO_ROOT / "eval/tests/unit/search-records/surname-spelling-before-escalation.json"
TEST = json.loads(TEST_PATH.read_text(encoding="utf-8"))["test"]

HAND_BACK = (
    "Searched FamilySearch marriages for Charles Renhard; nothing found.\n"
    "Hand-back: search-external-sites — FamilySearch variants exhausted; Charles "
    "Renhard, marriage, England 1895-1897, pli_001, userPresent: yes"
)
FOUND = "Charles Rheinhardt married 22 June 1896 in Lancashire; a candidate for review."


def rs(surname, given="Charles"):
    return {
        "tool": "mcp__genealogy__record_search",
        "args": {"surname": surname, "givenName": given, "recordCountry": "England"},
        "response": {"totalMatches": 5},
    }


def close(status):
    return {
        "tool": "mcp__genealogy__research_append",
        "input": {
            "section": "plan_items",
            "op": "update",
            "planId": "pl_001",
            "entryId": "pli_001",
            "fields": {"status": status},
        },
    }


def returns(text):
    return [{"subagent_type": "search-records", "text": text}]


def test_the_test_file_carries_the_tag():
    assert "surname-spelling-before-escalation" in TEST["tags"]


def test_untagged_skips():
    with pytest.raises(pytest.skip.Exception):
        surname_check([rs("Renhard")], returns(HAND_BACK), "", {"id": "x", "tags": []})


def test_planted_escalation_after_charls_alone_fails():
    """The #4743 transcript: Renhard, then the given-name variant Charls, then the hand-back."""
    calls = [rs("Renhard"), rs("Renhard", given="Charls"), close("in_progress")]
    with pytest.raises(AssertionError, match="handed FamilySearch back as exhausted"):
        surname_check(calls, returns(HAND_BACK), "", TEST)


def test_wildcard_is_not_a_spelling():
    calls = [rs("Renhard"), rs("R*nh*rd"), rs("Renhard*")]
    with pytest.raises(AssertionError, match="handed FamilySearch back as exhausted"):
        surname_check(calls, returns(HAND_BACK), "", TEST)


def test_case_and_punctuation_are_not_a_spelling():
    calls = [rs("Renhard"), rs("RENHARD"), rs("Ren-hard")]
    with pytest.raises(AssertionError, match="handed FamilySearch back as exhausted"):
        surname_check(calls, returns(HAND_BACK), "", TEST)


def test_plan_item_closed_before_the_variant_fails():
    calls = [rs("Renhard"), close("skipped"), rs("Reinhard")]
    with pytest.raises(AssertionError, match="plan item was closed"):
        surname_check(calls, returns(FOUND), "", TEST)


def test_no_variant_and_no_hand_back_still_fails():
    """A run that stops on "not found" without naming a hand-back never reached the index's spelling."""
    calls = [rs("Renhard"), rs("Renhard", given="Charls")]
    with pytest.raises(AssertionError, match="no record_search spelled the surname"):
        surname_check(calls, returns("No marriage found for Charles Renhard."), "", TEST)


@pytest.mark.parametrize("variant", ["Reinhard", "Rheinhardt", "rennard"])
def test_written_out_variant_before_hand_back_passes(variant):
    calls = [rs("Renhard"), rs("Renhard", given="Charls"), rs(variant), close("in_progress")]
    surname_check(calls, returns(HAND_BACK), "", TEST)


def test_variant_that_finds_him_passes():
    calls = [rs("Renhard"), rs("Reinhard"), close("in_progress")]
    surname_check(calls, returns(FOUND), "", TEST)


def test_falls_back_to_text_response():
    calls = [rs("Renhard"), rs("Renhard", given="Charls")]
    with pytest.raises(AssertionError, match="handed FamilySearch back as exhausted"):
        surname_check(calls, [], HAND_BACK, TEST)
