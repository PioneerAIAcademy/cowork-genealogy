"""Direct tests for the search-records pre-1880 census household validator.

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

What it guards: SKILL.md Step 4's rule that 1850/1860/1870 US censuses carry no
"relationship to head" column, so a log note describing such a household must
mark the family structure inferred rather than stated. Every `notes` string
below is quoted from a committed `search-records` run log, so these tests pin
the validator to phrasing the skill has actually produced rather than to
phrasing invented to suit it (issue #1284).
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_pre1880_census_structure_marked_inferred as check,
)


TAGGED = {"tags": ["search", "census", "1850", "pre-1880-census-household"]}
UNTAGGED = {"tags": ["search", "census", "1880"]}

EMPTY_BEFORE = {"research_json": {"log": []}}


def after(*entries):
    return {"research_json": {"log": list(entries)}}


def entry(notes, outcome="positive", tool="record_search", eid="log_005"):
    return {"id": eid, "tool": tool, "outcome": outcome, "notes": notes}


# --- Notes the rule accepts (from runs that carried the marker) -------

# ut_search_records_001, run v1_2026-08-17_18-06-27.
COMPLIANT_HEDGED = (
    "Fresh search - Flynn spelling, Schuylkill County residence, 1850 census "
    "year. One strong match: Patrick Flynn (MXHY-TP4), born 1845 Ireland, "
    "residing Branch Township, Schuylkill Co., PA in a household alongside "
    "Thomas Flynn and Mary Flynn. matchScore 0.9481. Not yet attached to "
    "subject. Pre-1880 census - head/parent relationships are indexer "
    "inferences from surname, age, and listing order, not a stated column in "
    "the record."
)

# ut_search_records_010, same run - "inferred, not stated" rather than
# "inferences".
COMPLIANT_INFERRED = (
    "Top-ranked match: Patrick Flynn (MXHY-TP4) ... Household includes Thomas "
    "Flynn (male) and Mary Flynn (female) with indexer-inferred ParentChild "
    "relationships - pre-1880 census has no relationship column, so family "
    "structure is inferred, not stated."
)

# ut_search_records_014, same run. Asserts the role in the quoted form,
# 'Indexed as "Head"', and hedges it - this is what the quote tolerance in
# _ROLE_ASSERTIONS exists for.
COMPLIANT_QUOTED_ROLE = (
    '1 result: Patrick Flynn, born 1845, Ireland, residing Branch Township, '
    'Schuylkill, PA in 1850. matchScore 0.85. Indexed as "Head" - but subject '
    "born ~1845 would be ~5 in 1850; role assignment is the indexer's "
    "inference in this pre-1880 census (no relationship column), likely an "
    "indexing error."
)


# --- Notes the rule rejects (from runs that carried no marker) --------

# ut_search_records_015, all four committed run logs. The prohibited form
# outright: roles asserted flat off an 1860 census, then used to corroborate
# tree parents.
OFFENDER_AS_FATHER_AS_MOTHER = (
    'Strong match (score 0.93): "Sarah A. Mullen in household of William '
    'Mullen," 1860 census, Dodge County, Wisconsin. Household includes '
    "William Mullen (b. 1825, Ireland) as father and Margaret Mullen (b. "
    "1830, Ireland) as mother - directly corroborates tree stubs I4 and I5."
)

# ut_search_records_013, run v1_2026-08-17_18-06-27.
OFFENDER_HOUSEHOLD_HEAD = (
    "Found 1 result: Patrick Flyn (indexed spelling) in household of Thomas "
    "Flyn, Branch Township, Schuylkill, Pennsylvania. Household head Thomas "
    "Flyn aligns with known father I2. matchScore 0.52, matchConfidence 4."
)

# ut_search_records_012, run v1_2026-08-17_18-06-27. Carries no role word at
# all - but it lists the household, which is the thing the rule asks to be
# qualified.
OFFENDER_BARE_LISTING = (
    "Top match MXHY-TP4 scores 0.948 against I1 and is already attached to "
    "subject. Record: Patrick Flynn, born 1845, Ireland, residing Branch "
    "Township, Schuylkill, Pennsylvania, 1850, in household of Thomas Flynn "
    "and Mary Flynn."
)


@pytest.mark.parametrize(
    "notes",
    [COMPLIANT_HEDGED, COMPLIANT_INFERRED, COMPLIANT_QUOTED_ROLE],
    ids=["inferences-not-stated", "inferred-no-column", "quoted-role"],
)
def test_a_hedged_household_passes(notes):
    check(EMPTY_BEFORE, after(entry(notes)), TAGGED)


@pytest.mark.parametrize(
    "notes",
    [
        OFFENDER_AS_FATHER_AS_MOTHER,
        OFFENDER_HOUSEHOLD_HEAD,
        OFFENDER_BARE_LISTING,
    ],
    ids=["as-father-as-mother", "household-head", "bare-listing"],
)
def test_an_unqualified_household_fails(notes):
    """The whole point. Each of these passed its test on the run log it came
    from, because no dimension and no validator read the phrasing."""
    with pytest.raises(AssertionError) as e:
        check(EMPTY_BEFORE, after(entry(notes)), TAGGED)
    assert "log_005" in str(e.value)


def test_the_untagged_rest_of_the_suite_is_untouched():
    """Gated on the tag, not on the word "census": ut_search_records_016 is an
    1880 search, where the relationship column does exist."""
    with pytest.raises(pytest.skip.Exception):
        check(EMPTY_BEFORE, after(entry(OFFENDER_BARE_LISTING)), UNTAGGED)


def test_a_nil_search_has_no_household_to_qualify():
    """ut_search_records_015's Price and Mielke arms: a nil explains why
    nothing was found, and must not be asked to hedge a household it never
    saw."""
    nil = entry(
        "Expected nil - Price is Sarah's first married name (married 1872); "
        "she would have been 8 years old in 1860 and still carried the Mullen "
        "birth surname. No index entry found under Price in the 1860 census.",
        outcome="negative",
    )
    check(EMPTY_BEFORE, after(nil), TAGGED)


def test_a_note_that_describes_no_household_passes():
    """The requirement fires on describing the household, not on the test
    carrying the tag - a note about the focus person alone asserts no
    structure."""
    check(
        EMPTY_BEFORE,
        after(entry(
            "1 result: Patrick Flyn, born 1842, Ireland, Branch Township, "
            "Schuylkill, Pennsylvania. matchScore 0.52. Birth year 3 years "
            "off the tree estimate."
        )),
        TAGGED,
    )


def test_a_tree_side_relative_is_not_a_record_side_role_claim():
    """ut_search_records_027's search anchor. Naming the spouse the search was
    built around - and saying she is absent from the record - is not a claim
    about what the census stated, so the bare role word must not trigger on
    its own. (027's real note fails anyway, on "Household persons"; this pins
    the reason to the household listing, not to "wife Catherine".)"""
    check(
        EMPTY_BEFORE,
        after(entry(
            "Ad-hoc spouse-anchored search: 1860 US Census, George Ackerman + "
            "wife Catherine, Pennsylvania. One result (matchScore 0.9412). "
            "relativeTerms.spouse.status = absent: Catherine is NOT named as "
            "spouse in this indexed record."
        )),
        TAGGED,
    )


def test_only_record_search_entries_are_checked():
    """A log entry from another tool has no census household behind it."""
    check(
        EMPTY_BEFORE,
        after(entry(OFFENDER_BARE_LISTING, tool="fulltext_search")),
        TAGGED,
    )


def test_a_missing_notes_field_does_not_crash():
    check(EMPTY_BEFORE, after(entry(None)), TAGGED)


def test_a_pre_existing_entry_is_not_re_judged():
    """Only the entries this run added are the run's responsibility."""
    old = entry(OFFENDER_BARE_LISTING, eid="log_001")
    check({"research_json": {"log": [old]}}, {"research_json": {"log": [old]}}, TAGGED)


def test_every_offending_entry_is_named_not_just_the_first():
    """The message is what a genealogist reads to fix the run, so it carries
    each offender rather than stopping at the first."""
    with pytest.raises(AssertionError) as e:
        check(
            EMPTY_BEFORE,
            after(
                entry(OFFENDER_BARE_LISTING, eid="log_005"),
                entry(OFFENDER_HOUSEHOLD_HEAD, eid="log_006"),
            ),
            TAGGED,
        )
    assert "log_005" in str(e.value)
    assert "log_006" in str(e.value)
