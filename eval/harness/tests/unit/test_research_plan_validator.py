"""Direct tests for research-plan's already-attached-FAN-facts validator
(issue #1948).

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and its real pass/fail set would otherwise appear only
inside a paid per-skill run.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research_plan import (  # noqa: E402
    test_survey_surfaces_already_attached_fan_facts as check,
)


TAGGED = {"tags": ["already-attached"]}
UNTAGGED = {"tags": ["planning"]}

RESEARCH = {"project": {"subject_person_ids": ["I1"]}}

TREE = {
    "persons": [
        {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
        {
            "id": "I2",
            "names": [{"given": "Patrick", "surname": "Sheahan"}],
            "facts": [
                {
                    "type": "Residence",
                    "date": "1875",
                    "place": "Schuylkill County, Pennsylvania",
                    "value": "Purchased land, Deed Book 42 p. 118",
                    "sources": [{"ref": "S1", "quality": 3}],
                }
            ],
        },
        {
            "id": "I3",
            "names": [{"given": "", "surname": "Sheahan"}],
        },
    ]
}

BEFORE_STATE = {"research_json": RESEARCH, "tree_gedcomx_json": TREE}


def test_fires_when_fact_never_surfaced():
    """Proves the check actually fails: a response that never mentions
    Patrick's already-sourced 1875 fact must raise."""
    response = (
        "Here is the plan for Michael Sheahan's move to Schuylkill County: "
        "1880 census, 1900 census, church records, naturalization."
    )
    with pytest.raises(AssertionError, match="I2"):
        check(BEFORE_STATE, response, TAGGED)


def test_passes_when_name_date_and_value_content_present():
    """The intended pass case: the response names Patrick, his 1875 date,
    and restates a fragment of the fact's own content (a deed book)."""
    response = (
        "Patrick Sheahan (I2) already has a sourced 1875 deed book entry "
        "for land in Schuylkill County -- seven years before Michael's own "
        "documented arrival. Plan: 1880 census, 1900 census, church records."
    )
    check(BEFORE_STATE, response, TAGGED)  # does not raise


def test_fires_when_new_search_proposed_using_the_same_year():
    """Reproduces the exact false positive found in a committed run during
    PR #2004 review (clack391): a FAN plan item's own search-window header
    happens to reuse the fact's year ("Schuylkill County -- 1875-1905") in
    the same paragraph as Patrick's name, while the response never restates
    what the source actually records and instead proposes searching to
    *discover* it ("if Patrick preceded Michael..."). Name+date proximity
    alone cannot tell "citing a known fact" apart from "a new search that
    happens to start near the same year" -- only the value-gram requirement
    catches this, which is why a fact's `value` is required, not just its
    date, whenever the fact has one."""
    response = (
        "### Item 8 -- FAN -- Patrick Sheahan (I2) records\n"
        "Schuylkill County, PA -- 1875-1905\n"
        "Patrick is already in the tree with source S1. If Patrick preceded "
        "Michael in the county, that would support chain migration; search "
        "his 1880/1900 census and church records to confirm."
    )
    with pytest.raises(AssertionError, match="I2"):
        check(BEFORE_STATE, response, TAGGED)


def test_fires_when_only_name_present_not_date():
    """A bare mention of the person's name (e.g. planning a redundant new
    search for them) does not count as surfacing the already-attached fact --
    this is the exact failure mode issue #1948 reported. Also proves the
    failure message accurately reports which condition is missing (PR #2004
    review, EdmondOware): this scenario has the name present and the date
    absent, so the message must not claim "neither" is present."""
    response = (
        "Plan includes a FAN item: search census records for Patrick Sheahan "
        "(I2) to corroborate the family's origin and timing."
    )
    with pytest.raises(AssertionError) as exc_info:
        check(BEFORE_STATE, response, TAGGED)
    message = str(exc_info.value)
    assert "I2" in message
    assert "neither" not in message.lower()
    assert "the person's given name appears" in message


TREE_SHORT_NAME = {
    "persons": [
        {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
        {
            "id": "I2",
            "names": [{"given": "Ann", "surname": "Sheahan"}],
            "facts": [
                {
                    "type": "Residence",
                    "date": "1868",
                    "place": "Schuylkill County, Pennsylvania",
                    "sources": [{"ref": "S1", "quality": 3}],
                }
            ],
        },
    ]
}
BEFORE_STATE_SHORT_NAME = {"research_json": RESEARCH, "tree_gedcomx_json": TREE_SHORT_NAME}


def test_name_and_date_present_but_unrelated_still_fails():
    """Proves the paragraph-proximity fix, found while re-measuring this
    validator for PR #2004: a real run's pre-plan narration happened to say
    "the 1875-1900 window" (an unrelated search-date range) before the plan
    ever mentioned Patrick. A whole-response substring check counted both
    "Patrick" and "1875" as present and called it surfaced; the judge
    correctly scored this run as a silent omission, since the two mentions
    were unrelated. The validator must require them in the same paragraph,
    not just the same response."""
    response = (
        "Discovering record collections for Schuylkill County in the "
        "1875-1900 window.\n\n"
        "Starting-point analysis: Michael Sheahan (I1) has zero attached "
        "sources. Patrick Sheahan (I2) holds source S1 in tree.gedcomx.json "
        "but no research.json source assertions."
    )
    with pytest.raises(AssertionError, match="I2"):
        check(BEFORE_STATE, response, TAGGED)


def test_short_name_substring_is_not_a_false_positive():
    """A short given name ('Ann') must not be treated as present just
    because it appears as a substring inside an unrelated word ('planning'
    contains 'ann'). Proves the word-boundary fix (PR #2004 review,
    EdmondOware): under the old plain-substring check this response would
    have wrongly counted as surfacing Ann's fact and the check would have
    passed silently even though nothing about Ann was actually said."""
    response = (
        "Plan for 1868 records: continue planning the census search and "
        "church record review for the family."
    )
    with pytest.raises(AssertionError, match="I2"):
        check(BEFORE_STATE_SHORT_NAME, response, TAGGED)


def test_skipped_when_not_tagged():
    """Untagged tests are not in scope -- must not raise even on a
    response that would otherwise fail."""
    response = "No mention of anyone."
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE_STATE, response, UNTAGGED)


def test_passes_vacuously_when_no_sourced_fan_facts():
    """A tree with no already-sourced non-subject fact has nothing to
    check -- must pass vacuously (nothing in scope), not fail. Named for
    what actually happens: the validator has no `pytest.skip()` branch for
    this case, it just finds nothing to add to `missed` (PR #2004 review,
    clack391 -- the previous name/docstring here claimed a skip that the
    code never performed)."""
    tree_no_sources = {
        "persons": [
            {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
            {"id": "I2", "names": [{"given": "Patrick", "surname": "Sheahan"}]},
        ]
    }
    before_state = {"research_json": RESEARCH, "tree_gedcomx_json": tree_no_sources}
    response = "No mention of anyone."
    check(before_state, response, TAGGED)  # does not raise (nothing in scope)


TREE_NONSTANDARD_DATE = {
    "persons": [
        {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
        {
            "id": "I2",
            "names": [{"given": "Patrick", "surname": "Sheahan"}],
            "facts": [
                {
                    "type": "Residence",
                    "date": "~1845",
                    "standard_date": "Abt 1845",
                    "place": "Schuylkill County, Pennsylvania",
                    "sources": [{"ref": "S1", "quality": 3}],
                }
            ],
        },
    ]
}
BEFORE_STATE_NONSTANDARD_DATE = {
    "research_json": RESEARCH,
    "tree_gedcomx_json": TREE_NONSTANDARD_DATE,
}


def test_extracted_year_matches_non_bare_year_date_formats():
    """The fact's date is `~1845` (approximate, not a bare year) -- of 113
    sourced facts with a date across the scenario corpus, only 9 are bare
    years (PR #2004 review, clack391's measurement). A literal `"~1845" in
    response` check fails against a response that naturally writes "about
    1845", so the check must extract and match the bare year too."""
    response = "Patrick Sheahan (I2) was born about 1845 in County Cork, per source S1."
    check(BEFORE_STATE_NONSTANDARD_DATE, response, TAGGED)  # does not raise


TREE_NO_DATE_HAS_VALUE = {
    "persons": [
        {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
        {
            "id": "I2",
            "names": [{"given": "Patrick", "surname": "Sheahan"}],
            "facts": [
                {
                    "type": "Occupation",
                    "value": "Coal miner, per 1880 census",
                    "place": "Schuylkill County, Pennsylvania",
                    "sources": [{"ref": "S1", "quality": 3}],
                }
            ],
        },
    ]
}
BEFORE_STATE_NO_DATE_HAS_VALUE = {
    "research_json": RESEARCH,
    "tree_gedcomx_json": TREE_NO_DATE_HAS_VALUE,
}


def test_passes_on_value_content_alone_when_fact_has_no_date():
    """`date` is optional in the schema (PR #2004 review, clack391): a
    sourced fact with no date at all previously failed unconditionally no
    matter what the response said. A fact with a `value` but no date must
    still be satisfiable -- by the value content alone."""
    response = "Patrick Sheahan (I2) is already documented as a coal miner in the tree."
    check(BEFORE_STATE_NO_DATE_HAS_VALUE, response, TAGGED)  # does not raise


TREE_NO_DATE_NO_VALUE = {
    "persons": [
        {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
        {
            "id": "I2",
            "names": [{"given": "Patrick", "surname": "Sheahan"}],
            "facts": [
                {
                    "type": "Residence",
                    "place": "Schuylkill County, Pennsylvania",
                    "sources": [{"ref": "S1", "quality": 3}],
                }
            ],
        },
    ]
}
BEFORE_STATE_NO_DATE_NO_VALUE = {
    "research_json": RESEARCH,
    "tree_gedcomx_json": TREE_NO_DATE_NO_VALUE,
}


def test_passes_vacuously_when_fact_has_neither_date_nor_value():
    """A sourced fact with neither a date nor a value has no fact-specific
    content to confirm was read -- it is out of scope, the same as a
    person with no sourced facts at all, not an unconditional fail. Must
    not raise even though the response never mentions Patrick."""
    response = "No mention of anyone."
    check(BEFORE_STATE_NO_DATE_NO_VALUE, response, TAGGED)  # does not raise
