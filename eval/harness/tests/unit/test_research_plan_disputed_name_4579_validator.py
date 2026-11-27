"""Proof cases for the issue #4579 research-plan validator.

test_disputed_name_plan_covers_lifetime is shown to fail on planted breaks, in more
than one shape, and to pass legitimate variants.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS))
sys.path.insert(0, str(_HARNESS / "validators"))

from test_research_plan import (  # noqa: E402
    test_disputed_name_plan_covers_lifetime as check,
)

TEST = {"id": "ut_research_plan_c7m", "tags": ["disputed-name-lifetime-coverage"]}


def _item(n, record_type, date_range, status="planned", rationale=""):
    return {
        "id": f"pli_{n:03d}", "sequence": n, "record_type": record_type,
        "jurisdiction": "Goochland County, Virginia", "date_range": date_range,
        "repository": "FamilySearch", "rationale": rationale, "fallback_for": None,
        "status": status,
    }


def _states(items):
    before = {"plans": []}
    after = {"plans": [{"id": "pl_001", "question_id": "q_001", "status": "active", "items": items}]}
    return {"research_json": before}, {"research_json": after}


DEATH = _item(9, "death_record", "1912-1935")


def _run(items, test=TEST):
    before, after = _states(items)
    check(before, after, test)


# --- fails -----------------------------------------------------------------------

def test_a_plan_stopping_at_1900_fails():
    items = [_item(1, "census", "1870"), _item(2, "census", "1880"), _item(3, "census", "1900"),
             _item(4, "vital_record", "1866-1896")]
    with pytest.raises(AssertionError, match="covers 1910, 1920"):
        _run(items)


def test_a_single_1870_1880_census_item_fails():
    with pytest.raises(AssertionError, match="covers 1910, 1920"):
        _run([_item(1, "census", "1870-1880"), DEATH])


def test_a_range_reaching_past_but_not_covering_fails():
    # 1921-1930 reaches past 1920 but covers neither 1910 nor 1920.
    with pytest.raises(AssertionError, match="covers 1910, 1920"):
        _run([_item(1, "census", "1921-1930"), DEATH])


def test_covering_1910_only_fails_on_1920():
    with pytest.raises(AssertionError, match=r"covers 1920,"):
        _run([_item(1, "census", "1910"), DEATH])


def test_a_skipped_census_item_covers_nothing():
    with pytest.raises(AssertionError, match="covers 1910, 1920"):
        _run([_item(1, "census", "1910-1920", status="skipped"), DEATH])


def test_a_non_census_item_does_not_cover_a_census_year():
    # A death item dated 1910-1920 is not a census item.
    with pytest.raises(AssertionError, match="covers 1910, 1920"):
        _run([_item(1, "death_record", "1910-1920")])


def test_no_death_or_vital_item_after_1900_fails():
    items = [_item(1, "census", "1870-1920"), _item(2, "vital_record", "1866-1896")]
    with pytest.raises(AssertionError, match="dated after 1900"):
        _run(items)


def test_a_vital_item_dated_1900_is_not_after_the_record():
    with pytest.raises(AssertionError, match="dated after 1900"):
        _run([_item(1, "census", "1870-1920"), _item(2, "death_record", "1900")])


def test_tagged_but_unkeyed_test_fails():
    with pytest.raises(AssertionError, match="no entry in"):
        _run([_item(1, "census", "1870-1920"), DEATH],
             {"id": "ut_research_plan_zzz", "tags": ["disputed-name-lifetime-coverage"]})


def test_keyed_but_untagged_test_fails():
    with pytest.raises(AssertionError, match="no 'disputed-name-lifetime-coverage' tag"):
        _run([_item(1, "census", "1870-1920"), DEATH], {"id": "ut_research_plan_c7m", "tags": []})


# --- passes ----------------------------------------------------------------------

def test_one_1870_1920_census_item_passes():
    _run([_item(1, "census", "1870–1920"), DEATH])


def test_separate_1910_and_1920_items_pass():
    _run([_item(1, "census", "1870"), _item(2, "census", "1880"), _item(3, "census", "1910"),
          _item(4, "census", "1920"), DEATH])


def test_a_decade_and_an_open_range_pass():
    _run([_item(1, "census", "1910s"), _item(2, "census", "1920-"), _item(3, "cemetery", "1901 onward")])


def test_a_rationale_naming_the_readings_is_not_read():
    rationale = "Keyed on age and household, not on Ottilie, Tillie or Atilla."
    _run([_item(1, "census", "1910", rationale=rationale), _item(2, "census", "1920", rationale=rationale), DEATH])


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        _run([], {"id": "ut_research_plan_wnc", "tags": ["pension-reaches-past-window"]})
