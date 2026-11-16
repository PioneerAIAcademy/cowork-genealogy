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

Also pins `test_handback_not_record_scoped`'s `_last_sentence` fix (PR #4466
review item 1): a naive split on [.!?] breaks on a single-letter initial
or a date qualifier ("Thomas J. Flynn", "b. ca. 1795"), which silently
drops an earlier record mention from what gets checked -- a false
negative, not a false positive. Three observed-shape sentences that must
still fail, and the issue's own worked example that must still pass.
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
    test_handback_not_record_scoped as check_handback,
    test_new_question_has_date_window as check_date_window,
    test_motivation_objective_decomposed as check_motivation,
    test_new_question_not_vague as check_not_vague,
    test_premise_question_names_fact as check_premise,
    test_question_selection_one_new_question as check_one_new_question,
    test_single_fact_objective_not_narrowed as check_single_fact,
    test_unblocks_nonempty as check_unblocks_nonempty,
)

import pytest


def _state(questions):
    return {"research_json": {"questions": questions}}


_EMPTY = _state([])
_DISPUTED_TAGS = {"tags": ["verifies-disputed-parents"]}
_MISSING_INFO_TAGS = {"tags": ["disputed-parents-missing-info"]}
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
    # a spelling of the same fact as "birth surname", so it escapes. (Its
    # trailing-marriage-clause twin moved to the reject list on 2026-09-30.)
    "What was the birth (maiden) surname of Rosalind?",
    # Real ut_016 questions (2026-09-30/10-01) that end at the value. Descriptive
    # clauses identifying the person are not a classification.
    "What was the birth surname of Rosalind Hartwell (b. ca. 1855, Ohio), who is recorded in a compiled source under the surname 'Hartwell' and is known to have been married to Thomas Hartwell?",
    "What was the birth (maiden) surname of Rosalind Hartwell, born circa 1855 in Ohio, who married Thomas Hartwell?",
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
    # A value question that then re-asks the recorded name as a choice fails
    # (genealogist ruling, 2026-09-30). The last three are real ut_016 questions.
    "What was the birth (maiden) surname of Rosalind, or was it acquired through marriage?",
    "What was Rosalind Hartwell's birth surname — was 'Hartwell' her maiden name or the married name she acquired from her husband Thomas Hartwell?",
    "What was the birth surname of Rosalind Hartwell (b. ca. 1855, Ohio), the wife of Thomas Hartwell — was 'Hartwell' her maiden name or her married name?",
    "What was the birth surname of Rosalind Hartwell (b. ca. 1855, Ohio), whose recorded surname 'Hartwell' may be her maiden name or the married name of her husband Thomas Hartwell?",
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


# --- test_motivation_objective_decomposed: the #2003 "why" guard ----------

_MOTIVATION_TAGS = {"tags": ["motivation-objective-decomposed"]}


@pytest.mark.parametrize(
    "question",
    [
        "Why did Patrick Flynn's family move to Schuylkill County between 1850 and 1880?",
        "WHY did the Morgans move to Texas?",
        "What led Patrick Flynn's family to settle in Schuylkill County?",
        "For what reason did the family leave Ireland?",
        "What were the reasons the Flynn family relocated to Pennsylvania?",
        "Did Michael Sheahan move to Schuylkill County, Pennsylvania around 1882 for anthracite coal-mining work, as family tradition holds?",
        "Did the Morgans move to Texas to join relatives already living there?",
        "Did the family migrate because of the 1883 death of Eugene McElwee?",
        "What brought Patrick Flynn's family to Schuylkill County?",
        "What drew the Flynn family to Pennsylvania?",
    ],
)
def test_motivation_rejects_a_question_asking_the_reason(question):
    after = _state([_q("q_001", question)])
    with pytest.raises(AssertionError, match="motivation objective"):
        check_motivation(_EMPTY, after, _MOTIVATION_TAGS)


@pytest.mark.parametrize(
    "question",
    [
        "When did Patrick Flynn's family arrive in Schuylkill County, Pennsylvania?",
        "Where did Patrick Flynn's family live before Schuylkill County?",
        "Who were Patrick Flynn's parents, b. ca. 1845, Pennsylvania?",
        "Which of Clorinda Sleeper's brothers were living in the Texas county before 1880?",
        "Did Patrick Flynn's parents move to Schuylkill County before 1860?",
        "When did the Morgan family arrive in Texas?",
        "What ship brought Patrick Flynn's family to Philadelphia?",
    ],
)
def test_motivation_accepts_a_relationship_or_event_question(question):
    after = _state([_q("q_001", question)])
    check_motivation(_EMPTY, after, _MOTIVATION_TAGS)


def test_motivation_fails_when_no_question_is_written():
    with pytest.raises(AssertionError, match="none was written"):
        check_motivation(_EMPTY, _EMPTY, _MOTIVATION_TAGS)


def test_motivation_one_bad_question_is_not_masked_by_a_good_one():
    after = _state([
        _q("q_001", "When did the Morgan family arrive in Texas?"),
        _q("q_002", "Why did the Morgans move to Texas?"),
    ])
    with pytest.raises(AssertionError, match="q_002"):
        check_motivation(_EMPTY, after, _MOTIVATION_TAGS)


def test_motivation_skips_without_its_tag():
    after = _state([_q("q_001", "Why did the Morgans move to Texas?")])
    with pytest.raises(pytest.skip.Exception):
        check_motivation(_EMPTY, after, {"tags": []})


# --- test_new_question_has_date_window (#2424) ----------------------------


def test_date_window_passes_a_well_formed_window():
    check_date_window(_EMPTY, _state([_q("q_001", "When did he marry?", date_window="1777-1799")]))
    check_date_window(_EMPTY, _state([_q("q_001", "When did he marry?", date_window="1850-1850")]))


@pytest.mark.parametrize("window", [None, "", "1800", "c. 1780s", "1799-1777", 1780])
def test_date_window_fails_a_missing_or_malformed_window(window):
    extra = {} if window is None else {"date_window": window}
    with pytest.raises(AssertionError, match="date_window"):
        check_date_window(_EMPTY, _state([_q("q_001", "When did he marry?", **extra)]))


def test_date_window_one_bad_question_is_not_masked_by_a_good_one():
    with pytest.raises(AssertionError, match="q_002"):
        check_date_window(_EMPTY, _state([
            _q("q_001", "When did he marry?", date_window="1777-1799"),
            _q("q_002", "Who were his parents?"),
        ]))


def test_date_window_ignores_questions_that_already_existed():
    old = _q("q_001", "Who were his parents?")
    check_date_window(_state([old]), _state([old]))


# --- test_handback_not_record_scoped: the #4166-review _last_sentence fix ---
#
# Pins the fix to `_last_sentence`'s abbreviation-rejoin logic (PR #4466 review
# item 1): a naive split on [.!?] breaks on a single-letter initial or a date
# qualifier ("Thomas J. Flynn", "b. ca. 1795"), silently dropping an earlier
# record mention from what gets checked -- a false negative. Both directions
# per CLAUDE.md's "a new lint must be proven to fail": the three reviewer-given
# sentences must fail, and the issue's own worked example must still pass.


def _before(has_planned=False, has_in_progress=False):
    items = []
    if has_planned:
        items.append({"id": "pli_001", "status": "planned"})
    if has_in_progress:
        items.append({"id": "pli_002", "status": "in_progress"})
    return {"research_json": {"plans": [{"items": items}] if items else []}}


def _reply(caller_lines: str, summary_tail: str) -> str:
    return (
        f"{caller_lines}\n\n---\n\n"
        "Some plain-language paragraph about the question.\n\n"
        f"{summary_tail}"
    )


def _test_dict():
    return {"delegation": "Select and record the next research question.\n\nprojectPath: <workspace>"}


_SENTENCE_LEAK_CASES = [
    "Next, the 1850 census will be searched for Thomas J. Flynn.",
    "Next I will search the 1850 census for Reuben Hollis, b. ca. 1795, of Rowan County.",
    "Research will check the U.S. census for Thomas J. Flynn.",
]


@pytest.mark.parametrize("summary_tail", _SENTENCE_LEAK_CASES)
def test_fires_on_record_leaked_past_an_abbreviation(summary_tail):
    """Before the fix, `_last_sentence` split right after "J." / "ca." and
    returned only the fragment past it, so the record mention earlier in
    the same sentence never reached the pattern check."""
    reply = _reply("**Next step:** plan research for this question.", summary_tail)
    with pytest.raises(AssertionError, match="names a record"):
        check_handback(
            before_state=_before(),
            text_response=None,
            test=_test_dict(),
            agent_returns=[{"subagent_type": "question-selection", "text": reply}],
        )


def test_passes_the_issues_own_worked_example():
    """The issue's own legitimate return -- "Sr." must not be read as a
    sentence boundary either."""
    reply = _reply(
        "**Next step:** plan research for this question.",
        "A research plan will now be built to test whether Paul Sr. was his father.",
    )
    check_handback(
        before_state=_before(),
        text_response=None,
        test=_test_dict(),
        agent_returns=[{"subagent_type": "question-selection", "text": reply}],
    )


def test_carve_out_covers_in_progress_not_only_planned():
    """A plan item already `in_progress` (not merely `planned`) was already
    weighed by research-plan; naming it is describing the plan, not
    choosing a record (ut_question_selection_001, ut_question_selection_d01).
    The validator itself `pytest.skip`s this case -- the carve-out IS a skip,
    not a clean pass -- so confirming that is what proves it fired."""
    reply = _reply(
        '**Next step:** Complete `pli_006` -- the Thomas Flynn probate search on FamilySearch.',
        "Once the probate search is complete, the question can be concluded.",
    )
    with pytest.raises(pytest.skip.Exception):
        check_handback(
            before_state=_before(has_in_progress=True),
            text_response=None,
            test=_test_dict(),
            agent_returns=[{"subagent_type": "question-selection", "text": reply}],
        )


def test_no_carve_out_still_fires_on_a_record_name():
    """Without any planned/in_progress item on the project, naming a record
    is still a violation -- the carve-out test above is not vacuously
    passing because the check never fires at all."""
    reply = _reply(
        '**Next step:** Complete `pli_006` -- the Thomas Flynn probate search on FamilySearch.',
        "Once the probate search is complete, the question can be concluded.",
    )
    with pytest.raises(AssertionError, match="names a record"):
        check_handback(
            before_state=_before(),
            text_response=None,
            test=_test_dict(),
            agent_returns=[{"subagent_type": "question-selection", "text": reply}],
        )


@pytest.mark.parametrize("sentence", [
    "Searches for her will be planned next.",
    "The search for her will begin by working from the household Thomas Flynn headed.",
    "The search for their will need the 1850 household first.",
])
def test_will_pattern_does_not_flag_the_modal_verb(sentence):
    """Pins `_MODAL_VERB_AFTER` (ut_question_selection_007's run-0 fails): "her
    will be planned" and "her will begin" are the modal auxiliary, not "her
    will" the legal document, and must not fire."""
    reply = _reply(
        "**Next step:** plan research for this question.",
        sentence,
    )
    check_handback(
        before_state=_before(),
        text_response=None,
        test=_test_dict(),
        agent_returns=[{"subagent_type": "question-selection", "text": reply}],
    )


@pytest.mark.parametrize("sentence", [
    "Her will names her surviving children.",
    "Search his will for the children's names.",
    "Their will, dated 1870, names the heirs.",
])
def test_will_pattern_still_flags_the_document_noun(sentence):
    """The pattern must still catch the actual document: "her will" as a
    noun, not followed by a base verb, is unaffected by the modal carve-out."""
    reply = _reply(
        "**Next step:** plan research for this question.",
        sentence,
    )
    with pytest.raises(AssertionError, match="names a record"):
        check_handback(
            before_state=_before(),
            text_response=None,
            test=_test_dict(),
            agent_returns=[{"subagent_type": "question-selection", "text": reply}],
        )


# --- test_handback_not_record_scoped: naming an existing question is not a record pick ---
#
# The Return contract tells the agent to name other questions by their text; the
# Flynn fixtures' q_002 is "Where was Patrick Flynn in the 1850 census?", and a
# user can type a question like it. Lead, 2026-11-16: "a line that refers to
# q_002 is this case. Any other line that names a record is a real failure."
# The 1870-census case is the one that separates "the word is part of naming
# the question" from "the word appears in some question" -- the latter would
# switch `census` off in every Flynn project.

_CENSUS_Q002 = {"id": "q_002", "question": "Where was Patrick Flynn in the 1850 census?", "status": "resolved"}
_PARENTS_Q001 = {"id": "q_001", "question": "Who were the parents of Patrick Flynn?", "status": "in_progress"}


def _before_with(questions):
    return {"research_json": {"plans": [], "questions": questions}}


def _check(questions, summary_tail, caller="**Next step:** plan research for this question."):
    check_handback(
        before_state=_before_with(questions),
        text_response=None,
        test=_test_dict(),
        agent_returns=[{"subagent_type": "question-selection", "text": _reply(caller, summary_tail)}],
    )


@pytest.mark.parametrize("sentence", [
    "The census question is resolved.",
    "The 1850 census question still needs its own write-up.",
    "The q_002 census question is resolved.",
    "The second question, q_002 (where Patrick was in the 1850 census), is marked resolved.",
])
def test_naming_an_existing_census_question_passes(sentence):
    _check([_PARENTS_Q001, _CENSUS_Q002], sentence)


def test_naming_an_existing_census_question_passes_in_the_caller_line():
    _check(
        [_PARENTS_Q001, _CENSUS_Q002],
        "The next step is to plan the search for his mother.",
        caller="- **Depends on:** q_001; q_002 (the 1850 census question) is resolved.",
    )


@pytest.mark.parametrize("sentence", [
    "Search the probate records next.",
    "Search the 1870 census next.",
    "The next step is adding searches for the later census years.",
    "The 1850 census question is resolved; search the 1870 census next.",
    "The tree and the census evidence give Ireland.",
])
def test_a_record_suggestion_still_fails_beside_a_census_question(sentence):
    with pytest.raises(AssertionError, match="names a record"):
        _check([_PARENTS_Q001, _CENSUS_Q002], sentence)


def test_the_census_question_fails_where_no_question_carries_census():
    with pytest.raises(AssertionError, match="names a record"):
        _check([_PARENTS_Q001], "The census question is resolved.")


def test_a_question_id_whose_text_has_no_census_does_not_cover_it():
    with pytest.raises(AssertionError, match="names a record"):
        _check([_PARENTS_Q001, _CENSUS_Q002], "q_001 (search the 1870 census) comes next.")


# --- test_handback_not_record_scoped: relaying a proof summary's own gap list ---
#
# A proof summary that says which records are not yet searched has already
# named them; relaying that list is reading the project, the same footing as
# naming an existing plan item. A record the summary names only as work done
# ("Searched 1850 census …") is not on the list and stays a violation.

_GAP_SUMMARY = {
    "id": "ps_001",
    "question_id": "q_001",
    "exhaustive_search_summary": (
        "Searched 1850 census (FamilySearch, Ancestry, MyHeritage) and the death certificate. "
        "1870, 1880, and 1900 censuses and Thomas Flynn's probate records not yet searched."
    ),
    "narrative_markdown": "If Thomas Flynn's will names Patrick as a son, the conclusion would advance to **Proved**.",
}
_DONE_ONLY_SUMMARY = {
    "id": "ps_001",
    "question_id": "q_001",
    "exhaustive_search_summary": (
        "Searched 1850 census (FamilySearch, Ancestry, MyHeritage), 1860 census and the death "
        "certificate. Thomas Flynn probate search (pli_006) completed."
    ),
}


def _before_with_summary(summary):
    return {"research_json": {"plans": [], "questions": [_PARENTS_Q001], "proof_summaries": [summary]}}


def _check_summary(summary, sentence):
    check_handback(
        before_state=_before_with_summary(summary),
        text_response=None,
        test=_test_dict(),
        agent_returns=[{"subagent_type": "question-selection", "text": _reply(
            "**Next step:** plan research for this question.", sentence)}],
    )


@pytest.mark.parametrize("sentence", [
    "Further checks, such as the 1870 to 1900 censuses or Thomas Flynn's probate records, would only strengthen an answer already in place.",
    "Later searches of additional census years or a will would only strengthen that answer.",
])
def test_relaying_the_summarys_own_gap_list_passes(sentence):
    _check_summary(_GAP_SUMMARY, sentence)


@pytest.mark.parametrize("summary,sentence", [
    (_GAP_SUMMARY, "Search his land deeds next."),
    (_DONE_ONLY_SUMMARY, "Search the 1870 census next."),
    (_DONE_ONLY_SUMMARY, "Search Thomas Flynn's probate records next."),
])
def test_a_record_the_summary_does_not_list_as_a_gap_still_fails(summary, sentence):
    with pytest.raises(AssertionError, match="names a record"):
        _check_summary(summary, sentence)


# --- test_question_selection_one_new_question (issue #4531) -------------

_ONE_NEW_TAGS = {"tags": ["question-selection-one-new-question"]}
_BURIAL = "Where was Patrick Flynn (b. ca. 1845, d. 1908) buried?"
_MARRIAGE = "Whom did Patrick Flynn (b. ca. 1845, d. 1908) marry?"


def _check_one_new(before, after):
    """A tagged call that skips is a dead gate, not a pass."""
    try:
        check_one_new_question(before, after, _ONE_NEW_TAGS)
    except pytest.skip.Exception:
        pytest.fail("the validator skipped a tagged test")


def test_one_new_question_passes():
    _check_one_new(_EMPTY, _state([_q("q_001", _BURIAL)]))


def test_one_new_question_beside_an_existing_one_passes():
    """Only questions added in the run count, not ones already there."""
    before = _state([_q("q_001", _MARRIAGE, status="resolved")])
    after = _state([_q("q_001", _MARRIAGE, status="resolved"), _q("q_002", _BURIAL)])
    _check_one_new(before, after)


def test_no_new_question_fails():
    """Asking which fact first writes nothing: the failure #4531 is about."""
    with pytest.raises(BaseException) as excinfo:
        check_one_new_question(_EMPTY, _EMPTY, _ONE_NEW_TAGS)
    assert excinfo.typename == "AssertionError", excinfo.typename
    assert "got 0" in str(excinfo.value)


def test_two_new_questions_fail():
    after = _state([_q("q_001", _BURIAL), _q("q_002", _MARRIAGE)])
    with pytest.raises(BaseException) as excinfo:
        check_one_new_question(_EMPTY, after, _ONE_NEW_TAGS)
    assert excinfo.typename == "AssertionError", excinfo.typename
    assert "got 2" in str(excinfo.value)


def test_one_new_question_untagged_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check_one_new_question(_EMPTY, _EMPTY, {"tags": ["question-selection-no-new-question"]})
