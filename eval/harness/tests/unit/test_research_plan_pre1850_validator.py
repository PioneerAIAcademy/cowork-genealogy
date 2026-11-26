"""Direct tests for `test_pre1850_parentage_plan_puts_child_naming_record_first`.

Issue #4163. Replayed before this file was written against all 18
`ut_research_plan_hoh` scratch runs of 2026-11-06 and 2026-11-10 (three before
the agent edit, fifteen after): every one passes, since each puts a probate,
land or church item ahead of its first 1790-1840 census.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect it.
from test_research_plan import (  # noqa: E402
    test_pre1850_parentage_plan_puts_child_naming_record_first as check_order,
)

TAGGED = {"tags": ["planning", "pre1850-census"]}


def _item(n, record_type, date_range, **kw):
    return {"id": f"pli_{n:03d}", "sequence": n, "record_type": record_type,
            "date_range": date_range, "rationale": "", "status": "planned", **kw}


def _run(items, test=TAGGED):
    """A skip on a tagged test means the tag gate went dead, which must fail."""
    before = {"research_json": {"plans": []}}
    after = {"research_json": {"plans": [{"id": "pl_001", "items": items}]}}
    try:
        check_order(before, after, test)
    except pytest.skip.Exception as exc:
        if "pre1850-census" in test["tags"]:
            pytest.fail(f"the tagged test was skipped, so the gate is dead: {exc}")
        raise


GOOD = [
    _item(1, "probate", "1825-1835"),
    _item(2, "land", "1770-1830"),
    _item(3, "census", "1790-1820"),
]


def test_child_naming_record_ahead_of_census_passes():
    _run(GOOD)


def test_census_first_fails():
    items = [_item(1, "census", "1790-1820"), _item(2, "probate", "1825-1835")]
    with pytest.raises(AssertionError, match="ahead of every record"):
        _run(items)


def test_capitalised_type_and_en_dash_still_fail():
    items = [_item(1, "Census", "1790–1820"), _item(2, "probate", "1825-1835")]
    with pytest.raises(AssertionError, match="ahead of every record"):
        _run(items)


def test_no_child_naming_record_fails():
    items = [_item(1, "census", "1790-1820"), _item(2, "military", "1775-1783")]
    with pytest.raises(AssertionError, match="no record type that can name a child"):
        _run(items)


def test_skipped_child_naming_item_does_not_count():
    items = [_item(1, "probate", "1825-1835", status="skipped"), _item(2, "census", "1790-1820")]
    with pytest.raises(AssertionError, match="no record type that can name a child"):
        _run(items)


def test_1850_census_first_passes():
    items = [_item(1, "census", "1850-1880"), _item(2, "probate", "1825-1835")]
    _run(items)


def test_variant_child_naming_type_passes():
    items = [_item(1, "probate_estate", "1825-1835"), _item(2, "census", "1790-1820")]
    _run(items)


def test_untagged_test_skips():
    items = [_item(1, "census", "1790-1820")]
    with pytest.raises(pytest.skip.Exception):
        _run(items, test={"tags": ["planning"]})
