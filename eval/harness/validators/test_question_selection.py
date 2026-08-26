"""Skill-specific validators for the question-selection skill.

question-selection picks the next research question — either by
decomposing the project objective when the question list is empty or
by reasoning about the existing project state (unresolved conflicts,
in-progress plan items, etc.). The ownership check in
`test_universal.py::test_ownership_table` already restricts writes to
the `questions` section; FK integrity for `depends_on` / `unblocks` /
`resolution_assertion_ids` is covered by
`test_universal.py::test_id_references_resolve`. This file adds
tag-gated regression checks for scenarios that prescribe specific
selection-basis values, empty dependency arrays, or
do-not-create-a-new-question outcomes.

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import re

import pytest

from validators_lib import assert_no_section_deletions


# --- Append-only / no-delete on questions -----------------------------

def test_questions_no_deletions(before_state, after_state):
    """Existing questions must not be deleted. The question list is
    cumulative — closed questions stay with status='resolved' or
    'abandoned', they aren't removed."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    assert_no_section_deletions(before, after, "questions")


# --- Helpers ---------------------------------------------------------

def _new_questions(before: dict, after: dict) -> list[dict]:
    before_ids = {q.get("id") for q in (before.get("questions") or [])}
    return [
        q
        for q in (after.get("questions") or [])
        if q.get("id") and q.get("id") not in before_ids
    ]


# --- Tag-gated: the new question's scope matches the objective's -------

# A research question names the FACT sought; which record set carries that
# fact is research-plan's decision (SKILL.md Step 1c). These patterns match
# record nouns that betray a plan item wearing a question's clothing — the
# defect behind "showed me a question specific to the 1900 census" when the
# user asked for a person's parents. `will` is matched only with a preceding
# article/possessive so the modal verb ("who will…") can't false-positive.
_RECORD_SCOPED_PATTERNS = (
    r"\bcensus\b",
    r"\bcertificates?\b",
    r"\bregisters?\b",
    r"\b(?:a|the|his|her|their)\s+will\b",
    r"\bprobate\b",
    r"\bdeeds?\b",
    r"\bmuster\s+roll\b",
    r"\blægdsrulle\w*\b",
    r"\blaegdsrulle\w*\b",
)


def test_new_question_not_record_scoped(before_state, after_state, test):
    """Tag-gated: a new question must name the fact sought, not the record
    that might carry it. "Where was Reuben in the 1900 census?" is a plan
    item, not a research question — it narrows the user's objective to one
    source before anyone has asked whether that source is the best one.

    Gated on the `objective-scope-match` tag because it is legitimately
    inapplicable in two cases: an objective that is *about* a document (an
    illegible surname on a specific marriage certificate), and a
    sub-question written beneath an already-open objective-scope question,
    where naming a record is correct (SKILL.md Step 1c, "once a question at
    the objective's scope exists"). Do not tag such tests with
    `objective-scope-match`."""
    if "objective-scope-match" not in test.get("tags", []):
        pytest.skip("not an objective-scope-match scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    offenders: list[str] = []
    for q in _new_questions(before, after):
        text = q.get("question") or ""
        for pattern in _RECORD_SCOPED_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                offenders.append(
                    f"{q.get('id')}: {text!r} names a record "
                    f"(matched /{pattern}/)"
                )
                break
    assert not offenders, (
        "question(s) scoped to a record rather than the fact sought — "
        "record choice belongs to research-plan:\n  - "
        + "\n  - ".join(offenders)
    )


def test_new_question_excludes_out_of_scope_persons(before_state, after_state, test):
    """Tag-gated by one or more `scope-excludes-<slugified-name>` tags: the
    new question must not target a person the objective does not cover.

    A person's presence in the tree does not put them in scope — on an
    objective of "identify the parents of X", X's own spouse and children
    are a *different* objective (SKILL.md Step 1c). Only the question text
    is checked, not the rationale: naming a relative as a *source* of
    evidence about the subject is legitimate FAN reasoning, whereas making
    them the question's subject is the defect."""
    excluded = [
        t[len("scope-excludes-"):]
        for t in test.get("tags", [])
        if t.startswith("scope-excludes-")
    ]
    if not excluded:
        pytest.skip("no scope-excludes-<name> tags on this test")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    offenders: list[str] = []
    for q in _new_questions(before, after):
        text = q.get("question") or ""
        norm = re.sub(r"[^a-z0-9]+", "-", text.lower())
        for slug in excluded:
            if slug and slug in norm:
                offenders.append(
                    f"{q.get('id')}: {text!r} targets out-of-scope person "
                    f"'{slug}'"
                )
    assert not offenders, (
        "question(s) targeting a person outside the objective's scope:\n  - "
        + "\n  - ".join(offenders)
    )


# --- Tag-gated: no new question added ---------------------------------

def test_question_selection_no_new_question(before_state, after_state, test):
    """Tag-gated: when in-progress work blocks new question formulation,
    question-selection must NOT add a `q_` entry. Adding a question
    while existing plans are mid-flight churns research direction
    without resolving anything."""
    if "question-selection-no-new-question" not in test.get("tags", []):
        pytest.skip("not a question-selection-no-new-question scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new = _new_questions(before, after)
    new_ids = [q.get("id") for q in new]
    assert not new, (
        f"question-selection created a new question when in-progress "
        f"work should have been completed first; new question IDs: {new_ids}"
    )


# --- Tag-gated: new question's selection_basis ------------------------

def test_selection_basis_objective_decomposition(before_state, after_state, test):
    """Tag-gated: when the question list was empty, the new question's
    selection_basis must be `objective_decomposition` — that's the
    selection-basis enum value defined for first-question-from-objective
    flows."""
    if "selection-basis-objective-decomposition" not in test.get("tags", []):
        pytest.skip("not a selection-basis-objective-decomposition scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new = _new_questions(before, after)
    assert new, "expected a new question; none was added"
    bad = [
        (q.get("id"), q.get("selection_basis"))
        for q in new
        if q.get("selection_basis") != "objective_decomposition"
    ]
    assert not bad, (
        f"new questions with wrong selection_basis: {bad}; "
        f"expected 'objective_decomposition'"
    )


def test_selection_basis_unresolved_conflict(before_state, after_state, test):
    """Tag-gated: when unresolved conflicts are blocking other questions,
    the new question's selection_basis must be `unresolved_conflict`."""
    if "selection-basis-unresolved-conflict" not in test.get("tags", []):
        pytest.skip("not a selection-basis-unresolved-conflict scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new = _new_questions(before, after)
    assert new, "expected a new question; none was added"
    bad = [
        (q.get("id"), q.get("selection_basis"))
        for q in new
        if q.get("selection_basis") != "unresolved_conflict"
    ]
    assert not bad, (
        f"new questions with wrong selection_basis: {bad}; "
        f"expected 'unresolved_conflict'"
    )


def test_selection_basis_fan_pivot(before_state, after_state, test):
    """Tag-gated: when all direct evidence searches are exhausted, the
    new question's selection_basis must be `fan_pivot` — indicating
    the skill recognized the FAN (Family/Associates/Neighbors) pivot
    threshold rather than decomposing another direct-evidence path."""
    if "selection-basis-fan-pivot" not in test.get("tags", []):
        pytest.skip("not a selection-basis-fan-pivot scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new = _new_questions(before, after)
    assert new, "expected a new question; none was added"
    bad = [
        (q.get("id"), q.get("selection_basis"))
        for q in new
        if q.get("selection_basis") != "fan_pivot"
    ]
    assert not bad, (
        f"new questions with wrong selection_basis: {bad}; "
        f"expected 'fan_pivot'"
    )


def test_selection_basis_timeline_gap(before_state, after_state, test):
    """Tag-gated: when a high-severity timeline gap is the highest-priority
    signal, the new question's selection_basis must be `timeline_gap`."""
    if "selection-basis-timeline-gap" not in test.get("tags", []):
        pytest.skip("not a selection-basis-timeline-gap scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new = _new_questions(before, after)
    assert new, "expected a new question; none was added"
    bad = [
        (q.get("id"), q.get("selection_basis"))
        for q in new
        if q.get("selection_basis") != "timeline_gap"
    ]
    assert not bad, (
        f"new questions with wrong selection_basis: {bad}; "
        f"expected 'timeline_gap'"
    )


# --- Tag-gated: new question depends_on is non-empty ------------------

def test_depends_on_nonempty(before_state, after_state, test):
    """Tag-gated: the new question must set a non-empty depends_on array.
    Used for scenarios where the new question is methodologically
    downstream of a prior question — either because it searches within
    a household the prior question identified, or because it tests a
    claim that a prior question confirmed."""
    if "depends-on-nonempty" not in test.get("tags", []):
        pytest.skip("not a depends-on-nonempty scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new = _new_questions(before, after)
    assert new, "expected a new question; none was added"
    bad = [
        (q.get("id"), q.get("depends_on"))
        for q in new
        if not q.get("depends_on")
    ]
    assert not bad, (
        f"new questions with empty depends_on: {bad}; "
        f"expected at least one prior question ID in depends_on"
    )


# --- Tag-gated: first-question depends_on is empty --------------------

def test_first_question_depends_on_empty(before_state, after_state, test):
    """Tag-gated: when no prior questions exist, the new question's
    depends_on must be an empty array. Pointing depends_on at non-
    existent IDs would break FK integrity (universal already catches
    that); pointing it at unrelated questions would be a logic error
    that universal cannot catch."""
    if "first-question-depends-on-empty" not in test.get("tags", []):
        pytest.skip("not a first-question-depends-on-empty scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new = _new_questions(before, after)
    assert new, "expected a new question; none was added"
    bad = [
        (q.get("id"), q.get("depends_on"))
        for q in new
        if q.get("depends_on") not in (None, [])
    ]
    assert not bad, (
        f"new questions with non-empty depends_on (no prior questions "
        f"existed): {bad}"
    )


# --- Tag-gated: new question's exhaustive_declaration is unstarted ----

def test_new_question_exhaustive_declaration_unstarted(before_state, after_state, test):
    """Tag-gated: a freshly added question's exhaustive_declaration must
    be unstarted — declared=False, log_entry_ids=[], stop_criteria=None.
    Declaring exhaustiveness at creation time is structurally wrong:
    the question hasn't been researched yet."""
    if "new-question-exhaustive-declaration-unstarted" not in test.get("tags", []):
        pytest.skip("not a new-question-exhaustive-declaration-unstarted scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new = _new_questions(before, after)
    assert new, "expected a new question; none was added"
    errors: list[str] = []
    for q in new:
        ed = q.get("exhaustive_declaration") or {}
        if ed.get("declared") is not False:
            errors.append(
                f"question {q.get('id')}.exhaustive_declaration.declared="
                f"{ed.get('declared')}; expected False"
            )
        if ed.get("log_entry_ids") not in (None, []):
            errors.append(
                f"question {q.get('id')}.exhaustive_declaration.log_entry_ids="
                f"{ed.get('log_entry_ids')}; expected []"
            )
        if ed.get("stop_criteria") is not None:
            errors.append(
                f"question {q.get('id')}.exhaustive_declaration.stop_criteria="
                f"{ed.get('stop_criteria')}; expected None"
            )
    assert not errors, "Unstarted-exhaustive-declaration violations:\n  - " + "\n  - ".join(errors)


# --- Tag-gated: disputed assignment is tested, not confirmed (#1471) ---

# Regression for issue #1471. When the objective disputes the existing parent
# assignment (unverified tree data), question-selection must frame the first
# question as a TEST of that assignment (confirm-or-refute against independent
# records), never a bare "identify the parents" that implicitly accepts the
# attached ones, and never a confirmation of the tree under investigation.
# Bare "confirm"/"verify" are deliberately excluded: "Confirm that Johann and
# Maria are the parents" is the exact confirm-the-tree failure #1471 targets, so
# it must NOT pass. A correctly framed "confirm or refute against independent
# records" question still matches on "refute"/"independent".
_VERIFY_SIGNALS = (
    "refute", "independent", "whether",
    "test ", "re-examine", "reexamine", "disprove", "rule out",
)


def test_first_question_tests_disputed_parents(before_state, after_state, test):
    """Tag-gated: on a disputed-assignment objective, the new question must be
    framed to TEST the assignment, not confirm/assume it (#1471)."""
    if "verifies-disputed-parents" not in test.get("tags", []):
        pytest.skip("not a verifies-disputed-parents scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new = _new_questions(before, after)
    assert new, "expected a new question testing the disputed assignment; none was added"
    text = " ".join((q.get("question") or "") for q in new).lower()
    assert any(sig in text for sig in _VERIFY_SIGNALS), (
        "the first question does not frame the disputed parent assignment as "
        "something to TEST. When the objective disputes the existing parents, "
        "the question must confirm-or-refute the assignment against independent "
        "records (e.g. 'Do independent records confirm or refute that X and Y "
        "are the parents of Z?'), not merely ask to identify the parents while "
        "accepting the attached ones, and not confirm the tree under "
        f"investigation (issue #1471). Question(s) written: "
        f"{[q.get('question') for q in new]!r}"
    )


# --- Tag-gated: disputed-assignment ask, not assumed (#1471, V1) ------

def test_disputed_parents_ask_before_formulating(before_state, after_state, test, text_response):
    """Tag-gated: when the objective disputes an existing parent
    assignment and the user's message supplies neither the evidence
    behind their doubt nor a birth date/place of their own, the skill
    must ask for both (SKILL.md Step 3) rather than write a question on
    this turn. Mirrors ut_question_selection_014, where both were already
    supplied and the skill correctly proceeded straight to writing."""
    if "disputed-parents-ask-required" not in test.get("tags", []):
        pytest.skip("not a disputed-parents-ask-required scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new = _new_questions(before, after)
    assert not new, (
        f"question-selection wrote a question ({[q.get('id') for q in new]}) "
        f"on a turn where the user gave neither doubt-evidence nor a "
        f"birth date/place for a disputed parent assignment -- SKILL.md "
        f"Step 3 requires asking for both before formulating"
    )
    reply = (text_response or "").lower()
    asks_for_evidence = any(
        phrase in reply
        for phrase in (
            "what evidence", "why do you doubt", "why do you believe",
            "led you to doubt", "led you to believe", "what makes you think",
            "what led you", "your evidence", "evidence led",
        )
    )
    asks_for_coordinates = any(
        phrase in reply
        for phrase in (
            "birth date", "birth year", "born", "date and place",
            "where he was born", "where she was born", "working from",
        )
    )
    assert asks_for_evidence and asks_for_coordinates, (
        "the reply does not ask for both required pieces (evidence behind "
        "the doubt, and the birth date/place the user is working from) "
        f"before formulating a disputed-assignment question. Reply: {reply!r}"
    )


# --- Universal: a newly written question must not be a textbook-vague one (V2) ---

# The rubric's own `fail` bullet names these as the non-specific shape
# ("Learn more about Patrick's family", "Who is Patrick Flynn?"). This
# catches only that extreme case -- whether a question that avoids these
# shapes is otherwise well-formed stays the judge's call.
_VAGUE_QUESTION_PATTERNS = (
    r"^\s*who\s+is\s+\S",
    r"^\s*tell\s+me\s+about\b",
    r"\blearn\s+(?:more\s+)?about\b",
    r"\bfind\s+out\s+(?:more\s+)?about\b",
    r"^\s*research\s+the\s+\S+\s+family\b",
)


def test_new_question_not_vague(before_state, after_state):
    """Universal: a newly written question must not match one of the
    textbook-vague shapes the rubric's own `fail` bullet names. This is
    a floor under the un-covered 'Question specificity' rubric dimension,
    not a replacement for it -- it catches only the extreme case."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    offenders: list[str] = []
    for q in _new_questions(before, after):
        text = q.get("question") or ""
        for pattern in _VAGUE_QUESTION_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                offenders.append(f"{q.get('id')}: {text!r} (matched /{pattern}/)")
                break
    assert not offenders, (
        "question(s) too vague to drive a search -- naming no specific "
        "fact, date, or event: " + ", ".join(offenders)
    )
