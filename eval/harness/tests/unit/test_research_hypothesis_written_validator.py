"""Direct tests for `test_research.test_reply_does_not_claim_hypothesis_written`.

The validator runs only on a test tagged `claims-no-hypothesis-write`
(`ut_research_9k4`). The must-fail cases include the one committed overclaim,
`eval/runlogs/unit/research/v49.json` run 4, which the judge scored Correctness 3.
The must-pass cases include the committed replies an earlier, negation-blind
pattern flagged (`v31.json` run 1, `v46.json` run 2, `v52.json` run 1) and the
purpose phrasings 9k4's judge_context calls accurate. `testpaths` excludes
`validators/`, which is why they live here.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import (  # noqa: E402
    test_reply_does_not_claim_hypothesis_written as check,
)

TAGGED = {"skill": "research", "tags": ["routing", "claims-no-hypothesis-write"]}

OVERCLAIMS = [
    "The sibling relationship between Nora Stowers, Lois Stowers, and Elizabeth Stouer "
    "has been handed off to register as a hypothesis — the log's inference from "
    "shared surname and birth state now has a formal tracking entry.",
    "The hypothesis has been registered.",
    "The sibling hypothesis is now recorded.",
    "It is now registered as a hypothesis.",
    "That relationship is now tracked as a working hypothesis.",
    "The hypothesis was created and the search can proceed.",
]

ACCURATE = [
    "Because no record directly connects them to Elizabeth, I've handed that off to "
    "register it properly as a hypothesis rather than a stated fact.",
    "That inference has been handed off to be formally registered as a hypothesis so "
    "it can be tracked and tested rather than assumed.",
    "was handed off to be registered as a working hypothesis",
    "handed off to be tracked as one",
    "queued for registration",
    "with no record linking them — but no hypothesis has been registered for that "
    "relationship. That must be handled first.",
    "No hypothesis is registered for this. That's the one step this turn.",
    "**What comes next once the hypothesis is registered:**",
    "Before the hypothesis is recorded, nothing is searched.",
    "has been handed off to be recorded as a formal hypothesis rather than treated as "
    "an established fact.",
]


def _run_tagged(reply: str) -> None:
    """A skip here means the tag gate went dead, which must fail, not pass."""
    try:
        check(reply, TAGGED)
    except pytest.skip.Exception as exc:
        pytest.fail(f"the tagged test was skipped, so the gate is dead: {exc}")


@pytest.mark.parametrize("reply", OVERCLAIMS)
def test_a_claim_the_hypothesis_exists_fails(reply):
    with pytest.raises(AssertionError, match="claims the hypothesis now exists"):
        _run_tagged(reply)


@pytest.mark.parametrize("reply", ACCURATE)
def test_a_hand_off_negation_or_condition_passes(reply):
    _run_tagged(reply)


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check(OVERCLAIMS[0], {"skill": "research", "tags": ["routing"]})


def test_an_empty_reply_passes():
    _run_tagged("")
