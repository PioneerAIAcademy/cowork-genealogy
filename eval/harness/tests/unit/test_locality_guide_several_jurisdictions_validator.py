"""Direct tests for `test_each_jurisdiction_is_its_own_entry`.

Nothing under `validators/` is collected by `make harness-test`, so without these the
validator's pass/fail set would appear only inside a paid per-skill run (issue #4602).
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect it.
from test_locality_guide import (  # noqa: E402
    test_each_jurisdiction_is_its_own_entry as check,
)

TAGGED = {"id": "ut_locality_guide_029", "tags": ["locality-guide", "several-jurisdictions"]}
BEFORE = {"research_json": {"localities": []}}


def _loc(n, for_place, place="Kentucky, United States"):
    return {"id": f"loc_{n:03d}", "place": place, "for_place": for_place, "source": "locality-guide"}


def _after(*locs):
    return {"research_json": {"localities": list(locs)}}


def _survey(standard_place):
    return {"tool": "mcp__genealogy__locality_survey", "args": {"standardPlace": standard_place}}


PULASKI = _survey("Pulaski, Kentucky, United States")
GREENUP = _survey("Greenup, Kentucky, United States")
BOYD = _survey("Boyd, Kentucky, United States")


@pytest.mark.parametrize(
    "locs, calls",
    [
        ([_loc(1, "Pulaski County, Kentucky")], [PULASKI]),
        (
            [_loc(1, "Pulaski County, Kentucky"), _loc(2, "Greenup County, Kentucky"), _loc(3, "Boyd County, Kentucky")],
            [PULASKI, GREENUP, BOYD],
        ),
        ([_loc(1, None, place="Pulaski, Kentucky, United States")], [PULASKI]),
        (
            [{**_loc(1, "Boyd County, Kentucky"), "jurisdictions": [{"name": "Greenup, Kentucky, United States"}]}],
            [BOYD],
        ),
    ],
    ids=["first-only", "each-its-own", "place-without-for-place", "parent-county-in-jurisdictions-is-not-read"],
)
def test_passes(locs, calls):
    check(BEFORE, _after(*locs), calls, TAGGED)


def test_parent_county_named_in_for_place_counts_as_two():
    with pytest.raises(AssertionError, match="for several counties"):
        check(BEFORE, _after(_loc(1, "Boyd County, Kentucky (formed 1860 from Greenup)")), [BOYD], TAGGED)


@pytest.mark.parametrize(
    "locs, calls, match",
    [
        ([], [PULASKI], "no localities entry"),
        ([_loc(1, "Pulaski, Greenup and Boyd counties, Kentucky")], [PULASKI, GREENUP, BOYD], "for several counties"),
        ([_loc(1, "Pulaski County, Kentucky"), _loc(2, "Pulaski County, KY")], [PULASKI], "more than one entry"),
        ([_loc(1, "Pulaski County, Kentucky")], [PULASKI, GREENUP, BOYD], r"surveyed \['Boyd', 'Greenup'\]"),
    ],
    ids=["none-written", "one-entry-three-counties", "county-twice", "surveyed-but-unsaved"],
)
def test_fires(locs, calls, match):
    with pytest.raises(AssertionError, match=match):
        check(BEFORE, _after(*locs), calls, TAGGED)


def test_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check(BEFORE, _after(), [], {"id": "ut_locality_guide_001", "tags": ["locality-guide"]})


def test_a_mapped_test_must_carry_the_tag():
    with pytest.raises(AssertionError, match="no 'several-jurisdictions' tag"):
        check(BEFORE, _after(), [], {"id": "ut_locality_guide_029", "tags": ["locality-guide"]})
