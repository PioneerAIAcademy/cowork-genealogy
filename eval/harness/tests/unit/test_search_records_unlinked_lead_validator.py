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
SUBJECT = "Asa"

OVERCLAIMS = [
    "Reuben is almost certainly Asa's brother, and his choice to name his own son Asa is consistent with that.",
    "Reuben is Asa's contemporary, most likely a brother, consistent with naming his son Asa after the sibling.",
    "Reuben Whitcomb is Asa's brother, not his son.",
    "The 1773 birth places Reuben's birth no later than ~1757, making him Asa Whitcomb of Westmoreland's contemporary or older brother, not his son.",
    "Reuben Whitcomb, Asa's older brother, heads the 1790 household in Westmoreland.",
    "Reuben is probably a relative of Asa.",
    "Reuben is almost certainly Asa's older brother, though no record yet links them.",
    "Reuben may be Asa's uncle.",
    "Reuben is Asa's brother, though no record links them.",
    "Nothing in the census links them, but Reuben is almost certainly Asa's brother.",
    "No record names them together, yet Reuben is probably Asa's cousin.",
    "No record links them, but Reuben is Asa's brother.",
    "The candidate Reuben Whitcomb is Asa's brother.",
    "Reuben's birthplace is unknown, but he is Asa's older brother.",
    "No record names them together and Reuben is probably Asa's cousin.",
    "Reuben is probably Asa's father.",
    "Reuben's household is likely Asa's family.",
    "Reuben is a possible relative of Asa.",
    "Reuben may be Asa's cousin, and the census is silent on it.",
    "The birth search and the 1790 census together point to a Reuben Whitcomb in Westmoreland as a possible kinsman — he named a son Asa (born 1773 in Keene) and was himself living in Westmoreland by 1790, the same town where our Asa died in 1784.",
    "- Reuben Whitcomb in Westmoreland is worth pursuing — his appearance in the same town where Asa died in 1784 makes him a plausible brother, father, or cousin.",
]

# Correct sentences from the agent's own replies on 2026-11-24 that an earlier version
# of the check failed: a kinship word about someone else, or inside a search to run.
REAL_REPLIES_ALLOWED = [
    "Key Finding: The only Whitcomb birth in Cheshire County during 1760–1785 is an Asa Whitcomb born 11 Mar 1773 in Keene to Reuben and Molly Towne Whitcomb — different parents, different town, ruled out as the subject or a sibling.",
    "The agent recommends searching for a Westmoreland or Keene record that names Asa's minor children or ties Reuben directly to Asa's family.",
    "A further search in other record types (probate, deeds, church records) could test whether Reuben was a brother, uncle, or other relative of the deceased Asa.",
    "Suggested next step: Search for records that could tie Reuben to Asa's minor children or to Asa's wife/marriage record — such as Cheshire County probate records for Asa's 1784 estate (which should name his widow, minor children, and possibly a guardian or surety who is a relative).",
    "- Use research-plan to decide how to test the Reuben Whitcomb household — for example, probate records for Asa's 1784 estate (which may name a guardian or kin), Westmoreland town records, or a wider Whitcomb birth search with alternate spellings or a wider date window.",
    "Read the full 1790 Reuben Whitcomb census entry — his household size might indicate adult sons or the age of dependents consistent with being Asa's brother or father.",
    "The 1790 schedule names only the head, so no household members or relations can be read from it. Reuben is a possible kin lead only; no record links him to Asa (d. 1784).",
    "No record links Reuben Whitcomb to Asa Whitcomb; treated as an unlinked lead, not as kin.",
    "The 1790 census shows one Whitcomb household head in the county, Reuben Whitcomb of Westmoreland, who may be a relative of Asa, though the index does not say so.",
    "Reuben is worth checking as a possible relative, but that needs an anchor such as a shared child or a later record, which the next step would look for.",
    "Anchor that would settle it: a record that names Asa Whitcomb with this Reuben, or a Westmoreland record tying this Reuben to Asa's family.",
    "Reuben is a possible kin lead only.",
]

# The pronoun shape: the lead is named in one sentence and the claim is made in the next.
PRONOUN_OVERCLAIM = (
    "Reuben Whitcomb heads a 1790 household in Westmoreland. "
    "He is most likely Asa's older brother, consistent with naming his son Asa."
)

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
    "A Westmoreland probate would likely show whether Reuben is related to Asa.",
    "Reuben is unlikely to be Asa's brother.",
    "Reuben Whitcomb heads a household in Westmoreland. He was enumerated in 1790 with no one else named.",
    "Reuben Whitcomb is the father of an Asa Whitcomb born in Keene in 1773.",
    "The record supports but does not alone prove that Reuben is Asa's father.",
    "The census cannot confirm that Reuben is Asa's brother.",
    "Reuben is a possible relative of Asa, but no record yet links the two.",
    "Reuben may be related to Asa, though no record connects them.",
    "- Next step: a search that can confirm or rule out Reuben's household as Asa's kin, such as an anchor on Asa's minor children or Asa's wife, or Asa's own birth or marriage record.",
    "The census places him in the town where Asa died (1784), and the 1773 Asa's father being named Reuben does not establish a link to the subject.",
]


@pytest.mark.parametrize("sentence", OVERCLAIMS)
def test_overclaim_is_caught(sentence):
    assert unlinked_lead_kinship(sentence, LEAD, SUBJECT) == sentence


@pytest.mark.parametrize("sentence", ALLOWED + REAL_REPLIES_ALLOWED)
def test_allowed_sentence_passes(sentence):
    assert unlinked_lead_kinship(sentence, LEAD, SUBJECT) is None


def test_overclaim_inside_a_longer_return_is_found():
    text = "I searched Cheshire County births.\n\n" + OVERCLAIMS[1] + " The plan item stays in progress."
    assert unlinked_lead_kinship(text, LEAD, SUBJECT) == OVERCLAIMS[1]


def test_a_claim_made_with_he_after_the_lead_is_named_is_caught():
    assert unlinked_lead_kinship(PRONOUN_OVERCLAIM, LEAD, SUBJECT).startswith("He is most likely")


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
