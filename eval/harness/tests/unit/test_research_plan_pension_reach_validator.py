"""Direct tests for `test_pension_item_reaches_past_window`.

Same reason as `test_research_plan_objective_target_validator.py`: nothing
under `validators/` is collected by `make harness-test`, so this validator's
pass/fail set would otherwise appear only inside a paid per-skill run.

Provenance (issue #1830, scenario `rowe-window-is-not-a-ceiling`):

  - The SERVICE-YEARS violation is REAL. Pre-edit scratch run
    `2026-10-19_15-22-23` run 0 dated both military items `1862-1865`, naming
    the pension collection in the rationale, and carried a probate item at
    `1870-1885` -- which is what made any-item-reaches-past pass it.

  - The CEMETERY-MENTIONS-PENSION shape is REAL in its ingredients: post-edit
    run `2026-10-19_17-40-25` run 2 wrote a cemetery item dated `1848-1880`
    whose rationale mentions the pension. That run passes on its own military
    item; paired here with service-years military items, it is the plan a
    rationale match would pass.

  - The FOLD3 variant is REAL: `2026-10-19_15-59-32` run 0 reached the file
    through Fold3, `1861-1934`, with its FamilySearch military item stopping
    at `1861-1865`.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect it.
from test_research_plan import (  # noqa: E402
    test_pension_item_reaches_past_window as check_reach,
)

TAGGED = {"id": "ut_research_plan_wnc", "tags": ["planning", "pension-reaches-past-window"]}
UNTAGGED = {"id": "ut_research_plan_wnc", "tags": ["planning"]}

BEFORE = {"research_json": {"plans": []}}


def _after(items, plan_id="pl_001"):
    return {"research_json": {"plans": [{"id": plan_id, "items": items}]}}


def _item(n, rtype, date_range, rationale="", repository="FamilySearch"):
    return {
        "id": f"pli_{n:03d}",
        "sequence": n,
        "record_type": rtype,
        "date_range": date_range,
        "repository": repository,
        "rationale": rationale,
    }


CENSUSES = [_item(1, "census", "1850"), _item(2, "census", "1860")]


# --- the states that must FAIL ----------------------------------------

def test_fires_on_service_years_only():
    """The real pre-edit defect, late probate and cemetery items included."""
    after = _after(CENSUSES + [
        _item(3, "military", "1862-1865",
              rationale="Civil War service records and the pension file."),
        _item(4, "military", "1862-1865", repository="Fold3",
              rationale="Pension index cards."),
        _item(5, "probate", "1870-1885"),
        _item(6, "cemetery", "1845-1885"),
    ])
    with pytest.raises(AssertionError, match="reaches 1879"):
        check_reach(BEFORE, after, TAGGED)


def test_fires_on_a_null_range():
    after = _after(CENSUSES + [_item(3, "military", None), _item(4, "military", "")])
    with pytest.raises(AssertionError, match="reaches 1879"):
        check_reach(BEFORE, after, TAGGED)


def test_fires_with_no_military_item():
    after = _after(CENSUSES + [_item(3, "probate", "1870-1900")])
    with pytest.raises(AssertionError, match="items: none"):
        check_reach(BEFORE, after, TAGGED)


def test_a_late_item_that_only_mentions_the_pension_does_not_count():
    after = _after(CENSUSES + [
        _item(3, "military", "1862-1865"),
        _item(4, "cemetery", "1848-1880",
              rationale="A gravestone may note his widow's pension."),
    ])
    with pytest.raises(AssertionError, match="reaches 1879"):
        check_reach(BEFORE, after, TAGGED)


def test_reaching_past_the_window_but_short_of_his_death_fails():
    """The threshold is 1879, stricter than the >1865 hand scoring."""
    after = _after(CENSUSES + [_item(3, "military", "1861-1878")])
    with pytest.raises(AssertionError, match="reaches 1879"):
        check_reach(BEFORE, after, TAGGED)


def test_a_pension_item_in_a_pre_existing_plan_does_not_count():
    before = {"research_json": {"plans": [{"id": "pl_001", "items": [
        _item(1, "military", "1861-1934")]}]}}
    after = {"research_json": {"plans": [
        {"id": "pl_001", "items": [_item(1, "military", "1861-1934")]},
        {"id": "pl_002", "items": [_item(2, "military", "1862-1865")]},
    ]}}
    with pytest.raises(AssertionError, match="reaches 1879"):
        check_reach(before, after, TAGGED)


# --- legitimate variants that must PASS ---------------------------------

@pytest.mark.parametrize("date_range", ["1861-1879", "1861-1880", "1861-1934", "1880-1900"])
def test_passes_when_the_pension_item_reaches_the_file(date_range):
    after = _after(CENSUSES + [_item(3, "military", "1862-1865"),
                               _item(4, "military", date_range)])
    check_reach(BEFORE, after, TAGGED)


@pytest.mark.parametrize("rtype", ["pension", "Military", "military_pension", "Military/Pension"])
def test_record_type_spellings(rtype):
    check_reach(BEFORE, _after(CENSUSES + [_item(3, rtype, "1861-1900")]), TAGGED)


@pytest.mark.parametrize("date_range", ["1861-", "1861 – present", "1861 onward", "1861+"])
def test_open_ended_range(date_range):
    check_reach(BEFORE, _after(CENSUSES + [_item(3, "military", date_range)]), TAGGED)


def test_the_fold3_run():
    after = _after(CENSUSES + [
        _item(3, "military", "1861-1865"),
        _item(4, "military", "1861-1934", repository="Fold3",
              rationale="Fold3 holds the pension case files."),
    ])
    check_reach(BEFORE, after, TAGGED)


# --- gating ------------------------------------------------------------

def test_skips_when_the_tag_is_absent_on_another_test():
    other = {"id": "ut_research_plan_other", "tags": ["planning"]}
    with pytest.raises(pytest.skip.Exception):
        check_reach(BEFORE, _after([_item(1, "census", "1850")]), other)


def test_a_threshold_entry_without_its_tag_is_an_error():
    with pytest.raises(AssertionError, match="no 'pension-reaches-past-window' tag"):
        check_reach(BEFORE, _after([_item(1, "census", "1850")]), UNTAGGED)


def test_the_tag_without_a_threshold_entry_is_an_error():
    stray = {"id": "ut_research_plan_other", "tags": ["pension-reaches-past-window"]}
    with pytest.raises(AssertionError, match="no entry in _PENSION_REACH_BY_TEST_ID"):
        check_reach(BEFORE, _after([_item(1, "military", "1861-1934")]), stray)
