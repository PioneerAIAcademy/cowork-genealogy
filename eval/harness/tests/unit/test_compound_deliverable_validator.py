"""Direct tests for `test_every_bounded_deliverable_is_handed_off` (#2813 item 1).

A blind review proved the compound-ask eval test could not fail for the
regression it names: `test_routes_to_expected_skill` grades only `delegations[0]`,
so "deliver the transcription, drop the plan" (the pre-change behaviour) passed.
These pin the new validator against that exact shape.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(next(
    q / "eval/harness/validators" for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)))

from test_research import (  # noqa: E402
    test_every_bounded_deliverable_is_handed_off as validator,
)

TAGS = {"tags": ["delivers:image-reader", "delivers:research-plan"]}


def _skill_calls(*names):
    """`handoffs()` takes skills_invoked as a list[str], not dicts."""
    return list(names)


def test_both_deliverables_handed_off_passes():
    validator(_skill_calls("image-reader", "research-plan"), [], TAGS)


def test_the_other_order_also_passes():
    """The body imposes no ordering, so grading one would fail a correct run."""
    validator(_skill_calls("research-plan", "image-reader"), [], TAGS)


def test_dropping_the_second_deliverable_fails():
    """THE regression. routes-to: passed this shape, which is why it exists."""
    with pytest.raises(AssertionError, match="Never handed off"):
        validator(_skill_calls("image-reader"), [], TAGS)


def test_the_job_path_fails():
    with pytest.raises(AssertionError, match="job"):
        validator(_skill_calls("question-selection", "image-reader", "research-plan"), [], TAGS)


def test_an_untagged_test_skips():
    with pytest.raises(pytest.skip.Exception):
        validator(_skill_calls("image-reader"), [], {"tags": ["routing"]})


def test_an_empty_tag_value_is_rejected():
    with pytest.raises(AssertionError, match="empty"):
        validator(_skill_calls("image-reader"), [], {"tags": ["delivers:"]})


def test_the_skill_under_test_is_stripped_from_the_front():
    """A slash-command entry records `research` FIRST (issue #3116), so a raw
    handed[0] is the router itself and the first-hand-off assertion would fail on
    every real run. A claim audit caught this before a paid run did."""
    tagged = dict(TAGS, skill="research")
    validator(_skill_calls("research", "image-reader", "research-plan"), [], tagged)


def test_the_job_path_still_fails_after_the_strip():
    tagged = dict(TAGS, skill="research")
    with pytest.raises(AssertionError, match="job"):
        validator(_skill_calls("research", "question-selection", "image-reader",
                               "research-plan"), [], tagged)
