"""Direct tests for the historical-context no-results-attribution validator
(report_confident_no_results_attribution, issue #2331).

Same reason as test_search_full_text_validator.py: pyproject.toml sets
testpaths = ["tests"], so nothing under validators/ is collected by
make harness-test, and without this file the check runs its real pass/fail
set only inside a paid eval run. Firing cases are drawn from committed run
logs (traceable back to the exact run that produced the defect).
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_historical_context import (  # noqa: E402
    report_confident_no_results_attribution as check_confident_attribution,
)


NO_RESULTS_TEST = {"tags": ["no-results", "error-handling", "citation", "issue-1663"]}


# --- Firing cases (from committed run logs) -------------------------------

# v1_2026-08-24_21-38-52, ut_historical_context_014 (outcome: partial).
# The response presented "This is the most likely explanation" as confident
# attribution of why Hollow Creek Settlement is hard to find.
EXCERPT_08_24 = (
    "### 1. It Was Never an Official Place Name\n\n"
    "This is the most likely explanation, and the most important one to "
    "internalize. **\u201cSettlement\u201d was a colloquial, neighborhood-level "
    "label** \u2014 not a legal jurisdiction, incorporated town, or post office "
    "designation."
)

# v1_2026-08-28_10-17-44, ut_historical_context_014 (outcome: partial).
# The response used all four confident-attribution patterns:
# "most likely explanations", "ordered by probability", "(most likely)",
# "is almost certainly a colloquial place name".
EXCERPT_08_28 = (
    "The most important thing to understand first: **\u201cHollow Creek "
    "Settlement\u201d is almost certainly a colloquial place name, not an "
    "official jurisdiction.** Neither the FamilySearch wiki nor Wikipedia "
    "has any entry for it.\n\n"
    "Here are the most likely explanations for your difficulty, ordered by "
    "probability:\n\n"
    "---\n\n"
    "### 1. The name itself never existed in official records *(most likely)*\n\n"
    "Small rural settlements were commonly known by local or family names."
)


def test_fires_on_run_2026_08_24():
    """v1_2026-08-24_21-38-52: 'the most likely explanation'."""
    with pytest.raises(AssertionError) as exc:
        check_confident_attribution(EXCERPT_08_24, NO_RESULTS_TEST)
    assert "most likely explanation" in str(exc.value)


def test_fires_on_run_2026_08_28():
    """v1_2026-08-28_10-17-44: all four attribution phrases."""
    with pytest.raises(AssertionError) as exc:
        check_confident_attribution(EXCERPT_08_28, NO_RESULTS_TEST)
    msg = str(exc.value)
    # One assertion per alternative, not an `or`: with `or` the first phrase
    # carried the test on its own and the other three could be deleted from
    # `CONFIDENT_ATTRIBUTION_RE` with the file still green. All four occur in
    # this excerpt verbatim, and each fires on a committed run of
    # `ut_historical_context_014` (#2639 review).
    assert "most likely explanations" in msg
    assert "ordered by probability" in msg
    assert "(most likely)" in msg
    assert "is almost certainly" in msg


# --- Passing cases (from committed run logs) ------------------------------

# v1_2026-09-07_12-40-06, ut_historical_context_014 (outcome: pass).
# Contains bare "rank" ("I can't rank the causes"), bare "likely" ("likely
# never had its own index entry"), and numbered items -- none of which are
# confident attribution.
EXCERPT_09_07 = (
    "Since no tool confirmed this specific place, I can\u2019t rank the "
    "causes that follow \u2014 but these are the general possibilities that "
    "apply to settlements of this type:\n\n"
    "**1. The name was never an official jurisdiction**\n"
    "If \u201cHollow Creek Settlement\u201d had no civil government of its own, "
    "it produced no records of its own.\n\n"
    "**2. County boundary changes may have shuffled records across "
    "jurisdictions**\n\n"
    "4. **Search by surname, not by settlement name.** In county deed books, "
    "probate records, and court minutes, index by the individual\u2019s name "
    "\u2014 not by a settlement that likely never had its own index entry."
)

# v1_2026-09-11_21-47-54, ut_historical_context_014 (outcome: pass).
# Contains "ranked" ("rather than a ranked or confident list") and "almost
# certainly" ("records almost certainly *do* exist") -- but neither matches
# the confident-attribution regex.
EXCERPT_09_11 = (
    "since no tool returned content about this specific place, I\u2019ll "
    "present the possible explanations as general possibilities rather than "
    "a ranked or confident list, and I\u2019ll lead with the most important "
    "practical check.\n\n"
    "This means the settlement\u2019s records almost certainly *do* exist "
    "\u2014 they\u2019re just filed under a county, township, or civil district "
    "name that your ancestor\u2019s family knew as home."
)


def test_stays_silent_on_run_2026_09_07():
    """v1_2026-09-07_12-40-06: bare 'rank', bare 'likely', numbered list."""
    check_confident_attribution(EXCERPT_09_07, NO_RESULTS_TEST)


def test_stays_silent_on_run_2026_09_11():
    """v1_2026-09-11_21-47-54: 'ranked' and 'almost certainly' without 'is'."""
    check_confident_attribution(EXCERPT_09_11, NO_RESULTS_TEST)


# --- Edge cases -----------------------------------------------------------

def test_skips_when_no_results_tag_absent():
    with pytest.raises(pytest.skip.Exception):
        check_confident_attribution(EXCERPT_08_24, {"tags": ["citation"]})


def test_skips_on_empty_response():
    with pytest.raises(pytest.skip.Exception):
        check_confident_attribution("", NO_RESULTS_TEST)


def test_fires_on_a_capitalised_match():
    """`re.IGNORECASE` is load-bearing, and nothing else here pins it.

    Every excerpt above happens to be lowercase at the match site, so dropping
    the flag left the file green (#2639 review). Capitalisation is not
    hypothetical: a committed run of `ut_historical_context_014` writes
    "Ordered by" with a capital O, and both firing runs use `###` headings,
    where title case is ordinary output from this skill.
    """
    with pytest.raises(AssertionError):
        check_confident_attribution(
            "Ordered by Likelihood, the candidate causes are:", NO_RESULTS_TEST
        )
    with pytest.raises(AssertionError):
        check_confident_attribution(
            "Most likely explanations for the gap:", NO_RESULTS_TEST
        )


def test_stays_silent_on_hedged_response():
    hedged = (
        "One possible reason is that the place name was purely colloquial. "
        "Another reason could be county boundary changes. "
        "It is also possible that a courthouse fire destroyed the records."
    )
    check_confident_attribution(hedged, NO_RESULTS_TEST)
