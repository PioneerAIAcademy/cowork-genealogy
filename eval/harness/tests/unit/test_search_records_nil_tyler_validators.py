"""Direct tests for the search-records #4580 validators: a nil under tight
filters is not a death, and a candidate already found is not filtered out.

Same reason as test_search_records_children_unpinned_validator.py: nothing under
validators/ is collected by `make harness-test`, so each check is proven here in
both directions (CLAUDE.md, "A new lint must be proven to fail").
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    nil_death_inference,
    test_found_candidate_not_excluded as candidate_check,
    test_nil_not_read_as_death as nil_check,
)

NIL_TAGS = {"tags": ["search", "nil-no-death-inference", "nil-drops-surname"]}
CANDIDATE_TAGS = {"tags": ["search", "candidate-not-excluded"]}
UNTAGGED = {"tags": ["search"]}

TIGHT = {"surname": "Tyler", "sex": "Female", "birthYearFrom": 1848, "birthYearTo": 1858}


def rs(args, total=0):
    return {"tool": "mcp__genealogy__record_search", "args": args, "response": {"totalMatches": total}}


def returns(text):
    return [{"subagent_type": "search-records", "text": text}]


# --- the death-inference pattern -------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        # The session's own words (feedback #4510).
        "The absence of any later record strongly suggests she died between 1900 and approximately 1912.",
        "She probably died before 1910.",
        "Zero results across 1910-1930 indicates she was deceased by then.",
        "These nil searches imply her death occurred early in the decade.",
        "Likely deceased prior to 1920 given no records found.",
    ],
)
def test_death_inference_fires(text):
    assert nil_death_inference(text) is not None


@pytest.mark.parametrize(
    "text",
    [
        "No death record found under surname Tyler, female, born 1848–1858.",
        "Not found under surname Tyler, female, born 1848-1858, in the 1920 census.",
        "The 1923 death registration of Ann Tone Lightfoot (QVR7-5LJJ) is likely her: widowed, midwife, age 90.",
        "She died 29 October 1923 in Cunningham, per the death registration.",
        "The Lightfoot record suggests she died in 1923.",
        "Antone Lightfoot, born 1837, is a candidate needing review.",
        # A death-record search reported, not a death placed.
        "I searched Virginia death records between 1912 and 1940 and found no match.",
        "Death certificates by 1925 returned nothing under Tyler.",
    ],
)
def test_death_inference_accepts_correct_reporting(text):
    assert nil_death_inference(text) is None


# --- nil_check ------------------------------------------------------------------


def test_untagged_skips():
    with pytest.raises(pytest.skip.Exception):
        nil_check([rs(TIGHT)], returns("died before 1912"), "", UNTAGGED)


def test_session_shape_fails_on_surname():
    """Every later search kept Tyler (or a wildcard of it)."""
    calls = [rs(TIGHT), rs({**TIGHT, "residenceYearFrom": 1920}), rs({**TIGHT, "surname": "Tyl*"})]
    with pytest.raises(AssertionError, match="kept a surname that matches Tyler"):
        nil_check(calls, returns("Not found under surname Tyler."), "", NIL_TAGS)


def test_session_shape_fails_on_death_text():
    calls = [rs(TIGHT), rs({"givenName": "An*", "recordCountry": "United States", "otherSurname": "Lightfoot"}, 41)]
    reply = "Four empty searches strongly suggest she died between 1900 and approximately 1912."
    with pytest.raises(AssertionError, match="infers a death"):
        nil_check(calls, returns(reply), "", NIL_TAGS)


@pytest.mark.parametrize(
    "later",
    [
        {"givenName": "An*", "recordCountry": "United States", "otherGivenName": "Edward"},
        {"surname": "Lightfoot", "givenName": "An*", "residencePlace": "Fluvanna, Virginia"},
        {"givenName": "Ann", "recordCountry": "United States", "residenceYearFrom": 1910},
    ],
)
def test_dropping_tyler_passes(later):
    calls = [rs(TIGHT), rs(later, 41)]
    reply = (
        "Not found under surname Tyler, female, born 1848–1858. Without the surname, anchored on "
        "Edward Lightfoot, the 1910 census has Antone Lightfoot, born 1837 — a candidate needing review."
    )
    nil_check(calls, returns(reply), "", NIL_TAGS)


def test_a_tyler_hit_before_the_nil_does_not_count_as_the_nil():
    """A non-empty Tyler search is not the nil; the drop is graded after the first EMPTY one."""
    calls = [rs(TIGHT, 1), rs({"givenName": "An*", "recordCountry": "United States"}, 41), rs(TIGHT, 0)]
    with pytest.raises(AssertionError, match="kept a surname"):
        nil_check(calls, returns("Not found under surname Tyler."), "", NIL_TAGS)


def test_no_empty_tyler_search_fails_loudly():
    with pytest.raises(AssertionError, match="never reached the nil"):
        nil_check([rs({"surname": "Lightfoot"}, 5)], returns(""), "", NIL_TAGS)


# --- candidate_check ------------------------------------------------------------


def test_candidate_untagged_skips():
    with pytest.raises(pytest.skip.Exception):
        candidate_check([rs(TIGHT)], UNTAGGED)


@pytest.mark.parametrize(
    "args",
    [
        {"surname": "Tyler", "givenName": "An*", "birthYearFrom": 1848, "birthYearTo": 1858},  # log_100
        {"surname": "Tyler", "givenName": "An*", "birthYearFrom": "1843"},
        {"surname": "Tyler", "givenName": "An*", "birthYearTo": 1830},
    ],
)
def test_range_excluding_1833_fails(args):
    with pytest.raises(AssertionError, match="excludes 1833"):
        candidate_check([rs({"surname": "Tyler"}, 1), rs(args)], CANDIDATE_TAGS)


@pytest.mark.parametrize(
    "args",
    [
        {"surname": "Tyler", "givenName": "An*", "collectionId": "1438024"},
        {"surname": "Tyler", "givenName": "An*", "birthYearFrom": 1828, "birthYearTo": 1858},
        {"surname": "Tyler", "givenName": "An*", "birthYearFrom": "1833", "birthYearTo": "1833"},
        {"surname": "Tyler", "givenName": "An*", "birthYearTo": 1860},
    ],
)
def test_range_including_1833_passes(args):
    candidate_check([rs(args, 1)], CANDIDATE_TAGS)


def test_no_search_fails():
    with pytest.raises(AssertionError, match="no record_search"):
        candidate_check([], CANDIDATE_TAGS)


def refused(args):
    """A record_search call the tool refused for excluding a found candidate (#4580)."""
    return {
        "tool": "mcp__genealogy__record_search",
        "args": args,
        "response": {"error": "Refused: the birth range 1848–1858 excludes a candidate"},
        "matched": {"kind": "candidate_excluded_refused", "index": None},
    }


def test_a_refused_excluding_call_beside_an_including_one_passes():
    candidate_check(
        [refused({**TIGHT, "givenName": "An*"}), rs({"surname": "Tyler", "givenName": "An*", "birthYearFrom": 1830}, 1)],
        CANDIDATE_TAGS,
    )


def test_refused_calls_alone_fail_as_no_search():
    with pytest.raises(AssertionError, match="no record_search"):
        candidate_check([refused({**TIGHT, "givenName": "An*"}), refused(TIGHT)], CANDIDATE_TAGS)


def test_an_unrefused_excluding_call_beside_a_refused_one_still_fails():
    with pytest.raises(AssertionError, match="excludes 1833"):
        candidate_check([refused({**TIGHT, "givenName": "An*"}), rs({**TIGHT, "givenName": "Ann"})], CANDIDATE_TAGS)
