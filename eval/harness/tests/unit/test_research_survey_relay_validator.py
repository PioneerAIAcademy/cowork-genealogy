"""Direct tests for `test_research.test_survey_handback_relay_has_no_completeness_claim`.

The validator runs only on a test tagged `every-mention-survey-relay`
(`ut_research_030`). Its "every mention" patterns fired on the router's own
dispatch narration ("searching ... for every Czelusniak mention"), which names the
search target, not a result: run 3 of the research run v55_2026-11-21_07-30-10
failed on exactly that. A search verb with "for every/all ..." as its target
passes; any wording that claims the mentions were found, covered or accounted for
still fails. `testpaths` excludes `validators/`, which is why these live here.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import (  # noqa: E402
    test_survey_handback_relay_has_no_completeness_claim as check,
)

TAGGED = {"skill": "research", "tags": ["routing", "every-mention-survey-relay"]}

RELAY = (
    "I searched the old Catholic parish books for Wójtowa, Pagorzyna and Lipinki for every "
    "time the surname Czelusniak appears. The search found 424 records carrying that name in "
    "total. None of the records found show a Czelusniak serving as a godparent or a witness, "
    "so this search would not have found it. The records also don't say which of the three "
    "parishes each one came from, so not finding one for Wójtowa or Pagorzyna on its own does "
    "not mean the surname never appears there."
)

SEARCH_TARGETS = [
    "Dispatching the indexed surname search across the Poland, Church Books collection for "
    "every Czelusniak mention.",
    "Dispatching the indexed surname survey — searching FamilySearch's Poland, Church Books "
    "collection for every Czelusniak entry across the Wójtowa, Pagorzyna and Lipinki parishes.",
    "Searching the index for all mentions of Czelusniak.",
    "I searched for every Czelusniak mention and the search found 424 records.",
    "Looking for every occurrence of the surname in the three parishes.",
    "I searched the books that hold the three parish registers for every Czelusniak mention.",
    "I'm searching the index, which has the old parish books, for every Czelusniak mention.",
    "I searched the collection that contains the three parishes for every Czelusniak mention.",
]

CLAIMS = [
    "The survey found every mention of Czelusniak.",
    "These 424 records are every occurrence of the surname.",
    "I searched the books and accounted for every mention of the surname.",
    "The index covers all the mentions of Czelusniak in the three parishes.",
    "We now have every Czelusniak mention in these parishes.",
    "The 424 hits give you a record for every Czelusniak mention in the three parishes.",
    "The survey now holds every Czelusniak mention in the three parishes.",
    "The survey is complete.",
    "This is a complete list of Czelusniak records.",
    "The search now has a record for every Czelusniak mention in the three parishes.",
    "The search gives you a hit for every Czelusniak mention.",
    "Searching is done: there is a record for every Czelusniak mention.",
    "Our search holds an entry for every mention of Czelusniak.",
    "The search accounts for every Czelusniak mention.",
    "The search yielded a record for every Czelusniak mention.",
    "The search produced a hit for every Czelusniak mention.",
    "The search brought back a record for every Czelusniak mention.",
    "The search shows a record for every Czelusniak mention.",
    "The search got a record for every Czelusniak mention.",
    "The survey now lists an entry for every Czelusniak mention.",
    "There is now a search hit for every Czelusniak mention.",
    "Search results now exist for every Czelusniak mention.",
    "The search yields hits for all the Czelusniak mentions.",
]


@pytest.mark.parametrize("narration", SEARCH_TARGETS)
def test_a_search_target_passes(narration):
    check(f"{narration}\n\n{RELAY}", TAGGED)


@pytest.mark.parametrize("claim", CLAIMS)
def test_a_completeness_claim_fails(claim):
    with pytest.raises(AssertionError, match="complete or claims every"):
        check(f"{RELAY}\n\n{claim}", TAGGED)


def test_the_committed_v55_run_3_reply_passes():
    check(
        "Dispatching the indexed surname search across the Poland, Church Books collection "
        f"for every Czelusniak mention.\n\n{RELAY}",
        TAGGED,
    )


def test_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check("The survey found every mention.", {"skill": "research", "tags": ["routing"]})
