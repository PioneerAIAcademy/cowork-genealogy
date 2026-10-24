"""Direct tests for `test_bounded_transcription_is_delivered_in_place` (#2490).

A bounded transcription used to be a hand-off to the image-reader agent; since
that agent's retirement the router calls `image_transcribe` and reads the staged
page with `sidecar_read`. These pin the validator against each way that can go
wrong.
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
    test_bounded_transcription_is_delivered_in_place as validator,
)

REF = "results/.staging/abc.json"
TEST = {"skill": "research", "tags": ["transcribes-in-place", "bounded-request"]}


def _transcribe(*, project_path="/ws", ref=REF):
    return {
        "tool": "mcp__genealogy__image_transcribe",
        "args": {"imageId": "004022578_00190", **({"projectPath": project_path} if project_path else {})},
        "response": {"staged": {"resultsRef": ref, "returnedCount": 1} if ref else None},
    }


def _read(ref=REF):
    return {"tool": "mcp__genealogy__sidecar_read", "args": {"projectPath": "/ws", "ref": ref}}


def test_transcribe_then_read_the_staged_ref_passes():
    validator(["research"], [], [_transcribe(), _read()], TEST)


def test_a_batch_read_naming_the_ref_passes():
    read = {"tool": "sidecar_read", "args": {"projectPath": "/ws", "refs": ["x", REF]}}
    validator([], [], [_transcribe(), read], TEST)


def test_no_transcribe_call_fails():
    with pytest.raises(AssertionError, match="never called image_transcribe"):
        validator([], [], [], TEST)


def test_a_call_without_project_path_fails():
    with pytest.raises(AssertionError, match="without a projectPath"):
        validator([], [], [_transcribe(project_path=None), _read()], TEST)


def test_an_unstaged_page_fails():
    with pytest.raises(AssertionError, match="staged"):
        validator([], [], [_transcribe(ref=None)], TEST)


def test_never_reading_the_staged_page_fails():
    with pytest.raises(AssertionError, match="never read"):
        validator([], [], [_transcribe(), _read("results/.staging/other.json")], TEST)


def test_a_hand_off_on_a_single_bounded_ask_fails():
    with pytest.raises(AssertionError, match="hands off to nothing"):
        validator(["research", "question-selection"], [], [_transcribe(), _read()], TEST)


def test_a_compound_ask_may_hand_off_the_other_deliverable():
    tagged = dict(TEST, tags=["transcribes-in-place", "delivers:research-plan"])
    validator(["research", "research-plan"], [], [_transcribe(), _read()], tagged)


def test_an_untagged_test_skips():
    with pytest.raises(pytest.skip.Exception):
        validator([], [], [], {"tags": ["bounded-request"]})
