"""Proof cases for the issue #4696 research-plan validators.

Each validator is shown to fail on planted breaks, in more than one shape, and to pass
legitimate variants. The Part A validators are also replayed over the plan the real
#4642 session wrote, which all three must fail.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS))
sys.path.insert(0, str(_HARNESS / "validators"))

from test_research_plan import (  # noqa: E402
    test_fulltext_beside_indexed_for_early_vital as check_fulltext,
    test_research_plan_plans_subject_birth_and_death as check_vitals,
    test_ruled_out_tree_claim_gets_no_item as check_ruled_out,
)

_ORIGINAL = json.loads(
    (Path(__file__).parent / "data" / "research_plan_mills_original_plan.json").read_text(
        encoding="utf-8"
    )
)["items"]

ALAN = {"id": "ut_research_plan_zgw", "tags": ["subject-birth-death-items"]}
MILLS_TAGS = ["ruled-out-claim", "fulltext-beside-indexed"]
MILLS = {"id": "ut_research_plan_99n", "tags": MILLS_TAGS}


def _item(n, *, rationale="", jurisdiction="Utah", date_range="1936",
          record_type="vital_record", status="planned", skip_reason=None,
          skip_category=None, sequence=None):
    item = {
        "id": f"pli_{n:03d}",
        "sequence": n if sequence is None else sequence,
        "record_type": record_type,
        "jurisdiction": jurisdiction,
        "date_range": date_range,
        "repository": "FamilySearch",
        "rationale": rationale,
        "fallback_for": None,
        "status": status,
    }
    if skip_reason is not None:
        item["skip_reason"] = skip_reason
        item["skip_category"] = skip_category or "inaccessible"
    return item


def _states(items):
    before = {"research_json": {"plans": []}}
    after = {"research_json": {"plans": [{"id": "pl_001", "status": "active", "items": items}]}}
    return before, after


def _run(check, items, test):
    before, after = _states(items)
    check(before, after, test)


BIRTH_OK = _item(1, rationale="Alan's 1936 Utah birth certificate would name both parents.")
DEATH_OK = _item(2, rationale="Alan's 2023 death certificate would name his parents, "
                              "John O. Applegarth and Olive Harvey.", date_range="2023")


# --- Part B: subject's own birth record and death certificate ----------------

@pytest.mark.parametrize("birth,death", [
    (BIRTH_OK, DEATH_OK),
    (_item(1, rationale="Birth record for Alan Applegarth."),
     _item(2, rationale="The certificate of Alan's death names his parents.")),
    (_item(1, status="skipped", rationale="",
           skip_reason="Alan Glen Applegarth's 1936 Utah birth certificate is sealed until 2036."),
     _item(2, status="skipped", rationale="",
           skip_reason="Alan's death certificate is closed for 50 years.")),
    (_item(1, rationale="Search the Utah Births and Christenings index for Alan."),
     _item(2, rationale="Request his own death certificate.  It is the one record of "
                        "Alan's death that names his parents. Death certificate for Alan.")),
])
def test_vitals_passes_legitimate_variants(birth, death):
    _run(check_vitals, [birth, death], ALAN)


@pytest.mark.parametrize("items,missing", [
    ([BIRTH_OK], "death certificate"),
    ([DEATH_OK], "birth record"),
    ([BIRTH_OK, _item(2, rationale="John Applegarth's death certificate.")], "death certificate"),
    ([DEATH_OK, _item(1, rationale="John Applegarth's birth record.")], "birth record"),
    ([_item(1, rationale="Alan's father's death certificate."), BIRTH_OK], "death certificate"),
    ([_item(1, rationale=None), _item(2, rationale=None)], "birth record"),
])
def test_vitals_fails_planted_breaks(items, missing):
    with pytest.raises(AssertionError, match=missing):
        _run(check_vitals, items, ALAN)


RUN_BIRTH = _item(3, date_range="1936-1936", jurisdiction="Weber County, Utah",
                 rationale="Alan Glen Applegarth was born 29 Apr 1936 in Ogden, Weber County. A "
                           "birth record would name both parents.")
RUN_DEATH = _item(7, date_range="2023-2023", jurisdiction="Cache County, Utah",
                  rationale="The 2023 obituary places Alan's death in Cache County. His death "
                            "certificate would name his parents.")


def test_vitals_passes_the_2026_11_23_run_wording():
    _run(check_vitals, [RUN_BIRTH, RUN_DEATH], ALAN)


def test_vitals_passes_the_subjects_own_death_entry_unnamed():
    item = _item(11, date_range="2023", rationale="The subject's own death or burial entry (he "
                                                  "died in 2023 per the logged obituary).")
    _run(check_vitals, [RUN_BIRTH, item], ALAN)


@pytest.mark.parametrize("items,missing", [
    ([RUN_BIRTH, _item(4, date_range="1970", rationale="Olive died about 1970; her death "
                                                       "certificate would name her son Alan.")],
     "death certificate"),
    ([RUN_DEATH, _item(5, date_range="1900-1910", rationale="Olive's birth record; she is "
                                                            "Alan's mother.")],
     "birth record"),
    ([RUN_BIRTH, {**RUN_DEATH, "date_range": None}], "death certificate"),
])
def test_vitals_year_fallback_keeps_a_parents_record_out(items, missing):
    with pytest.raises(AssertionError, match=missing):
        _run(check_vitals, items, ALAN)


def test_vitals_fails_when_nothing_written():
    with pytest.raises(AssertionError, match="no new plan items"):
        _run(check_vitals, [], ALAN)


def test_vitals_skips_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        _run(check_vitals, [BIRTH_OK], {"id": "ut_x", "tags": []})


def test_vitals_entry_without_tag_fails():
    with pytest.raises(AssertionError, match="no 'subject-birth-death-items' tag"):
        _run(check_vitals, [BIRTH_OK, DEATH_OK], {"id": "ut_research_plan_zgw", "tags": []})


# --- Part A: replay of the real #4642 first plan ------------------------------

@pytest.mark.parametrize("check", [check_ruled_out, check_fulltext])
def test_original_mills_plan_fails_every_part_a_check(check):
    with pytest.raises(AssertionError):
        _run(check, [dict(i) for i in _ORIGINAL], MILLS)


# --- Part A (a): no item in the ruled-out claim's place ----------------------

def test_ruled_out_passes_when_stamford_only_in_rationale():
    items = [_item(1, jurisdiction="Worcester County, Massachusetts",
                   rationale="Stamford is excluded: George Mills married in 1760.")]
    _run(check_ruled_out, items, MILLS)


@pytest.mark.parametrize("jurisdiction", [
    "Stamford, Fairfield County, Connecticut",
    "stamford/Darien, Fairfield County, Connecticut",
])
def test_ruled_out_fails_on_stamford_jurisdiction(jurisdiction):
    items = [_item(1, jurisdiction="Worcester"), _item(2, jurisdiction=jurisdiction)]
    with pytest.raises(AssertionError, match="planned in Stamford"):
        _run(check_ruled_out, items, MILLS)


PARENTS = _item(5, rationale="Probate of George Mills of Stamford may name his heirs.",
                jurisdiction="Fairfield County, Connecticut")


# --- Part A (c): full-text beside indexed for the 1759 Worcester marriage ------

@pytest.mark.parametrize("item", [
    _item(3, jurisdiction="Worcester, Worcester County, Massachusetts", date_range="1755-1765",
          rationale="Run the indexed search, and a full-text search of the published "
                    "town vital records alongside it."),
    _item(3, jurisdiction="Worcester County, Massachusetts", date_range="1759",
          record_type="church", rationale="Via the search-full-text agent."),
    _item(3, jurisdiction="Worcester", date_range="1750-1770",
          rationale="Full text\nsearch of the 1846 compilation."),
])
def test_fulltext_passes_variants(item):
    _run(check_fulltext, [item], MILLS)


@pytest.mark.parametrize("item", [
    _item(3, jurisdiction="Worcester County, Massachusetts", date_range="1755-1762",
          rationale="Indexed marriage search."),
    _item(3, jurisdiction="Beverly, Essex County, Massachusetts", date_range="1755-1762",
          rationale="Full-text search of the town records."),
    _item(3, jurisdiction="Worcester County, Massachusetts", date_range=None,
          rationale="Full-text search of the town records."),
    _item(3, jurisdiction="Worcester County, Massachusetts", date_range="1770-1790",
          rationale="Full-text search of the town records."),
])
def test_fulltext_fails_planted_breaks(item):
    with pytest.raises(AssertionError, match="names full-text"):
        _run(check_fulltext, [item], MILLS)


def test_part_a_checks_skip_untagged_tests():
    for check in (check_ruled_out, check_fulltext):
        with pytest.raises(pytest.skip.Exception):
            _run(check, [PARENTS], {"id": "ut_x", "tags": []})


def test_part_a_entry_without_any_tag_fails():
    with pytest.raises(AssertionError, match="none of the tags"):
        _run(check_ruled_out, [PARENTS], {"id": "ut_research_plan_99n", "tags": ["planning"]})
