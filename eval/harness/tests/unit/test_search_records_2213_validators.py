"""Direct tests for the issue #2213 PR 3 search-records validators.

Same reason as test_search_records_pre1880_validator.py: pyproject.toml sets
testpaths = ["tests"], so nothing under validators/ is collected by
`make harness-test`, and a validator's real pass/fail set otherwise appears only
inside a paid per-skill run. Each validator is proven both ways here: a planted
defect fires it, and a correct run (plus a legitimate variant) passes.

The before-states are the committed scenarios themselves, so a scenario edit
that breaks a validator's premise fails here, not in a paid run.
"""

import copy
import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_unproven_surname_used_as_search_input as unproven_surname,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
SCENARIOS = REPO_ROOT / "eval/fixtures/scenarios"
UNIT_TESTS = REPO_ROOT / "eval/tests/unit/search-records"


def scenario_state(name):
    d = SCENARIOS / name
    tree = json.loads((d / "tree.gedcomx.json").read_text(encoding="utf-8"))
    return {
        "research_json": json.loads((d / "research.json").read_text(encoding="utf-8")),
        "tree_gedcomx_json": tree,
        "tree_gedcomx": tree,
        "files": {},
    }


def spec(filename):
    return json.loads((UNIT_TESTS / filename).read_text(encoding="utf-8"))["test"]


def rs(args, response=None):
    return {"tool": "mcp__genealogy__record_search", "args": args, "response": response or {}}


# --- unproven-surname-search (ut_search_records_d33) ---------------------

D33 = spec("unproven-married-surname-search.json")


@pytest.fixture
def d33_before():
    return scenario_state("search-records-unproven-married-surname")


@pytest.mark.parametrize("args", [
    {"givenName": "Juanita", "surname": "Fenstermaker", "residenceYearFrom": 1950},
    {"givenName": "Juanita Ruth", "surname": "Fenstermacher"},
    {"givenName": "Juanita*", "surname": "Fenster*"},
    {"givenName": "Juanita", "surname": "Kimbrell", "surnameAlt": "Fenstermaker"},
    {"givenName": "Juanita", "surname": "Fenst*"},
])
def test_unproven_passes_on_search_under_surname(d33_before, args):
    calls = [rs({"givenName": "Juanita", "surname": "Kimbrell"}), rs(args)]
    unproven_surname(d33_before, copy.deepcopy(d33_before), calls, D33)


@pytest.mark.parametrize("args", [
    {"givenName": "Juanita", "surname": "Kimbrell", "spouseSurname": "Fenstermaker"},
    {"givenName": "Robert", "surname": "Fenstermaker"},
    {"givenName": "Juanita", "surname": "Kimbrell"},
])
def test_unproven_fails_without_search_under_surname(d33_before, args):
    with pytest.raises(AssertionError, match="no record_search looked"):
        unproven_surname(d33_before, copy.deepcopy(d33_before), [rs(args)], D33)


def test_unproven_fails_on_tree_couple(d33_before):
    after = copy.deepcopy(d33_before)
    after["tree_gedcomx_json"]["relationships"].append(
        {"id": "R9", "type": "Couple", "person1": "I1", "person2": "I9"})
    calls = [rs({"givenName": "Juanita", "surname": "Fenstermaker"})]
    with pytest.raises(AssertionError, match="Couple"):
        unproven_surname(d33_before, after, calls, D33)


def test_unproven_fails_on_tree_name(d33_before):
    after = copy.deepcopy(d33_before)
    after["tree_gedcomx_json"]["persons"][0]["names"].append(
        {"id": "N9", "given": "Juanita", "surname": "Fenstermaker", "type": "MarriedName"})
    calls = [rs({"givenName": "Juanita", "surname": "Fenstermaker"})]
    with pytest.raises(AssertionError, match="name in the tree"):
        unproven_surname(d33_before, after, calls, D33)


def test_unproven_map_entry_without_tag_fails(d33_before):
    stripped = dict(D33, tags=["search"])
    with pytest.raises(AssertionError, match="no 'unproven-surname-search' tag"):
        unproven_surname(d33_before, d33_before, [], stripped)


def test_unproven_tag_without_map_entry_fails(d33_before):
    other = {"id": "ut_other", "tags": ["unproven-surname-search"]}
    with pytest.raises(AssertionError, match="no entry"):
        unproven_surname(d33_before, d33_before, [], other)

