"""Direct tests for question-selection's validators.

Same reason as `test_search_images_validators.py` and its siblings:
`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/`
is collected by `make harness-test`, and a validator's real pass/fail set
would otherwise appear only inside a paid per-skill run.

These pin the three defects EdmondOware's review of PR #1936/#1963 found in
this dive's new validators (test_new_question_not_vague and the disputed-
parents checks), following CLAUDE.md's "a new lint must be proven to fail":

  - `re.IGNORECASE` made `[A-Z]` in the who-is pattern match any letter, so
    "Who is Patrick Flynn's father?" -- a well-formed question -- was flagged
    as vague. Fixed by scoping IGNORECASE off with `(?-i:...)` around the
    name-token group only.
  - `_VERIFY_SIGNALS` was checked against every new question joined into one
    string, so one correctly framed question could mask a co-written bad
    one. Fixed by checking each question independently.
"""

import sys
from pathlib import Path

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validator as a test of this module and error on its
# harness-supplied fixtures. Same pattern as the sibling validator tests.
from test_question_selection import (  # noqa: E402
    test_disputed_parents_missing_info_handled as check_missing_info,
    test_first_question_tests_disputed_parents as check_disputed_parents,
    test_new_question_not_vague as check_not_vague,
    test_timelines_queried_before_deciding as check_timelines_ordering,
    test_unblocks_nonempty as check_unblocks_nonempty,
)

import pytest


def _state(questions):
    return {"research_json": {"questions": questions}}


_EMPTY = _state([])
_DISPUTED_TAGS = {"tags": ["verifies-disputed-parents"]}
_MISSING_INFO_TAGS = {"tags": ["disputed-parents-missing-info"]}
_TIMELINE_TAGS = {"tags": ["selection-basis-timeline-gap"]}
_UNBLOCKS_TAGS = {"tags": ["unblocks-nonempty"]}


def _q(qid, question, **extra):
    return {"id": qid, "question": question, **extra}


# --- test_new_question_not_vague: the who-is / IGNORECASE fix -----------


def test_vague_check_passes_the_recorded_shape():
    """The green case, so the RED cases below mean something."""
    check_not_vague(_EMPTY, _state([_q("q_001", "Who was Patrick Flynn's mother?")]))


def test_who_is_pattern_no_longer_flags_a_specific_parentage_question():
    """Before EdmondOware's fix, re.IGNORECASE made [A-Z] match any letter,
    so this well-formed question -- close to what the skill actually writes
    under a parentage objective -- was flagged as too vague to drive a
    search. It must pass now."""
    check_not_vague(
        _EMPTY, _state([_q("q_001", "Who is Patrick Flynn's father?")])
    )
    check_not_vague(
        _EMPTY,
        _state([_q("q_001", "Who is Patrick Flynn's wife Bridget?")]),
    )


def test_who_is_pattern_still_flags_the_bare_identity_shape():
    """The rubric's own named bad example must still fail -- the fix scopes
    IGNORECASE off the name tokens, not off the whole pattern."""
    with pytest.raises(AssertionError, match="too vague"):
        check_not_vague(_EMPTY, _state([_q("q_001", "Who is Patrick Flynn?")]))


# --- test_first_question_tests_disputed_parents: per-question checking ---


def test_disputed_parents_check_passes_a_correctly_framed_question():
    check_disputed_parents(
        _EMPTY,
        _state(
            [
                _q(
                    "q_001",
                    "Do independent records confirm or refute that Johann "
                    "and Maria Vogt are the parents of Anton Vogt?",
                )
            ]
        ),
        _DISPUTED_TAGS,
    )


def test_disputed_parents_check_catches_a_bad_question_hiding_behind_a_good_one():
    """Before EdmondOware's fix, _VERIFY_SIGNALS was checked against every
    new question joined into one string -- so a correctly framed question
    written alongside a premise-accepting one masked it. Each must now be
    checked independently."""
    with pytest.raises(AssertionError, match="Unframed question"):
        check_disputed_parents(
            _EMPTY,
            _state(
                [
                    _q("q_001", "Who were the parents of Anton Vogt?"),
                    _q(
                        "q_002",
                        "Do independent records confirm or refute that "
                        "Johann and Maria Vogt are the parents of Anton "
                        "Vogt?",
                    ),
                ]
            ),
            _DISPUTED_TAGS,
        )


# --- test_disputed_parents_missing_info_handled: same per-question fix ---


def test_missing_info_check_catches_a_bad_question_hiding_behind_a_good_one():
    with pytest.raises(AssertionError, match="Unframed question"):
        check_missing_info(
            _EMPTY,
            _state(
                [
                    _q("q_001", "Who were the parents of Anton Vogt?"),
                    _q(
                        "q_002",
                        "Do independent records confirm or refute that "
                        "Johann and Maria Vogt are the parents of Anton "
                        "Vogt?",
                    ),
                ]
            ),
            _MISSING_INFO_TAGS,
            "",
        )


def test_missing_info_check_accepts_the_ask_branch():
    check_missing_info(
        _EMPTY,
        _EMPTY,
        _MISSING_INFO_TAGS,
        "Before I can write the right research question, I need two things "
        "from you: what led you to doubt the parents, and the birth date "
        "and place you're working from.",
    )


# --- test_timelines_queried_before_deciding: ordering, not just presence -


def _call(tool, **args):
    return {"tool": tool, "args": args}


def test_timelines_ordering_passes_when_queried_before_the_write():
    check_timelines_ordering(
        _EMPTY,
        [
            _call("mcp__genealogy__research_query", section="timelines"),
            _call("mcp__genealogy__research_append", section="questions"),
        ],
        _TIMELINE_TAGS,
    )


def test_timelines_ordering_fails_when_queried_only_after_the_write():
    """Presence alone used to be enough -- a run that decided first and
    queried timelines only afterward still passed. Must fail now."""
    with pytest.raises(AssertionError, match="before ever calling"):
        check_timelines_ordering(
            _EMPTY,
            [
                _call("mcp__genealogy__research_append", section="questions"),
                _call("mcp__genealogy__research_query", section="timelines"),
            ],
            _TIMELINE_TAGS,
        )


# --- test_unblocks_nonempty --------------------------------------------


def test_unblocks_nonempty_passes_when_populated():
    check_unblocks_nonempty(
        _EMPTY,
        _state([_q("q_003", "Where was Patrick Flynn residing in 1870?", unblocks=["q_001"])]),
        _UNBLOCKS_TAGS,
    )


def test_unblocks_nonempty_fails_when_empty():
    with pytest.raises(AssertionError, match="empty unblocks"):
        check_unblocks_nonempty(
            _EMPTY,
            _state([_q("q_003", "Where was Patrick Flynn residing in 1870?", unblocks=[])]),
            _UNBLOCKS_TAGS,
        )
