"""Direct tests for `test_new_plan_items_planned_status`.

Same reason as `test_research_plan_objective_target_validator.py`: nothing
under `validators/` is collected by `make harness-test`, and every research-plan
test counted by `grep -rl new-plan-items-planned-status eval/tests/unit/research-plan | wc -l`
carries this validator's tag, so a regression here would otherwise surface
only inside a paid per-skill run.

Issue #4477: the tag means the test writes a plan, so a tagged run that adds no
new plan item fails instead of passing with nothing checked.

Issue #1830 item 1 (the lead's 2026-08-31 ruling on #1917) adds one exception:
on an `enumerative` question, an event type the plan does not cover is written
as a `skipped` item with a category and a reason. Everywhere else a new item
that is not `planned` still fails — on a targeted question that is the
footprint of the obligation over-firing.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect it.
from test_research_plan import (  # noqa: E402
    test_new_plan_items_planned_status as check_planned,
)
from tests.unit.skip_blind import expect_fires, expect_passes  # noqa: E402

TAGGED = {"tags": ["planning", "new-plan-items-planned-status"]}
UNTAGGED = {"tags": ["planning"]}


def _question(kind):
    q = {"id": "q_001", "question": "Who were the children of Lewis Reese?"}
    if kind is not None:
        q["question_kind"] = kind
    return q


def _states(kind, items, before_items=()):
    before = {"questions": [_question(kind)],
              "plans": [{"id": "pl_000", "question_id": "q_001", "items": list(before_items)}]}
    after = {"questions": [_question(kind)],
             "plans": [{"id": "pl_000", "question_id": "q_001", "items": list(before_items)},
                       {"id": "pl_001", "question_id": "q_001", "items": items}]}
    return {"research_json": before}, {"research_json": after}


def _planned(n):
    return {"id": f"pli_{n:03d}", "record_type": "census", "status": "planned"}


def _skipped(n, category="no_coverage", reason="No probate exists for this family."):
    item = {"id": f"pli_{n:03d}", "record_type": "probate", "status": "skipped"}
    if category is not None:
        item["skip_category"] = category
    if reason is not None:
        item["skip_reason"] = reason
    return item


# --- the exception: enumerative question, skipped with category and reason --

def test_fails_an_enumerative_skip_that_names_none_of_the_five_events():
    item = {"id": "pli_002", "record_type": "land", "status": "skipped",
            "skip_category": "out_of_scope", "skip_reason": "Later."}
    before, after = _states("enumerative", [_planned(1), item])
    expect_fires(lambda: check_planned(before, after, TAGGED), "pli_002 has status='skipped'")


def test_passes_an_enumerative_skip_with_category_and_reason():
    before, after = _states("enumerative", [_planned(1), _skipped(2)])
    expect_passes(lambda: check_planned(before, after, TAGGED))


def test_passes_a_plan_of_planned_items_on_any_question():
    for kind in ("enumerative", "targeted", None):
        before, after = _states(kind, [_planned(1), _planned(2)])
        expect_passes(lambda: check_planned(before, after, TAGGED))


# --- still fails everywhere else --------------------------------------------

@pytest.mark.parametrize("kind", ["targeted", None])
def test_fails_a_skip_at_creation_on_a_targeted_or_unlabelled_question(kind):
    """The over-firing footprint: enumerative bookkeeping on a question that
    carries no five-event obligation."""
    before, after = _states(kind, [_planned(1), _skipped(2)])
    expect_fires(lambda: check_planned(before, after, TAGGED), "pli_002 has status='skipped'")


@pytest.mark.parametrize("category,reason", [
    (None, "No probate exists for this family."),
    ("no_coverage", None),
    ("", "No probate exists for this family."),
    ("no_coverage", "   "),
])
def test_fails_an_enumerative_skip_missing_its_category_or_reason(category, reason):
    """"Must state in writing why" — a skip without both says nothing."""
    before, after = _states("enumerative", [_skipped(2, category, reason)])
    expect_fires(lambda: check_planned(before, after, TAGGED), "pli_002 has status='skipped'")


@pytest.mark.parametrize("status", ["in_progress", "completed"])
def test_fails_other_statuses_even_on_an_enumerative_question(status):
    item = {**_planned(1), "status": status}
    before, after = _states("enumerative", [item])
    expect_fires(lambda: check_planned(before, after, TAGGED), f"status='{status}'")


def test_ignores_pre_existing_items():
    old = {**_planned(9), "status": "completed"}
    before, after = _states("targeted", [_planned(1)], before_items=[old])
    expect_passes(lambda: check_planned(before, after, TAGGED))


# --- #4477: a tagged run must write at least one new item --------------------

def _hand_states(before_plans, after_plans):
    q = [_question("targeted")]
    return ({"research_json": {"questions": q, "plans": before_plans}},
            {"research_json": {"questions": q, "plans": after_plans}})


def test_fails_a_tagged_run_that_writes_an_empty_plan():
    before, after = _states("targeted", [])
    expect_fires(lambda: check_planned(before, after, TAGGED), "wrote no new plan items")


def test_fails_a_tagged_run_that_writes_no_plan_at_all():
    """A pre-existing plan comes through untouched: its items are not new."""
    old = [{"id": "pl_000", "question_id": "q_001", "items": [_planned(9)]}]
    before, after = _hand_states(old, [dict(p) for p in old])
    expect_fires(lambda: check_planned(before, after, TAGGED), "wrote no new plan items")


def test_fails_the_v18_shape_with_no_plans_before_or_after():
    """research-plan v18: the agent stopped for a locality survey, so `plans`
    was empty before the run and still empty after it."""
    before, after = _hand_states([], [])
    expect_fires(lambda: check_planned(before, after, TAGGED), "wrote no new plan items")


def test_counts_an_item_added_to_an_existing_plan():
    before, after = _hand_states(
        [{"id": "pl_000", "question_id": "q_001", "items": [_planned(9)]}],
        [{"id": "pl_000", "question_id": "q_001", "items": [_planned(9), _planned(10)]}],
    )
    expect_passes(lambda: check_planned(before, after, TAGGED))


# --- #4696: the subject's own sealed birth or death record on a parentage question

def _parentage_states(question, items):
    q = [{"id": "q_001", "question": question, "question_kind": "targeted"}]
    return ({"research_json": {"questions": q, "plans": []}},
            {"research_json": {"questions": q,
                               "plans": [{"id": "pl_001", "question_id": "q_001", "items": items}]}})


def _vital_skip(category="inaccessible", reason="Alan's 2023 death certificate is closed for 50 years."):
    return {"id": "pli_002", "record_type": "vital_record", "status": "skipped",
            "skip_category": category, "skip_reason": reason}


@pytest.mark.parametrize("question", [
    "Who were the parents of Alan Glen Applegarth?",
    "Who was the father of Mikkel Nielsen Blyeberg?",
    "Where was Elena born, and who were her parents?",
    "Which probate record names Caroline Voss's mother?",
])
@pytest.mark.parametrize("category", ["inaccessible", "no_coverage"])
def test_passes_a_sealed_own_vital_on_a_parentage_question(question, category):
    before, after = _parentage_states(question, [_planned(1), _vital_skip(category)])
    expect_passes(lambda: check_planned(before, after, TAGGED))


def test_passes_a_skipped_birth_named_only_in_its_skip_reason():
    item = {"id": "pli_002", "record_type": "other", "status": "skipped",
            "skip_category": "no_coverage",
            "skip_reason": "Pennsylvania kept no birth registers before 1906."}
    before, after = _parentage_states("Who were the parents of Patrick Flynn?", [item])
    expect_passes(lambda: check_planned(before, after, TAGGED))


@pytest.mark.parametrize("question,item", [
    ("Where did Michael Sheahan live in 1880?", _vital_skip()),
    ("Who were the parents of Alan?", _vital_skip(category="out_of_scope")),
    ("Who were the parents of Alan?", _vital_skip(reason="  ")),
    ("Who were the parents of Alan?",
     {"id": "pli_002", "record_type": "census", "status": "skipped",
      "skip_category": "inaccessible", "skip_reason": "The 1890 census burned."}),
    ("Who were the parents of Alan?", {**_vital_skip(), "status": "in_progress"}),
])
def test_fails_a_skip_outside_the_parentage_vital_exception(question, item):
    before, after = _parentage_states(question, [_planned(1), item])
    expect_fires(lambda: check_planned(before, after, TAGGED), "pli_002 has status=")


def test_skips_when_the_tag_is_absent():
    before, after = _states("targeted", [_skipped(2)])
    with pytest.raises(pytest.skip.Exception):
        check_planned(before, after, UNTAGGED)
