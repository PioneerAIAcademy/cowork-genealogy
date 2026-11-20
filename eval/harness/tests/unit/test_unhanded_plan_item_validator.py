"""Direct tests for `test_unhanded_plan_item_stays_planned` (t9p).

`validators/` is not collected by `make harness-test`, so without these the
validator's pass/fail set appears only inside a paid search-records run.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_unhanded_plan_item_stays_planned as check,
)

TAGGED = {"tags": ["execution", "one-plan-item-per-call"]}
UNTAGGED = {"tags": ["execution"]}


def state(pli_002_status="planned", log=(), drop_pli_002=False):
    items = [{"id": "pli_001", "status": "completed"}]
    if not drop_pli_002:
        items.append({"id": "pli_002", "status": pli_002_status})
    return {
        "research_json": {
            "plans": [{"id": "pl_001", "items": items}],
            "log": list(log),
        }
    }


BEFORE = state()
COMPLIANT_AFTER = state(log=[{"id": "log_001", "plan_item_id": "pli_001"}])


def search(args, fixture="record-search-1880-census-sheahan"):
    return {
        "tool": "mcp__genealogy__record_search",
        "args": args,
        "response_fixture": fixture,
    }


CENSUS = search({"surname": "Sheahan", "recordType": "census", "anyPlace": "Schuylkill"})


def test_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE, COMPLIANT_AFTER, [CENSUS], UNTAGGED)


def test_accepts_the_compliant_run():
    check(BEFORE, COMPLIANT_AFTER, [CENSUS], TAGGED)


def test_accepts_a_census_search_answered_by_the_church_fixture():
    call = search(
        {"surname": "Sheahan", "recordType": "census", "anyPlace": "Pennsylvania"},
        fixture="record-search-church-sheahan-anyplace",
    )
    check(BEFORE, COMPLIANT_AFTER, [call], TAGGED)


def test_rejects_pli_002_moved_off_planned():
    with pytest.raises(AssertionError, match="pli_002 left"):
        check(BEFORE, state(pli_002_status="in_progress"), [CENSUS], TAGGED)


def test_rejects_pli_002_missing():
    with pytest.raises(AssertionError, match="pli_002 left"):
        check(BEFORE, state(drop_pli_002=True), [CENSUS], TAGGED)


def test_rejects_pli_002_logged():
    after = state(log=[{"id": "log_001", "plan_item_id": "pli_002"}])
    with pytest.raises(AssertionError, match="logged"):
        check(BEFORE, after, [CENSUS], TAGGED)


def test_rejects_a_church_search_by_collection_id():
    call = search(
        {"surname": "Sheahan", "collectionId": "1234"},
        fixture="record-search-church-sheahan-collectionid",
    )
    with pytest.raises(AssertionError, match="church search"):
        check(BEFORE, COMPLIANT_AFTER, [CENSUS, call], TAGGED)


def test_rejects_a_church_search_by_any_place():
    call = search(
        {"surname": "Sheahan", "anyPlace": "Pennsylvania"},
        fixture="record-search-church-sheahan-anyplace",
    )
    with pytest.raises(AssertionError, match="church search"):
        check(BEFORE, COMPLIANT_AFTER, [CENSUS, call], TAGGED)


def test_rejects_a_church_search_with_stringified_args():
    call = search(
        json.dumps({"surname": "Sheahan", "recordType": "church"}),
        fixture="",
    )
    with pytest.raises(AssertionError, match="church search"):
        check(BEFORE, COMPLIANT_AFTER, [CENSUS, call], TAGGED)


def test_accepts_a_census_search_with_stringified_args():
    call = search(
        json.dumps({"surname": "Sheahan", "recordType": "census"}),
        fixture="record-search-church-sheahan-anyplace",
    )
    check(BEFORE, COMPLIANT_AFTER, [call], TAGGED)


def test_rejects_a_baptism_search_no_fixture_answered():
    call = search({"surname": "Sheahan", "recordType": "baptism"}, fixture=None)
    with pytest.raises(AssertionError, match="church search"):
        check(BEFORE, COMPLIANT_AFTER, [CENSUS, call], TAGGED)


def test_rejects_a_collection_search_no_fixture_answered():
    call = search({"surname": "Sheahan", "collectionId": "9999"}, fixture=None)
    with pytest.raises(AssertionError, match="church search"):
        check(BEFORE, COMPLIANT_AFTER, [CENSUS, call], TAGGED)


def test_accepts_a_census_variant_with_no_record_type():
    call = search({"surname": "Sheahan", "givenName": "Michael", "residenceYearFrom": 1880})
    check(BEFORE, COMPLIANT_AFTER, [CENSUS, call], TAGGED)


def test_rejects_a_church_search_the_census_fixture_answered():
    call = search(
        {
            "surname": "Sheahan",
            "collectionId": "SYNTH-PA-CHURCH",
            "recordType": "church",
            "residenceYearFrom": 1880,
        }
    )
    with pytest.raises(AssertionError, match="church search"):
        check(BEFORE, COMPLIANT_AFTER, [CENSUS, call], TAGGED)


def test_accepts_a_census_named_only_in_its_arguments():
    call = search(
        {"surname": "Sheahan", "collectionId": "SYNTH-PA-CENSUS-1880"}, fixture=None
    )
    check(BEFORE, COMPLIANT_AFTER, [CENSUS, call], TAGGED)


def test_accepts_a_census_search_in_church_hill():
    call = search(
        {
            "surname": "Sheahan",
            "recordType": "census",
            "anyPlace": "Church Hill, Pennsylvania",
        }
    )
    check(BEFORE, COMPLIANT_AFTER, [CENSUS, call], TAGGED)
