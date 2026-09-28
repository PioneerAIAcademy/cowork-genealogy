"""Direct tests for check-warnings' V3, `test_hand_back_names_its_owner`.

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/` is
collected on its own; a gating validator with no test of its own is a check that
nobody has watched fail. Same pattern as `test_person_evidence_validators.py`.

V3 grades the hand-back the check-warnings agent returns for an out-of-lane
request (lead ruling 2026-09-23, issue #2118): no tool call, and the owner —
`negative.correct_skill[0]` — named in the reply. On the direct arm the reply is
the main thread's relay, which may reword the return, so the relay shapes below
must pass as long as the owner is named.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix so pytest does not collect it here.
from test_check_warnings import (  # noqa: E402
    test_hand_back_names_its_owner as check_hand_back,
)


def _spec(owner: str = "conflict-resolution") -> dict:
    return {
        "type": "negative",
        "tags": ["negative", "boundary", "hand-back", "direct-arm"],
        "negative": {"correct_skill": [owner], "grade_on_invariant": True},
    }


RESEARCHER = (
    "Two records disagree about where he was born, so nothing was checked here.\n"
    "Next, the two records will be compared to see which one is right."
)
AGENT_RETURN = "Hand-back: conflict-resolution — two sources disagree on the birth county.\n---\n" + RESEARCHER
WARNINGS_CALL = {"tool": "person_warnings", "args": {"personId": "I1"}, "response": {}}


@pytest.mark.parametrize(
    "reply",
    [
        AGENT_RETURN,
        "Here is what the check-warnings agent returned:\n\n" + AGENT_RETURN,
        AGENT_RETURN + "\n---\nThe agent handed this to conflict-resolution.",
        "The agent says this is a source conflict for conflict-resolution, not a warning.",
        "Hand-back:\n  Conflict-Resolution — the census and the death certificate disagree.",
    ],
    ids=["verbatim", "relay-preamble", "relay-appended-rule", "relay-paraphrase", "reflowed-capitals"],
)
def test_a_named_owner_passes_whatever_the_relay_did(reply):
    check_hand_back([], reply, _spec())


def test_the_owner_is_read_off_the_test():
    check_hand_back([], "Hand-back: source-evaluation — audit the attached sources.", _spec("source-evaluation"))
    with pytest.raises(AssertionError, match="never names source-evaluation"):
        check_hand_back([], AGENT_RETURN, _spec("source-evaluation"))


def test_a_tool_call_fails():
    with pytest.raises(AssertionError, match="makes no tool call"):
        check_hand_back([WARNINGS_CALL], AGENT_RETURN, _spec())


@pytest.mark.parametrize(
    "reply",
    ["Hand-back: this is a source conflict.\n---\n" + RESEARCHER, "", None],
    ids=["no-owner", "empty", "none"],
)
def test_no_owner_named_fails(reply):
    with pytest.raises(AssertionError, match="never names conflict-resolution"):
        check_hand_back([], reply, _spec())


def test_a_test_with_no_owner_is_refused():
    spec = _spec()
    spec["negative"]["correct_skill"] = []
    with pytest.raises(AssertionError, match="must name its owner"):
        check_hand_back([], AGENT_RETURN, spec)


def test_skips_without_the_hand_back_tag():
    with pytest.raises(pytest.skip.Exception):
        check_hand_back([WARNINGS_CALL], "", {"type": "positive", "tags": ["direct-arm"]})
