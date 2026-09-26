"""Direct tests for check-warnings' V1, `test_not_fs_reply_names_no_id`.

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/` is
collected on its own; a gating validator with no test of its own is a check that
nobody has watched fail. Same pattern as `test_person_evidence_validators.py`.

Must-fail replies are real leaks, copied verbatim so the evidence survives the
harness pruning their run logs: the 8 "synthetic ID" openers from
`v1_2026-09-21_22-44-38`, and the 4 id-type remarks the skill made on
2026-09-25 when the tool answered with a sentence that gave no reason. None of
the 2026-09-21 runs called `person_quality`, so each is paired with a constructed
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
NEUTRAL = "No FamilySearch quality score was retrieved for this person."


def _named(name: str) -> str:
    return f"{name} isn't linked to FamilySearch, so there's no FamilySearch quality score."


def _not_fs(person_id: str, sentence: str = NEUTRAL) -> dict:
    return {
        "tool": "mcp__genealogy__person_quality",
        "args": {"personId": person_id, "projectPath": "/p"},
        "response": {"ok": False, "reason": "not_familysearch_id", "errors": [sentence]},
    }


def _scored(person_id: str) -> dict:
    return {
        "tool": "mcp__genealogy__person_quality",
        "args": {"personId": person_id},
        "response": {"personId": person_id, "overallScore": 0.97, "issueCount": 1,
                     "segment": None, "categories": [], "issues": []},
    }


BODY = (
    "WARNINGS FOR: Patrick Flynn (I1)\n"
    "- Death recorded before a child's birth — Implausible.\n"
    "Check the death date against the burial record first."
)

# Real leaks, verbatim.
SYNTHETIC_LEAKS = [  # v1_2026-09-21_22-44-38
    "Patrick Flynn is `I1` — a synthetic ID.",
    "Patrick Flynn (I1) and Thomas Flynn (I2) — both synthetic IDs.",
    "Cornelius Brady is `I1` — a synthetic ID, so I'll run the offline warnings check now.",
    "Found Ambrose Keane at `I1` — a synthetic ID.",
    "Cornelius Brady is `I1` — a synthetic ID.",
    "Since that's a synthetic ID, I'll run the offline warnings check now.",
    "Ambrose Keane is `I1` — a synthetic ID.",
    "Patrick Flynn is `I1` — a synthetic ID.",
]
ID_TYPE_LEAKS = [  # scratch_2026-09-25_13-4*, the neutral-sentence round
    "`I1` is a local project ID, not a FamilySearch person ID, so no live quality score was fetched — this is expected, not an error.",
    "*Note: This person's ID (`I1`) is a local project ID, not a FamilySearch ID, so no live FamilySearch quality score was fetched.*",
    "**FamilySearch Quality:** Not applicable — Owen Brady does not have a FamilySearch ID, so no live quality score was retrieved.",
    "*(FamilySearch quality score is not applicable here — `I1` is a local project ID, not a FamilySearch person ID.)*",
]


@pytest.mark.parametrize("leak", SYNTHETIC_LEAKS + ID_TYPE_LEAKS)
def test_every_real_leak_fails(leak):
    with pytest.raises(AssertionError):
        check_not_fs_reply([_not_fs("I1"), _not_fs("I2")], f"{leak}\n\n{BODY}", POSITIVE)


@pytest.mark.parametrize(
    "reply",
    [
        "FamilySearch has no quality score for I1.\n\n" + BODY,          # id in a FS sentence
        "No FamilySearch quality score for (I1).\n\n" + BODY,            # parenthesised
        "The quality check skipped `I1` here.\n\n" + BODY,               # code span, "quality"
        "FamilySearch quality: none for I1.\n\n" + BODY,                 # mixed-case label is not a heading
        "SYNTHETIC ids have no profile.\n\n" + BODY,                     # capitalised
        _named("Patrick Flynn") + "\nI1 is a project id, not a FamilySearch id.\n\n" + BODY,
        "Patrick has no FamilySearch ID, so nothing was scored.\n\n" + BODY,
    ],
)
def test_constructed_breaks_fail(reply):
    with pytest.raises(AssertionError):
        check_not_fs_reply([_not_fs("I1", _named("Patrick Flynn"))], reply, POSITIVE)


@pytest.mark.parametrize(
    "reply",
    [
        BODY,                                                            # quality left out
        BODY + "\n\n" + NEUTRAL,                                         # the neutral sentence
        BODY + "\n\n" + _named("Patrick Flynn"),                         # the named sentence
        BODY + "\n\n*" + _named("Patrick Flynn") + "*",                  # emphasised
        # a heading above the sentence — including the report's "(I1)" naming style
        BODY + "\n\n## FAMILYSEARCH QUALITY: Patrick Flynn (I1)\n" + _named("Patrick Flynn"),
        BODY + "\n\n**FamilySearch quality score:**\n" + _named("Patrick Flynn"),
        # true advice after it
        BODY + "\n\n" + _named("Patrick Flynn") + "\nLinking his profile to FamilySearch would give you a live quality score.",
        "Confirm that Thomas Flynn (I2) is genuinely linked as Patrick's relative.",  # _008, "linked"
        "WARNINGS FOR: Patrick Flynn (I10)\n" + NEUTRAL,                  # I10 is not I1
        "Patrick Flynn's dates do not line up; see below.\n\n" + BODY,   # name only
    ],
)
def test_legitimate_replies_pass(reply):
    check_not_fs_reply([_not_fs("I1", _named("Patrick Flynn")), _not_fs("I2")], reply, POSITIVE)


def test_two_people_two_named_sentences_pass():
    """ut_check_warnings_002 checks I1 and I2 in one run: one sentence each."""
    reply = (
        BODY + "\n\n" + _named("Patrick Flynn") + "\n\n"
        "WARNINGS FOR: Thomas Flynn (I2)\nNo warnings.\n\n" + _named("Thomas Flynn")
    )
    check_not_fs_reply(
        [_not_fs("I1", _named("Patrick Flynn")), _not_fs("I2", _named("Thomas Flynn"))],
        reply, POSITIVE,
    )


def test_mixed_run_allows_a_normal_quality_section_for_the_familysearch_person():
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
