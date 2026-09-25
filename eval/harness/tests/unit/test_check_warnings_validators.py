"""Direct tests for check-warnings' V1, `test_not_fs_reply_names_no_id`.

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/` is
collected on its own; a gating validator with no test of its own is a check that
nobody has watched fail. Same pattern as `test_person_evidence_validators.py`.

The must-fail replies are the eight sentences that leaked in
`v1_2026-09-21_22-44-38`, copied here verbatim rather than read from the run log
so the evidence survives the harness pruning that log. None of those runs called
`person_quality` (the skill skipped it then), so each is paired with a constructed
`not_familysearch_id` answer — the shape the tool returns now.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix so pytest does not collect it here.
from test_check_warnings import (  # noqa: E402
    test_not_fs_reply_names_no_id as check_not_fs_reply,
)

POSITIVE = {"type": "positive", "tags": []}


def _not_fs(person_id: str) -> dict:
    return {
        "tool": "mcp__genealogy__person_quality",
        "args": {"personId": person_id},
        "response": {
            "ok": False,
            "reason": "not_familysearch_id",
            "errors": ["No FamilySearch quality score was retrieved for this person."],
        },
    }


def _scored(person_id: str) -> dict:
    return {
        "tool": "mcp__genealogy__person_quality",
        "args": {"personId": person_id},
        "response": {"personId": person_id, "overallScore": 0.97, "issueCount": 1,
                     "segment": None, "categories": [], "issues": []},
    }


# (test id, verbatim leaked sentence) from v1_2026-09-21_22-44-38.
COMMITTED_LEAKS = [
    ("001", "Patrick Flynn is `I1` — a synthetic ID."),
    ("002", "Patrick Flynn (I1) and Thomas Flynn (I2) — both synthetic IDs."),
    ("019", "Cornelius Brady is `I1` — a synthetic ID, so I'll run the offline warnings check now."),
    ("009", "Found Ambrose Keane at `I1` — a synthetic ID."),
    ("004", "Cornelius Brady is `I1` — a synthetic ID."),
    ("005", "Since that's a synthetic ID, I'll run the offline warnings check now."),
    ("006", "Ambrose Keane is `I1` — a synthetic ID."),
    ("018", "Patrick Flynn is `I1` — a synthetic ID."),
]

BODY = (
    "WARNINGS FOR: Patrick Flynn (I1)\n"
    "- Death recorded before a child's birth — Implausible.\n"
    "Check the death date against the burial record first."
)


@pytest.mark.parametrize("test_id,leak", COMMITTED_LEAKS)
def test_every_committed_leak_fails(test_id, leak):
    with pytest.raises(AssertionError, match="synthetic"):
        check_not_fs_reply([_not_fs("I1"), _not_fs("I2")], f"{leak}\n\n{BODY}", POSITIVE)


@pytest.mark.parametrize(
    "reply",
    [
        "FamilySearch has no quality score for I1.\n\n" + BODY,          # id in a FS sentence
        "No FamilySearch quality score for (I1).\n\n" + BODY,            # parenthesised
        "The quality check skipped `I1` here.\n\n" + BODY,               # code span, "quality"
        "FamilySearch quality: none for I1.\n\n" + BODY,                 # id then punctuation
        "SYNTHETIC ids have no profile.\n\n" + BODY,                     # capitalised
        "No FamilySearch score is available.\nFamilySearch was not asked.\n\n" + BODY,  # two FS lines
    ],
)
def test_constructed_breaks_fail(reply):
    with pytest.raises(AssertionError):
        check_not_fs_reply([_not_fs("I1")], reply, POSITIVE)


@pytest.mark.parametrize(
    "reply",
    [
        BODY,                                                           # quality left out
        "No FamilySearch quality score was retrieved for this person.\n\n" + BODY,  # one plain line
        "Confirm that Thomas Flynn (I2) is genuinely linked as Patrick's relative.",  # _008, "linked"
        "WARNINGS FOR: Patrick Flynn (I10)\nFamilySearch quality: not retrieved.",    # I10 is not I1
        "Patrick Flynn's dates do not line up; see below.\n\n" + BODY,  # name only
    ],
)
def test_legitimate_replies_pass(reply):
    check_not_fs_reply([_not_fs("I1"), _not_fs("I2")], reply, POSITIVE)


def test_mixed_run_allows_a_normal_quality_section_for_the_familysearch_person():
    """Rule (c) applies only when NO person checked has a score; a real
    FamilySearch person's quality section may mention FamilySearch freely."""
    reply = (
        "WARNINGS FOR: Christian Hole (KD96-TV2)\n"
        "FamilySearch quality: overall 0.97.\n"
        "FamilySearch flags one issue: the burial date is missing.\n\n" + BODY
    )
    check_not_fs_reply([_scored("KD96-TV2"), _not_fs("I1")], reply, POSITIVE)


def test_skips_when_no_person_got_the_not_familysearch_answer():
    with pytest.raises(pytest.skip.Exception):
        check_not_fs_reply([_scored("KD96-TV2")], "Patrick is a synthetic ID.", POSITIVE)


def test_skips_negative_tests():
    with pytest.raises(pytest.skip.Exception):
        check_not_fs_reply([_not_fs("I1")], "synthetic", {"type": "negative", "tags": []})
