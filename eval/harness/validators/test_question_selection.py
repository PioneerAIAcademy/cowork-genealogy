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

Migrated from `rubric.md` + per-test `additional_criteria` per
docs/plan/criteria-demotion-and-rubric-opt-in.md.
"""

from __future__ import annotations

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
