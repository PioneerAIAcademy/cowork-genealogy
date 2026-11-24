"""Direct tests for the search-records #4432 validator: a same-surname man no record
links to the subject is an unlinked lead, never a relative, flatly or hedged.

Nothing under validators/ is collected by `make harness-test`, so the check is
proven here in both directions (CLAUDE.md, "A new lint must be proven to fail").
The fail sentences are the feedback #4379 wording with the names swapped.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    UNLINKED_LEADS,
    test_unlinked_lead_states_no_kinship as lead_check,
    unlinked_lead_kinship,
)

LEAD = "Reuben"

OVERCLAIMS = [
    "Reuben is almost certainly Asa's brother, and his choice to name his own son Asa is consistent with that.",
    "Reuben is Asa's contemporary, most likely a brother, consistent with naming his son Asa after the sibling.",
    "Reuben Whitcomb is Asa's brother, not his son.",
    "Reuben Whitcomb, Asa's older brother, heads the 1790 household in Westmoreland.",
    "Reuben is probably a relative of Asa.",
    "Reuben is almost certainly Asa's older brother, though no record yet links them.",
    "Reuben may be Asa's uncle.",
    "Reuben is Asa's brother, though no record links them.",
    "Nothing in the census links them, but Reuben is almost certainly Asa's brother.",
    "No record names them together, yet Reuben is probably Asa's cousin.",
    "The 1790 census shows one Whitcomb household head in the county, Reuben Whitcomb of Westmoreland, who may be a relative of Asa, though the index does not say so.",
]

ALLOWED = [
    "Reuben Whitcomb heads a 1790 household in Westmoreland; no record connects him to Asa.",
    "The 1773 Keene birth names Reuben Whitcomb as father of an Asa Whitcomb, a different man from the subject.",
    "Nothing yet shows Reuben is his brother.",
    "A Westmoreland deed or probate could show whether Reuben is related to Asa.",
    "Reuben Whitcomb is not shown to be Asa's brother.",
    "No sibling of Asa was found. Reuben Whitcomb heads a household in Westmoreland.",
    "Asa's brother Ebenezer was not found in these records.",
    "The 1790 census did not record how Reuben was related to anyone in his household.",
    "Reuben is a candidate kin only, with no link to Asa established.",
]


@pytest.mark.parametrize("sentence", OVERCLAIMS)
def test_overclaim_is_caught(sentence):
    assert unlinked_lead_kinship(sentence, LEAD) == sentence


@pytest.mark.parametrize("sentence", ALLOWED)
def test_allowed_sentence_passes(sentence):
    assert unlinked_lead_kinship(sentence, LEAD) is None


def test_overclaim_inside_a_longer_return_is_found():
    text = "I searched Cheshire County births.\n\n" + OVERCLAIMS[1] + " The plan item stays in progress."
    assert unlinked_lead_kinship(text, LEAD) == OVERCLAIMS[1]


TAGGED = {"id": "ut_search_records_ull", "tags": ["search", "unlinked-lead-no-kinship"]}
UNTAGGED = {"id": "ut_search_records_020", "tags": ["search"]}


def state(notes=None):
    log = [] if notes is None else [{"id": "log_001", "tool": "record_search", "notes": notes}]
    return {"research_json": {"log": log}}


def returns(text):
    return [{"subagent_type": "search-records", "text": text}]


def test_tagged_run_with_an_overclaim_in_the_return_fails():
    with pytest.raises(AssertionError, match="ties Reuben"):
        lead_check(state(), state(), returns(OVERCLAIMS[0]), "", TAGGED)


def test_tagged_run_with_an_overclaim_in_a_log_note_fails():
    with pytest.raises(AssertionError, match="log entry log_001"):
        lead_check(state(), state(OVERCLAIMS[1]), returns(ALLOWED[0]), "", TAGGED)


def test_tagged_clean_run_passes():
    lead_check(state(), state(ALLOWED[0]), returns(" ".join(ALLOWED[:4])), "", TAGGED)


def test_untagged_run_skips():
    with pytest.raises(pytest.skip.Exception):
        lead_check(state(), state(), returns(OVERCLAIMS[0]), "", UNTAGGED)


def test_tag_and_map_must_agree():
    with pytest.raises(AssertionError, match="must agree"):
        lead_check(state(), state(), returns(""), "", {"id": "ut_search_records_020", "tags": ["unlinked-lead-no-kinship"]})
    with pytest.raises(AssertionError, match="must agree"):
        lead_check(state(), state(), returns(""), "", {"id": "ut_search_records_ull", "tags": ["search"]})


def test_every_mapped_test_exists_and_carries_the_tag():
    import json

    tests_dir = Path(__file__).resolve().parents[3] / "tests" / "unit" / "search-records"
    by_id = {}
    for path in tests_dir.glob("*.json"):
        body = json.loads(path.read_text(encoding="utf-8"))
        by_id[body["test"]["id"]] = body["test"]
    for test_id in UNLINKED_LEADS:
        assert test_id in by_id, f"{test_id} is in UNLINKED_LEADS but no test file has that id"
        assert "unlinked-lead-no-kinship" in by_id[test_id]["tags"]
