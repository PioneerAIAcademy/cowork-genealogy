"""Direct tests for two search-images validators the #2490 contract moved.

Every `image_transcribe` call now stages its page under `results/.staging/`,
and the agent reads it rather than relaying it. These pin both directions:
what the change made legitimate passes, and what each validator exists to
catch still fails.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(next(
    q / "eval/harness/validators" for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)))

from test_search_images import (  # noqa: E402
    test_cap_refusal_relayed_and_logged_partial as cap_validator,
    test_no_results_sidecar_written as sidecar_validator,
)

POSITIVE = {"type": "positive", "skill": "search-images"}


def _state(files, log=()):
    return {"files": dict.fromkeys(files, "{}"), "research_json": {"log": list(log)}}


def test_staged_pages_are_not_browse_sidecars():
    before = _state([])
    after = _state(["results/.staging/a.json", "results/.staging/b.json"])
    sidecar_validator(before, after, POSITIVE)


def test_a_finalized_sidecar_still_fails():
    before = _state([])
    after = _state(["results/.staging/a.json", "results/log_004.json"])
    with pytest.raises(AssertionError, match="log_004"):
        sidecar_validator(before, after, POSITIVE)


CAP_TEST = {"type": "positive", "skill": "search-images", "tags": ["cap-refusal"]}
IMAGE_ID = "004452257_00021"
CALLS = [{"tool": "mcp__genealogy__image_transcribe", "args": {"imageId": IMAGE_ID}}]
LOGGED = (
    _state([]),
    _state([], log=[{"id": "log_006", "outcome": "partial"}]),
)
LINK = "https://www.familysearch.org/search/film/004452257?i=20"
REFUSAL = (
    "Image cap reached: 20 distinct images from image group 004452257 have already been "
    f"read in this project. Link: {LINK}"
)
TAIL = (
    "---\n\nThe burial register stopped before the page for 1882. You can finish "
    f"the book by hand from {LINK}.\n\nNext, the burial will be looked for another way."
)


@pytest.mark.parametrize("line", [
    f"NOT READ: {IMAGE_ID}",
    f"- **Image attempted this invocation:** `{IMAGE_ID}` — **NOT READ** — session cap reached",
])
def test_cap_refusal_accepts_either_spelling_of_the_not_read_line(line):
    cap_validator(CALLS, f"{line}\n{REFUSAL}\n{TAIL}", CAP_TEST, *LOGGED)


def test_cap_refusal_ignores_a_fenced_rule_after_the_researcher_paragraph():
    reply = f"NOT READ: {IMAGE_ID}\n{REFUSAL}\n{TAIL}\n```\n---\n```"
    cap_validator(CALLS, reply, CAP_TEST, *LOGGED)


@pytest.mark.parametrize("reply", [
    f"Image {IMAGE_ID} could not be read.\n{REFUSAL}\n{TAIL}",
    f"NOT READ: 004452257_00020\n{REFUSAL}\n{TAIL}",
    f"NOT READ\n{IMAGE_ID}\n{REFUSAL}\n{TAIL}",
])
def test_cap_refusal_without_a_not_read_line_for_the_image_fails(reply):
    with pytest.raises(AssertionError, match="NOT READ"):
        cap_validator(CALLS, reply, CAP_TEST, *LOGGED)


@pytest.mark.parametrize("reply", [
    f"NOT READ: {IMAGE_ID}\n{REFUSAL}",
    f"NOT READ: {IMAGE_ID}\n{REFUSAL}\n---\n\nYou can finish the book by hand at the link above.",
    f"NOT READ: {IMAGE_ID}\nImage cap reached.\n```\n{LINK}\n```\n---\n\nYou can finish the book by hand.",
], ids=["no-rule", "link-only-above-the-rule", "link-only-in-a-fence-above-the-rule"])
def test_cap_refusal_with_the_link_only_above_the_final_rule_fails(reply):
    with pytest.raises(AssertionError, match="after the final"):
        cap_validator(CALLS, reply, CAP_TEST, *LOGGED)
