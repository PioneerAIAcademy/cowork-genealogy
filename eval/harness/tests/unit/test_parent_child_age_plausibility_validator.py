"""Direct tests for the universal parent-child age-plausibility validator.

Same reason as test_search_records_pre1880_validator.py: pyproject.toml sets
testpaths = ["tests"], so nothing under validators/ is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears
only inside a paid per-skill run.

What it guards: issue #1642 Finding 2 (mercyokum) -- a new ParentChild
relationship in tree.gedcomx.json implying an implausible parent age at the
child's birth must carry an uncertainty note. Bounds reused from
person-warnings.ts, not invented (see the validator's own module comment for
the exact figures and the known female-lower-bound gap this inherits).
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_universal import (  # noqa: E402
    test_parent_child_age_plausibility_flagged as check,
)


def person(pid, gender, birth_year):
    return {
        "id": pid,
        "gender": gender,
        "facts": [{"type": "Birth", "date": str(birth_year)}],
    }


def tree(persons, relationships):
    return {"tree_gedcomx_json": {"persons": persons, "relationships": relationships}}


def rel(rid, parent, child, notes=None):
    entry = {"id": rid, "type": "ParentChild", "parent": parent, "child": child}
    if notes is not None:
        entry["notes"] = notes
    return entry


def test_plausible_age_gap_passes():
    """A normal 25-year gap between parent and child needs no note at all."""
    before = tree([], [])
    persons = [person("P1", "Female", 1810), person("P2", "Female", 1835)]
    rels = [rel("R1", "P1", "P2")]
    after = tree(persons, rels)
    check(before, after)


def test_general_lower_bound_with_no_note_fails():
    """A parent (either gender) whose implied age at the child's birth is
    <= 12 -- the general earliestChildBirthToBirth12 bound -- with no
    uncertainty note must fail."""
    before = tree([], [])
    persons = [person("P1", "Female", 1841), person("P2", "Female", 1852)]
    rels = [rel("R1", "P1", "P2")]
    after = tree(persons, rels)
    with pytest.raises(AssertionError) as e:
        check(before, after)
    assert "R1" in str(e.value)


def test_male_specific_lower_bound_with_no_note_fails():
    """A MALE parent aged 13-14 at the child's birth trips the
    male-specific earliestChildBirthToBirthMale14 bound, even though 13-14
    clears the general (any-gender) <=12 bound."""
    before = tree([], [])
    persons = [person("P1", "Male", 1841), person("P2", "Female", 1854)]
    rels = [rel("R1", "P1", "P2")]
    after = tree(persons, rels)
    with pytest.raises(AssertionError) as e:
        check(before, after)
    assert "R1" in str(e.value)


def test_known_gap_female_age_14_is_not_caught():
    """Documents, rather than hides, a real limitation: person-warnings.ts
    has no female-specific LOWER bound (only general <=12, male-specific
    <=14), so a MOTHER aged 14 at the child's birth -- the exact age in
    issue #1642 Finding 2's motivating bug (jimmie-jewel-neal, the Wood-family
    adoption) -- is NOT caught by this validator today. This test pins that
    gap so it is a measured, visible fact rather than an unstated assumption;
    closing it is a person-warnings.ts decision (adding a female-specific
    lower bound), not something to paper over here."""
    before = tree([], [])
    persons = [person("P1", "Female", 1841), person("P2", "Female", 1855)]
    rels = [rel("R1", "P1", "P2")]
    after = tree(persons, rels)
    check(before, after)  # does NOT raise -- age 14 clears every bound above


def test_known_gap_female_upper_bound_45_is_not_caught():
    """Documents, rather than hides, a new limitation deliberately introduced
    this round: _PARENT_AGE_UPPER_FEMALE (person-warnings.ts's
    latestChildBirthToBirthFemale45) is no longer enforced (chesworthrm
    review, issue #1642). It was live briefly and measured against the full
    repo: 3 committed, non-exempt relationships (anders-monsen-ancestry R2,
    mccarley-spouse R23/R25 -- mothers aged 46-51) would fail it with no way
    for any skill to comply -- relationship.notes[] is fully specified and
    schema-accepted, but no skill is ever told to write it (issue #1837).
    Pinned so a future restoration of this bound is a deliberate, measured
    choice, not an accidental silent regression the other direction."""
    before = tree([], [])
    persons = [person("P1", "Female", 1805), person("P2", "Female", 1852)]
    rels = [rel("R1", "P1", "P2")]
    after = tree(persons, rels)
    check(before, after)  # does NOT raise -- age 47, no upper female bound anymore


def test_implausible_age_with_uncertainty_note_passes():
    """The same implausible gap, but flagged -- the documented escape hatch."""
    before = tree([], [])
    persons = [person("P1", "Female", 1841), person("P2", "Female", 1852)]
    rels = [rel("R1", "P1", "P2", notes=["needs-review: age implausible, treat as speculative pending independent confirmation"])]
    after = tree(persons, rels)
    check(before, after)


def test_a_pre_existing_relationship_is_not_re_judged():
    """Only relationships this run added are the run's responsibility."""
    old_rel = rel("R1", "P1", "P2")
    persons = [person("P1", "Female", 1841), person("P2", "Female", 1852)]
    before = tree(persons, [old_rel])
    after = tree(persons, [old_rel])
    check(before, after)


def test_no_new_relationships_skips():
    before = tree([], [])
    after = tree([], [])
    with pytest.raises(pytest.skip.Exception):
        check(before, after)


def test_missing_tree_skips():
    with pytest.raises(pytest.skip.Exception):
        check({}, {})


def test_malformed_run_together_date_is_not_misread_as_a_year():
    """chesworthrm review (issue #1642): eval/tests/e2e/concepcion-alegre-parents/
    starting-tree.gedcomx.json's person P73Z-2WC has a real committed Birth
    date of "06031947" (day+month+year run together, no separators, no
    standard_date). The old r"\\d{4}" scan took the first 4 digits and read
    a birth year of 603 -- against a parent born 1915 that computed an age
    of -1312, tripping the "too young" branch on a person actually born in
    1947. The fixed (1[0-9]{3}|20[0-9]{2}) scan finds no valid 4-digit
    year bounded on both sides inside a pure digit run, so the age check is
    skipped for this person entirely rather than computing a bogus age --
    the correct outcome, not a forced pass."""
    before = tree([], [])
    persons = [
        person("P1", "Male", 1915),
        {"id": "P2", "gender": "Female", "facts": [
            {"type": "Birth", "date": "06031947", "place": "Altos, Cordillera, Paraguai"},
        ]},
    ]
    rels = [rel("R1", "P1", "P2")]
    after = tree(persons, rels)
    check(before, after)  # does NOT raise -- year is unparseable, so unchecked


def test_dict_shaped_date_does_not_crash():
    """chesworthrm review (issue #1642): eval/runlogs/e2e/mckee-birth-1904/
    run-2026-07-09_11-43-28.final-tree.gedcomx.json has a real committed
    Birth fact whose `date` is an object ({"original": "January-March 1904",
    "formal": "+1904"}), not a string -- FamilySearch's own shape for an
    uncertain-precision date. re.search(r"\\d{4}", <dict>) raised TypeError,
    which the harness turned into a plain validator failure with the
    exception text as the message, unrelated to any real parent-age
    problem. The isinstance(raw, str) guard skips this person's date
    instead of crashing."""
    before = tree([], [])
    persons = [
        person("P1", "Male", 1875),
        {"id": "P2", "gender": "Male", "facts": [
            {"type": "Birth", "date": {"original": "January-March 1904", "formal": "+1904"},
             "place": {"original": "Banbridge, County Down, Ireland"}},
        ]},
    ]
    rels = [rel("R1", "P1", "P2")]
    after = tree(persons, rels)
    check(before, after)  # does NOT raise TypeError, and does NOT flag
