"""Direct tests for init-project's stub validators (lead ruling, 2026-10-20).

`pyproject.toml` collects nothing under `validators/`, so without these the
three stub checks would first run inside a paid per-skill eval. Each planted
case below is one the ruling forbids or allows, built as the after-state the
harness hands a validator: the final tree, plus the write-once starting tree
`project_create` built, which is how a stub added afterwards is told apart.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_init_project import (  # noqa: E402
    test_a_stub_is_linked_and_cited as check_linked,
    test_no_filled_parent_slot_gets_a_stub as check_slot,
    test_stub_expectation as check_expectation,
)

_STATEMENT = {"id": "S9", "title": "Researcher's statement", "citation": "x"}


def _person(pid, gender):
    return {"id": pid, "gender": gender, "names": [{"given": pid, "surname": "X"}]}


def _pc(parent, child, ref=None):
    edge = {"id": f"R-{parent}-{child}", "type": "ParentChild", "parent": parent, "child": child}
    if ref:
        edge["sources"] = [{"ref": ref, "quality": 1}]
    return edge


def _state(start_persons, start_edges, added_persons=(), added_edges=(), sources=()):
    """The after-state: the starting tree as built, then the final tree with the
    stubs the agent added on top of it."""
    start = {"persons": list(start_persons), "relationships": list(start_edges), "sources": []}
    final = {
        "persons": [*start_persons, *added_persons],
        "relationships": [*start_edges, *added_edges],
        "sources": list(sources),
    }
    return {"tree_gedcomx_json": final, "files": {"starting-tree.gedcomx.json": json.dumps(start)}}


SUBJECT = _person("I1", "Male")
FATHER = _person("I2", "Male")
MOTHER = _person("I3", "Female")
UNKNOWN_PARENT = _person("I4", "Unknown")


def _fails(fn, *args):
    with pytest.raises(AssertionError) as e:
        fn(*args)
    return str(e.value)


# --- no filled slot gets a stub ----------------------------------------------

def test_a_second_father_fails():
    state = _state([SUBJECT, FATHER], [_pc("I2", "I1")], [_person("I9", "Male")], [_pc("I9", "I1", "S9")])
    assert "I9 (Male) added as a parent of I1" in _fails(check_slot, state)


def test_a_stub_beside_a_parent_of_unknown_sex_fails():
    state = _state([SUBJECT, UNKNOWN_PARENT], [_pc("I4", "I1")], [_person("I9", "Female")], [_pc("I9", "I1", "S9")])
    assert "I9" in _fails(check_slot, state)


def test_a_third_parent_fails():
    state = _state(
        [SUBJECT, FATHER, MOTHER], [_pc("I2", "I1"), _pc("I3", "I1")],
        [_person("I9", "Female")], [_pc("I9", "I1", "S9")],
    )
    assert "I9" in _fails(check_slot, state)


def test_a_third_parent_beside_two_of_the_same_sex_fails():
    """Two fathers (a birth and a step father) already fill both slots, so even a
    stated mother -- a sex neither parent has -- is a third parent."""
    step = _person("I5", "Male")
    state = _state(
        [SUBJECT, FATHER, step], [_pc("I2", "I1"), _pc("I5", "I1")],
        [_person("I9", "Female")], [_pc("I9", "I1", "S9")],
    )
    assert "I9" in _fails(check_slot, state)


def test_a_stub_of_unknown_sex_beside_any_parent_fails():
    state = _state([SUBJECT, FATHER], [_pc("I2", "I1")], [_person("I9", "Unknown")], [_pc("I9", "I1", "S9")])
    assert "I9 (Unknown)" in _fails(check_slot, state)


def test_a_mother_beside_a_father_passes():
    """The other slot is empty: a stated mother where the read holds only a father."""
    state = _state([SUBJECT, FATHER], [_pc("I2", "I1")], [_person("I9", "Female")], [_pc("I9", "I1", "S9")])
    check_slot(state)


def test_a_parent_for_someone_with_no_parents_passes():
    """The maiden-name case: the subject's mother has no parents in the read, so
    her parent (sex unknown) fills an empty slot."""
    state = _state([SUBJECT, MOTHER], [_pc("I3", "I1")], [_person("I9", "Unknown")], [_pc("I9", "I3", "S9")])
    check_slot(state)


def test_the_slot_check_skips_when_nothing_was_added():
    with pytest.raises(pytest.skip.Exception):
        check_slot(_state([SUBJECT, FATHER], [_pc("I2", "I1")]))


# --- a stub is linked and cited ----------------------------------------------

def test_an_unlinked_stub_fails():
    state = _state([SUBJECT, MOTHER], [_pc("I3", "I1")], [_person("I9", "Unknown")], [], [_STATEMENT])
    assert "I9" in _fails(check_linked, state)


def test_a_stub_linked_by_an_uncited_edge_fails():
    state = _state([SUBJECT, MOTHER], [_pc("I3", "I1")], [_person("I9", "Unknown")], [_pc("I9", "I3")], [_STATEMENT])
    assert "I9" in _fails(check_linked, state)


def test_a_stub_cited_to_another_source_fails():
    other = {"id": "S1", "title": "FamilySearch Family Tree"}
    state = _state([SUBJECT, MOTHER], [_pc("I3", "I1")], [_person("I9", "Unknown")], [_pc("I9", "I3", "S1")], [other])
    assert "I9" in _fails(check_linked, state)


def test_a_stub_linked_and_cited_to_the_statement_passes():
    state = _state([SUBJECT, MOTHER], [_pc("I3", "I1")], [_person("I9", "Unknown")], [_pc("I9", "I3", "S9")], [_STATEMENT])
    check_linked(state)


# --- the expectation tags ----------------------------------------------------

def test_expects_stub_fails_when_nothing_was_added():
    state = _state([SUBJECT, MOTHER], [_pc("I3", "I1")])
    assert "no stub was added" in _fails(check_expectation, state, {"tags": ["expects-stub"]})


def test_expects_no_stub_fails_when_one_was_added():
    state = _state([SUBJECT, FATHER], [_pc("I2", "I1")], [_person("I9", "Male")], [_pc("I9", "I1", "S9")], [_STATEMENT])
    assert "I9" in _fails(check_expectation, state, {"tags": ["expects-no-stub"]})


def test_the_expectations_hold_when_met():
    added = _state([SUBJECT, MOTHER], [_pc("I3", "I1")], [_person("I9", "Unknown")], [_pc("I9", "I3", "S9")], [_STATEMENT])
    check_expectation(added, {"tags": ["expects-stub"]})
    check_expectation(_state([SUBJECT, FATHER], [_pc("I2", "I1")]), {"tags": ["expects-no-stub"]})


def test_an_untagged_test_skips_the_expectation():
    with pytest.raises(pytest.skip.Exception):
        check_expectation(_state([SUBJECT], []), {"tags": []})
