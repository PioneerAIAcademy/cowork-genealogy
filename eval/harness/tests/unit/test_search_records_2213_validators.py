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
    test_collection_named_with_link as collection_link,
    test_household_not_searched_by_co_resident_when_unneeded as triangulation_unneeded,
    test_household_searched_by_co_resident as triangulation,
    test_thin_subject_hit_not_extracted as thin_subject,
    test_unproven_surname_used_as_search_input as unproven_surname,
    test_user_declined_item_skipped_not_searched as user_declined,
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


def call(tool, args=None, response=None):
    return {"tool": f"mcp__genealogy__{tool}", "args": args or {}, "response": response or {}}


UNTAGGED = {"id": "ut_x", "tags": ["search"]}


# --- user-declined-item (ut_search_records_d28) --------------------------

D28 = spec("user-declined-plan-item.json")


def declined_after(before, *, status="skipped", category="user_declined",
                   reason="User declined the probate search.", log=()):
    after = copy.deepcopy(before)
    item = after["research_json"]["plans"][0]["items"][0]
    item["status"] = status
    if category is not None:
        item["skip_category"] = category
    if reason is not None:
        item["skip_reason"] = reason
    after["research_json"]["log"] = list(log)
    return after


CENSUS_LOG = {"id": "log_001", "plan_item_id": "pli_002", "tool": "record_search"}
CENSUS_CALL = rs({"surname": "Thornbury", "givenName": "Elias", "residenceYearFrom": 1880})


@pytest.fixture
def d28_before():
    return scenario_state("search-records-user-declined-probate")


def test_user_declined_passes_when_skipped_and_census_run(d28_before):
    after = declined_after(d28_before, log=[CENSUS_LOG])
    user_declined(d28_before, after, [CENSUS_CALL], D28)


def test_user_declined_fails_when_item_left_planned(d28_before):
    after = declined_after(d28_before, status="planned", category=None, reason=None, log=[CENSUS_LOG])
    with pytest.raises(AssertionError, match="must be `skipped`"):
        user_declined(d28_before, after, [CENSUS_CALL], D28)


def test_user_declined_fails_on_wrong_category(d28_before):
    after = declined_after(d28_before, category="premise_invalidated", log=[CENSUS_LOG])
    with pytest.raises(AssertionError, match="user_declined"):
        user_declined(d28_before, after, [CENSUS_CALL], D28)


@pytest.mark.parametrize("reason", [None, "", "   "])
def test_user_declined_fails_without_reason(d28_before, reason):
    after = declined_after(d28_before, reason=reason, log=[CENSUS_LOG])
    with pytest.raises(AssertionError, match="skip_reason"):
        user_declined(d28_before, after, [CENSUS_CALL], D28)


def test_user_declined_fails_when_declined_search_logged(d28_before):
    log = [CENSUS_LOG, {"id": "log_002", "plan_item_id": "pli_001", "tool": "record_search"}]
    after = declined_after(d28_before, log=log)
    with pytest.raises(AssertionError, match="logged a search"):
        user_declined(d28_before, after, [CENSUS_CALL], D28)


@pytest.mark.parametrize("args", [
    {"surname": "Thornbury", "collectionId": "SYNTH-OH-PROBATE"},
    {"surname": "Thornbury", "recordType": "Probate"},
])
def test_user_declined_fails_when_declined_search_run_unlogged(d28_before, args):
    after = declined_after(d28_before, log=[CENSUS_LOG])
    with pytest.raises(AssertionError, match="declined pli_001"):
        user_declined(d28_before, after, [rs(args), CENSUS_CALL], D28)


def test_user_declined_fails_on_fulltext_pivot(d28_before):
    after = declined_after(d28_before, log=[CENSUS_LOG])
    calls = [call("fulltext_search", {"query": "Thornbury estate"}), CENSUS_CALL]
    with pytest.raises(AssertionError, match="pivoted"):
        user_declined(d28_before, after, calls, D28)


def test_user_declined_skips_untagged(d28_before):
    with pytest.raises(pytest.skip.Exception):
        user_declined(d28_before, d28_before, [], UNTAGGED)


# --- subject-too-thin (ut_search_records_d29) ----------------------------

D29 = spec("thin-subject-namesake-gate.json")


def test_thin_subject_passes_with_search_only():
    thin_subject([rs({"surname": "Brown", "subjectId": "I1"})], [], D29)


def test_thin_subject_fails_on_extraction_append():
    calls = [rs({"surname": "Brown"}), call("extraction_append", {"recordIds": ["M9TB-7QX"]})]
    with pytest.raises(AssertionError, match="extraction_append"):
        thin_subject(calls, [], D29)


@pytest.mark.parametrize("prefix", ["mcp__remote-devices__Genealogy_Research__", "mcp__Genealogy_Research__"])
def test_thin_subject_fails_on_extraction_under_any_spelling(prefix):
    calls = [{"tool": f"{prefix}extraction_append", "args": {"recordIds": ["M9TB-7QX"]}}]
    with pytest.raises(AssertionError):
        thin_subject(calls, [], D29)


@pytest.mark.parametrize("agent", ["record-structurer", "genealogy-research:record-structurer"])
def test_thin_subject_fails_on_structurer_spawn(agent):
    spawn = [{"tool": "Agent", "args": {"subagent_type": agent, "prompt": "..."}}]
    with pytest.raises(AssertionError, match="record-structurer"):
        thin_subject([rs({"surname": "Brown"})], spawn, D29)


def test_thin_subject_ignores_other_spawns():
    spawn = [{"tool": "Agent", "args": {"subagent_type": "research-plan"}}]
    thin_subject([rs({"surname": "Brown"})], spawn, D29)


def test_thin_subject_skips_untagged():
    with pytest.raises(pytest.skip.Exception):
        thin_subject([call("extraction_append")], [], UNTAGGED)


# --- collection-link (ut_search_records_d30) -----------------------------

D30 = spec("collection-named-with-link.json")
HIT = rs(
    {"surname": "Hollis", "givenName": "Mary Ellen"},
    {"results": [{"recordId": "XK2J-9HL", "collectionId": "1803785"}],
     "collections": {"1803785": "Ohio, County Marriages, 1789-2013"}},
)
LINK = "https://www.familysearch.org/search/collection/1803785"


@pytest.mark.parametrize("text", [
    f"Her marriage is in Ohio, County Marriages, 1789-2013 ({LINK}).",
    f"Collection: [Ohio, County Marriages, 1789-2013]({LINK})",
    f"Browse it at <{LINK}> - Ohio, County Marriages, 1789-2013.",
])
def test_collection_link_passes_on_linked_title(text):
    collection_link([HIT], text, D30)


def test_collection_link_fails_on_bare_id():
    text = "Her marriage is in Ohio, County Marriages, 1789-2013 (collection 1803785)."
    with pytest.raises(AssertionError, match="without its"):
        collection_link([HIT], text, D30)


def test_collection_link_fails_on_bare_id_beside_a_link():
    text = f"Ohio, County Marriages, 1789-2013 ({LINK}); collection id 1803785."
    with pytest.raises(AssertionError, match="outside"):
        collection_link([HIT], text, D30)


def test_collection_link_fails_on_query_string_id():
    text = (f"Ohio, County Marriages ({LINK}). Search it at "
            "https://www.familysearch.org/search/record/results?f.collectionId=1803785")
    with pytest.raises(AssertionError, match="outside"):
        collection_link([HIT], text, D30)


def test_collection_link_fails_on_title_only():
    with pytest.raises(AssertionError, match="without its"):
        collection_link([HIT], "Her marriage is in Ohio, County Marriages, 1789-2013.", D30)


def test_collection_link_fails_on_record_ark_only():
    text = "Record: https://www.familysearch.org/ark:/61903/1:1:XK2J-9HL"
    with pytest.raises(AssertionError, match="without its"):
        collection_link([HIT], text, D30)


def test_collection_link_flags_bare_collections_search_id():
    cs = call("collections_search", {"standardPlace": "Ohio"},
              {"results": [{"id": "1987542", "title": "Ohio, Tax Records, 1800-1850"}]})
    text = f"Ohio, County Marriages ({LINK}). Also try Ohio, Tax Records (1987542)."
    with pytest.raises(AssertionError, match="outside"):
        collection_link([HIT, cs], text, D30)


def test_collection_link_ignores_unrelated_numbers():
    text = f"Married 14 Oct 1856. Ohio, County Marriages, 1789-2013: {LINK}"
    collection_link([HIT], text, D30)


def test_collection_link_skips_untagged():
    with pytest.raises(pytest.skip.Exception):
        collection_link([HIT], "collection 1803785", UNTAGGED)


# --- household-triangulation (ut_search_records_d31 / d32) ---------------

D31 = spec("household-triangulation-by-co-resident.json")
D32 = spec("household-triangulation-not-overapplied.json")


@pytest.fixture
def d31_before():
    return scenario_state("search-records-household-triangulation")


@pytest.fixture
def d32_before():
    return scenario_state("search-records-household-triangulation-unneeded")


SUBJECT_CALLS = [
    rs({"surname": "Weber", "givenName": "Henry", "residenceYearFrom": 1870}),
    rs({"surname": "Weber", "givenName": "Henry", "motherGivenName": "Catharina"}),
    rs({"surname": "Kessler", "givenName": "Henry"}),
]


@pytest.mark.parametrize("args", [
    {"surname": "Kessler", "givenName": "Catharina", "residenceYearFrom": 1870},
    {"surname": "Kesler", "givenName": "Catherine"},
    {"surname": "Kessler", "givenName": "Jacob", "spouseGivenName": "Catharina"},
    {"surname": "Kessler", "residencePlace": "Lancaster, Pennsylvania"},
    {"givenName": "Cath*", "surname": "Weber"},
])
def test_triangulation_passes_on_co_resident_principal(d31_before, args):
    triangulation(d31_before, SUBJECT_CALLS + [rs(args)], D31)


def test_triangulation_fails_on_subject_searches_only(d31_before):
    with pytest.raises(AssertionError, match="no record_search named a parent"):
        triangulation(d31_before, SUBJECT_CALLS, D31)


def test_triangulation_fails_on_no_search(d31_before):
    with pytest.raises(AssertionError):
        triangulation(d31_before, [], D31)


def test_triangulation_ignores_record_reads(d31_before):
    reads = [call("record_read", {"recordId": "MXK7-1HW"})]
    with pytest.raises(AssertionError):
        triangulation(d31_before, SUBJECT_CALLS + reads, D31)


def test_triangulation_skips_untagged(d31_before):
    with pytest.raises(pytest.skip.Exception):
        triangulation(d31_before, [], UNTAGGED)


def test_unneeded_passes_on_subject_search_only(d32_before):
    calls = [rs({"surname": "Quarrington", "givenName": "Thaddeus", "subjectId": "I1"}),
             rs({"surname": "Quarrington", "residenceYearFrom": 1870})]
    triangulation_unneeded(d32_before, calls, D32)


@pytest.mark.parametrize("args", [
    {"surname": "Quarrington", "givenName": "Lavinia"},
    {"givenName": "Lavina", "surname": "Quarington"},
])
def test_unneeded_fails_on_co_resident_search(d32_before, args):
    calls = [rs({"surname": "Quarrington", "givenName": "Thaddeus"}), rs(args)]
    with pytest.raises(AssertionError, match="searched the household"):
        triangulation_unneeded(d32_before, calls, D32)


def test_unneeded_skips_untagged(d32_before):
    with pytest.raises(pytest.skip.Exception):
        triangulation_unneeded(d32_before, [rs({"givenName": "Lavinia"})], UNTAGGED)


# --- unproven-surname-search (ut_search_records_d33) ---------------------

D33 = spec("unproven-married-surname-search.json")


@pytest.fixture
def d33_before():
    return scenario_state("search-records-unproven-married-surname")


@pytest.mark.parametrize("args", [
    {"givenName": "Juanita", "surname": "Fenstermaker", "residenceYearFrom": 1950},
    {"givenName": "Juanita Ruth", "surname": "Fenstermacher"},
    {"givenName": "Juanita*", "surname": "Fenster*"},
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
