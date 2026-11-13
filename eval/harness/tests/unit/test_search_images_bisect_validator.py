"""Direct tests for the search-images bisect-navigation validator (#4413).

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/` is
collected by `make harness-test`; without these the validator's pass/fail set
would show only inside a paid search-images run.

image_search answers with `imageIdRanges` and volume_bisect's bracket names
`lowImageId`. A read passes only when it is inside one returned range AND at or
after `lowImageId`. The case that pins the first half is a read after
`lowImageId` but outside the group's range, which a `lowImageId`-only check
passes.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_images import (  # noqa: E402
    test_bisect_before_transcribe as check_bisect,
)

_GROUP = "008230326_001_M964-RDH"
_TEST = {"type": "positive", "tags": ["browse", "bisect-navigation"]}


def _listing(ranges, group=_GROUP):
    return {
        "tool": "mcp__genealogy__image_search",
        "args": {"imageGroupNumber": group},
        "response": {"imageCount": 370, "imageIdRanges": ranges},
    }


def _bisect(low_image_id="008230326_00075"):
    bracket = {"lowPosition": 74, "lowYear": 1852, "highPosition": 75, "highYear": 1853,
               "highImageId": "008230326_00076"}
    if low_image_id is not ...:
        bracket["lowImageId"] = low_image_id
    return {
        "tool": "mcp__genealogy__volume_bisect",
        "args": {"imageGroupNumber": _GROUP, "targetYear": 1853},
        "response": {"bracket": bracket, "confidence": "resolved", "stopped": "adjacent"},
    }


def _read(image_id):
    return {"tool": "mcp__genealogy__image_transcribe", "args": {"imageId": image_id}}


_ONE_RANGE = [["008230326_00001", "008230326_00370"]]


def _calls(*reads, ranges=_ONE_RANGE, bisect=None, listing=True):
    calls = [_listing(ranges)] if listing else []
    calls.append(bisect or _bisect())
    calls.extend(_read(r) for r in reads)
    return calls


def test_passes_on_reads_from_the_bracket_forward():
    check_bisect(_calls("008230326_00076", "008230326_00078"), _TEST)


def test_passes_on_the_low_image_itself():
    check_bisect(_calls("008230326_00075"), _TEST)


def test_passes_on_a_read_in_the_second_of_two_ranges():
    ranges = [["008230326_00001", "008230326_00079"], ["008230326_00081", "008230326_00370"]]
    check_bisect(_calls("008230326_00090", ranges=ranges), _TEST)


def test_passes_on_a_read_of_a_later_film_in_the_same_group():
    ranges = [["008230326_00001", "008230326_00370"], ["008230327_00001", "008230327_00050"]]
    check_bisect(_calls("008230327_00010", ranges=ranges, bisect=_bisect("008230326_00300")), _TEST)


def test_fails_on_a_read_of_an_earlier_film_in_the_same_group():
    ranges = [["008230325_00001", "008230325_00050"], ["008230326_00001", "008230326_00370"]]
    with pytest.raises(AssertionError, match="008230325_00010"):
        check_bisect(_calls("008230325_00010", ranges=ranges), _TEST)


def test_fails_on_a_read_before_the_low_image():
    with pytest.raises(AssertionError, match="lowImageId"):
        check_bisect(_calls("008230326_00074"), _TEST)


def test_fails_on_a_read_after_the_low_image_but_outside_the_group():
    with pytest.raises(AssertionError, match="008230326_00400"):
        check_bisect(_calls("008230326_00400"), _TEST)


def test_fails_on_a_read_in_the_gap_between_ranges():
    ranges = [["008230326_00001", "008230326_00079"], ["008230326_00081", "008230326_00370"]]
    with pytest.raises(AssertionError, match="008230326_00080"):
        check_bisect(_calls("008230326_00080", ranges=ranges), _TEST)


def test_fails_on_a_read_of_another_film():
    with pytest.raises(AssertionError, match="008230327_00080"):
        check_bisect(_calls("008230327_00080"), _TEST)


def test_fails_with_a_message_when_the_group_was_never_listed():
    with pytest.raises(AssertionError, match="imageIdRanges"):
        check_bisect(_calls("008230326_00076", listing=False), _TEST)


@pytest.mark.parametrize("low_image_id", [..., "", "75", None, "008230326_75"])
def test_fails_with_a_message_when_low_image_id_is_unusable(low_image_id):
    with pytest.raises(AssertionError, match="lowImageId"):
        check_bisect(_calls("008230326_00076", bisect=_bisect(low_image_id)), _TEST)


def test_fails_when_a_page_is_read_before_the_first_bisect():
    calls = [_listing(_ONE_RANGE), _read("008230326_00076"), _bisect()]
    with pytest.raises(AssertionError, match="before the first volume_bisect"):
        check_bisect(calls, _TEST)


def test_skips_without_the_bisect_navigation_tag():
    with pytest.raises(pytest.skip.Exception):
        check_bisect(_calls("008230326_00001"), {"type": "positive", "tags": ["browse"]})
