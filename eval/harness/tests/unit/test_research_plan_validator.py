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


def test_passes_when_name_and_date_both_present():
    """The intended pass case: the response names Patrick and his 1875 date."""
    response = (
        "Patrick Sheahan (I2) already has a sourced 1875 land purchase in "
        "Schuylkill County -- seven years before Michael's own documented "
        "arrival. Plan: 1880 census, 1900 census, church records."
    )
    check(BEFORE_STATE, response, TAGGED)  # does not raise


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
    assert "the person's given name does" in message


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


def test_skipped_when_no_sourced_fan_facts():
    """A tree with no already-sourced non-subject fact has nothing to
    check -- must skip, not pass vacuously by accident and not fail."""
    tree_no_sources = {
        "persons": [
            {"id": "I1", "names": [{"given": "Michael", "surname": "Sheahan"}]},
            {"id": "I2", "names": [{"given": "Patrick", "surname": "Sheahan"}]},
        ]
    }
    before_state = {"research_json": RESEARCH, "tree_gedcomx_json": tree_no_sources}
    response = "No mention of anyone."
    check(before_state, response, TAGGED)  # does not raise (nothing in scope)
