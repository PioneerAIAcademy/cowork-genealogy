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
    test_premise_question_names_fact as check_premise,
    test_single_fact_objective_not_narrowed as check_single_fact,
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


# --- test_premise_question_names_fact: the #1394 negative-shape guard ---
#
# Pins the demonstrated reject/accept behaviour of the premise-question-names-fact
# guard (CLAUDE.md "a new lint must be proven to fail" — both directions). The
# guard rejects a bare property test of a name (maiden-vs-married) whose branch
# names no fact, while accepting a question that names the gating fact, and it
# must coexist with #1471's confirm-or-refute framing. Cases mirror the two-way
# demonstration recorded in the PR body. The two residual contrived edge cases
# (cross-clause phrasings) are accepted as-is by decision — the positive class is
# the judge's job — and are deliberately NOT pinned here.

_PREMISE_TAGS = {"tags": ["premise-question-names-fact"]}


def _premise_after(question):
    return _state([_q("q_001", question)])


def test_premise_skips_when_tag_absent():
    # Assert the tag-gate reason specifically, so this can't pass on the other
    # skip path ("missing research.json for diff").
    with pytest.raises(pytest.skip.Exception, match="not a premise-question-names-fact scenario"):
        check_premise(_EMPTY, _premise_after("What was her maiden name?"),
                      {"tags": ["first-question"]})


def test_premise_requires_a_new_question():
    with pytest.raises(AssertionError, match="none was added"):
        check_premise(_EMPTY, _EMPTY, _PREMISE_TAGS)


# Accept: the question names the gating fact (or is #1471), so the guard passes.
@pytest.mark.parametrize("question", [
    "What was Caroline's maiden name?",
    "What was the birth surname of Rosalind Hartwell, born ca. 1855 in Ohio?",  # a "birth surname" fact-naming variant (synonym of maiden name); ut_016 now emits a "maiden name" form
    "Under what surname was Caroline born?",
    "What was Caroline's birth name?",
    "Was Rosalind born with the surname Hartwell, and if not, what was her maiden name?",
    "What maiden name did she use before her marriage?",
    # Exercises the `maiden surname` escape term specifically: the leading
    # "Was it a married name" trips signal 4, and only the `maiden surname`
    # escape alternative rescues it — drop that term and this flips to reject.
    "Was it a married name, and what was her maiden surname?",
    # An intervening parenthetical between the birth/maiden word and the
    # name/surname word is tolerated (#1394 review): "birth (maiden) surname" is
    # a spelling of the same fact as "birth surname", so it escapes — and,
    # because the escape is a global exemption, so does the same question carrying
    # a marriage clause. Drop the parenthetical tolerance and the second flips to
    # reject (the marriage signal fires on a fact-naming question).
    "What was the birth (maiden) surname of Rosalind?",
    "What was the birth (maiden) surname of Rosalind, or was it acquired through marriage?",
    "Do independent records confirm or refute that Johann and Maria Vogt are the parents of Anton Vogt?",
    "Who were Caroline's parents?",  # objective restatement — the judge's call, not this guard's
])
def test_premise_accepts_fact_naming_and_1471(question):
    check_premise(_EMPTY, _premise_after(question), _PREMISE_TAGS)


# Reject: a bare property test of the name whose branch names no fact.
@pytest.mark.parametrize("question", [
    "Was Curtis her maiden or married name?",
    "Was 'Curtis' the maiden name of Caroline?",
    # Exercises the reversed `married or maiden` signal specifically: no leading
    # was/is/did and no other signal matches, so dropping that signal would let
    # this bad either/or through.
    "Should I record Hartwell as her married or maiden name?",
    "Determine whether Curtis was her maiden name or acquired through marriage.",
    "Did she take Hartwell by marriage?",
    "Was 'Hartwell' her maiden or married name, and what surname does the census list?",
    "Was Hartwell her maiden or married name, and what surname did she use after marriage?",
])
def test_premise_rejects_bare_property_test(question):
    with pytest.raises(AssertionError, match="property test of a name"):
        check_premise(_EMPTY, _premise_after(question), _PREMISE_TAGS)


# --- test_single_fact_objective_not_narrowed: the #1394-review paired-fact guard ---
#
# Pins the demonstrated reject/accept/skip behaviour of the single-fact-objective
# guard (CLAUDE.md "a new lint must be proven to fail" -- both directions). It
# rejects narrowing a paired "parents" objective to one side ("who was the
# father...") while accepting the paired restatement ("who were the parents..."),
# and skips when the tag is absent or the objective names no paired fact. Cases
# mirror ut_002's regression (parents -> father) recorded in the PR body.

_SINGLE_FACT_TAGS = {"tags": ["single-fact-objective"]}
_PARENTS_OBJECTIVE = "Identify the parents of Patrick Flynn, born ca. 1845 in Pennsylvania"


def _state_obj(objective, questions):
    return {"research_json": {"project": {"objective": objective}, "questions": questions}}


_EMPTY_PARENTS = _state_obj(_PARENTS_OBJECTIVE, [])


def _parents_after(question):
    return _state_obj(_PARENTS_OBJECTIVE, [_q("q_001", question)])


def test_single_fact_skips_when_tag_absent():
    with pytest.raises(pytest.skip.Exception, match="not a single-fact-objective scenario"):
        check_single_fact(_EMPTY_PARENTS,
                          _parents_after("Who was the father of Patrick Flynn?"),
                          {"tags": ["first-question"]})


def test_single_fact_skips_when_objective_not_paired():
    # A single, non-paired objective: the guard must not fire even on a
    # one-parent question -- proves the paired-fact gate.
    before = _state_obj("Find the birth date of Patrick Flynn", [])
    after = _state_obj("Find the birth date of Patrick Flynn",
                       [_q("q_001", "Who was the father of Patrick Flynn?")])
    with pytest.raises(pytest.skip.Exception, match="objective does not name a paired fact"):
        check_single_fact(before, after, _SINGLE_FACT_TAGS)


# Accept: the paired objective is restated at scope (or the question is unrelated).
@pytest.mark.parametrize("question", [
    "Who were the parents of Patrick Flynn, born ca. 1845 in Pennsylvania?",
    "When and where was Patrick Flynn born?",
    "Who were Patrick Flynn's father and mother?",
])
def test_single_fact_accepts_paired_restatement(question):
    check_single_fact(_EMPTY_PARENTS, _parents_after(question), _SINGLE_FACT_TAGS)


# Reject: the paired objective is narrowed to one side.
@pytest.mark.parametrize("question", [
    "Who was the father of Patrick Flynn, born ca. 1845 in Pennsylvania?",
    "Who was the mother of Patrick Flynn?",
    "Identify the father of Patrick Flynn.",
    # Finding-1 idiomatic variants: possessive form and present tense.
    "Who was Patrick Flynn's father?",
    "Who is Patrick Flynn's father?",
    "Who is Patrick Flynn's mother?",
    "Who is the father of Patrick Flynn?",
])
def test_single_fact_rejects_one_side_narrowing(question):
    with pytest.raises(AssertionError, match="narrowed to"):
        check_single_fact(_EMPTY_PARENTS, _parents_after(question), _SINGLE_FACT_TAGS)
