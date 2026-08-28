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
