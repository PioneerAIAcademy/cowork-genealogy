"""Direct tests for `test_new_plan_items_planned_status`.

Same reason as `test_research_plan_objective_target_validator.py`: nothing
under `validators/` is collected by `make harness-test`, and 17 research-plan
tests carry this validator's tag, so a regression here would otherwise surface
only inside a paid per-skill run.

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

def test_passes_an_enumerative_skip_with_category_and_reason():
    before, after = _states("enumerative", [_planned(1), _skipped(2)])
    check_planned(before, after, TAGGED)


def test_passes_a_plan_of_planned_items_on_any_question():
    for kind in ("enumerative", "targeted", None):
        before, after = _states(kind, [_planned(1), _planned(2)])
        check_planned(before, after, TAGGED)


# --- still fails everywhere else --------------------------------------------

@pytest.mark.parametrize("kind", ["targeted", None])
def test_fails_a_skip_at_creation_on_a_targeted_or_unlabelled_question(kind):
    """The over-firing footprint: enumerative bookkeeping on a question that
    carries no five-event obligation."""
    before, after = _states(kind, [_planned(1), _skipped(2)])
    with pytest.raises(AssertionError, match="pli_002 has status='skipped'"):
        check_planned(before, after, TAGGED)


@pytest.mark.parametrize("category,reason", [
    (None, "No probate exists for this family."),
    ("no_coverage", None),
    ("", "No probate exists for this family."),
    ("no_coverage", "   "),
])
def test_fails_an_enumerative_skip_missing_its_category_or_reason(category, reason):
    """"Must state in writing why" — a skip without both says nothing."""
    before, after = _states("enumerative", [_skipped(2, category, reason)])
    with pytest.raises(AssertionError, match="pli_002 has status='skipped'"):
        check_planned(before, after, TAGGED)


@pytest.mark.parametrize("status", ["in_progress", "completed"])
def test_fails_other_statuses_even_on_an_enumerative_question(status):
    item = {**_planned(1), "status": status}
    before, after = _states("enumerative", [item])
    with pytest.raises(AssertionError, match=f"status='{status}'"):
        check_planned(before, after, TAGGED)


def test_ignores_pre_existing_items():
    old = {**_planned(9), "status": "completed"}
    before, after = _states("targeted", [_planned(1)], before_items=[old])
    check_planned(before, after, TAGGED)


def test_skips_when_the_tag_is_absent():
    before, after = _states("targeted", [_skipped(2)])
    with pytest.raises(pytest.skip.Exception):
        check_planned(before, after, UNTAGGED)
