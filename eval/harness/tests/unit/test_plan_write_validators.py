"""The plan-write gates prove they fire, on the scenarios their tests run against.

Issue #2116 moved `ut_research_plan_003` into the research suite as
`ut_research_rpn`, and its three validators with it, and added a review-mode
gate to the research-plan suite. `check_runnable` proves each tag reaches a
validator; only these tests prove the validator, once reached, fails a write
and passes a run that wrote nothing.
"""

import copy
import json
import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS / "validators"))

from test_research import (  # noqa: E402
    test_no_new_plan as research_no_new_plan,
    test_no_plan_writes_when_resolved as research_no_plan_writes,
    test_resolved_question_not_reopened as research_not_reopened,
)
from test_research_plan import (  # noqa: E402
    test_dispose_named_items as plan_dispose,
    test_research_plan_no_new_plan as plan_no_new_plan,
    test_review_writes_no_plan as plan_review_no_writes,
)

_SCENARIOS = _HARNESS.parent / "fixtures" / "scenarios"
_RESOLVED_TAGS = {"tags": ["research-plan-no-new-plan", "no-plan-writes-when-resolved"]}
_REVIEW_TAGS = {"tags": ["research-plan-no-new-plan", "research-plan-review-no-writes"]}


def _research(scenario: str) -> dict:
    return json.loads((_SCENARIOS / scenario / "research.json").read_text(encoding="utf-8"))


def _state(research: dict) -> dict:
    return {"research_json": research}


def _plan(research: dict, pid: str) -> dict:
    return next(p for p in research["plans"] if p["id"] == pid)


def _new_plan(research: dict) -> None:
    research["plans"].append(
        {"id": "pl_099", "question_id": "q_001", "status": "active", "created": "2026-10-15", "items": []}
    )


def _append_item(research: dict) -> None:
    items = _plan(research, "pl_002")["items"]
    item = copy.deepcopy(items[-1])
    item["id"] = "pli_099"
    item["status"] = "planned"
    items.append(item)


def _edit_item(research: dict) -> None:
    _plan(research, "pl_002")["items"][0]["rationale"] += " (rewritten)"


def _delete_item(research: dict) -> None:
    _plan(research, "pl_002")["items"].pop()


def _plan_status(value: str):
    def mutate(research: dict) -> None:
        _plan(research, "pl_002")["status"] = value
    return mutate


def _reopen_question(research: dict) -> None:
    next(q for q in research["questions"] if q["id"] == "q_001")["status"] = "in_progress"


def _project_status(research: dict) -> None:
    research["project"]["status"] = "active"


# --- research suite: ut_research_rpn on flynn-resolved ----------------------

RESOLVED = _research("flynn-resolved")


@pytest.mark.parametrize(
    "check", [research_no_new_plan, research_no_plan_writes, research_not_reopened]
)
def test_resolved_gates_pass_a_run_that_wrote_nothing(check):
    check(_state(RESOLVED), _state(copy.deepcopy(RESOLVED)), _RESOLVED_TAGS)


@pytest.mark.parametrize(
    "check, mutate",
    [
        (research_no_new_plan, _new_plan),
        (research_no_plan_writes, _append_item),
        (research_no_plan_writes, _edit_item),
        (research_no_plan_writes, _delete_item),
        (research_no_plan_writes, _plan_status("active")),
        (research_not_reopened, _reopen_question),
        (research_not_reopened, _project_status),
    ],
)
def test_resolved_gates_fail_a_write(check, mutate):
    after = copy.deepcopy(RESOLVED)
    mutate(after)
    with pytest.raises(AssertionError):
        check(_state(RESOLVED), _state(after), _RESOLVED_TAGS)


@pytest.mark.parametrize(
    "check", [research_no_new_plan, research_no_plan_writes, research_not_reopened]
)
def test_resolved_gates_skip_an_untagged_test(check):
    after = copy.deepcopy(RESOLVED)
    _new_plan(after)
    _append_item(after)
    _reopen_question(after)
    with pytest.raises(pytest.skip.Exception):
        check(_state(RESOLVED), _state(after), {"tags": []})


# --- research-plan suite: review mode on mid-research-flynn ------------------

MID = _research("mid-research-flynn")


def test_review_gate_passes_a_review_that_wrote_nothing():
    plan_review_no_writes(_state(MID), _state(copy.deepcopy(MID)), _REVIEW_TAGS)


@pytest.mark.parametrize(
    "mutate",
    [_new_plan, _append_item, _edit_item, _delete_item, _plan_status("completed")],
)
def test_review_gate_fails_any_plan_write(mutate):
    after = copy.deepcopy(MID)
    mutate(after)
    with pytest.raises(AssertionError):
        plan_review_no_writes(_state(MID), _state(after), _REVIEW_TAGS)


@pytest.mark.parametrize("mutate", [_append_item, _plan_status("completed")])
def test_the_older_review_tag_alone_misses_these(mutate):
    """Why `research-plan-review-no-writes` exists: `research-plan-no-new-plan`
    passes both writes a "the current plan is finished" delegation invites."""
    after = copy.deepcopy(MID)
    mutate(after)
    plan_no_new_plan(_state(MID), _state(after), _REVIEW_TAGS)


# --- research-plan suite: Dispose mode on flynn-planned-item-blocks ----------

BLOCKS = _research("flynn-planned-item-blocks")
_DISPOSE_TAGS = {"tags": ["research-plan-dispose"]}
_NAMED_010 = {**_DISPOSE_TAGS, "delegation": "Dispose of the named item.\n\nquestionId: q_001\nplanItemIds: pli_010\nprojectPath: <workspace>"}


def _item(research: dict, iid: str) -> dict:
    return next(i for i in _plan(research, "pl_002")["items"] if i["id"] == iid)


def _skip_pli_010(research: dict) -> None:
    item = _item(research, "pli_010")
    item.update(status="skipped", skip_category="answered",
                skip_reason="Parentage is established by the three sources already extracted.")


@pytest.mark.parametrize("tags", [_DISPOSE_TAGS, _NAMED_010], ids=["unnamed", "named"])
def test_dispose_gate_passes_a_skipped_unlogged_item(tags):
    after = copy.deepcopy(BLOCKS)
    _skip_pli_010(after)
    plan_dispose(_state(BLOCKS), _state(after), tags)


def _complete_unlogged(research: dict) -> None:
    _item(research, "pli_010")["status"] = "completed"


def _skip_without_category(research: dict) -> None:
    _item(research, "pli_010")["status"] = "skipped"


def _also_edit_another_item(research: dict) -> None:
    _skip_pli_010(research)
    _item(research, "pli_008")["rationale"] += " (rewritten)"


def _rewrite_the_disposed_item(research: dict) -> None:
    _skip_pli_010(research)
    _item(research, "pli_010")["rationale"] += " (rewritten)"


def _also_append(research: dict) -> None:
    _skip_pli_010(research)
    _append_item(research)


def _also_supersede(research: dict) -> None:
    _skip_pli_010(research)
    _plan(research, "pl_002")["status"] = "superseded"


def _also_delete(research: dict) -> None:
    _skip_pli_010(research)
    items = _plan(research, "pl_002")["items"]
    items.remove(_item(research, "pli_004"))


def _not_a_disposal(research: dict) -> None:
    _item(research, "pli_010")["status"] = "in_progress"


def _also_plan_status(value: str):
    def mutate(research: dict) -> None:
        _skip_pli_010(research)
        _plan(research, "pl_002")["status"] = value
    return mutate


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: None,  # disposed of nothing
        _complete_unlogged,
        _skip_without_category,
        _also_edit_another_item,
        _rewrite_the_disposed_item,
        _also_append,
        _also_supersede,
        _also_delete,
        _not_a_disposal,
        _also_plan_status("exhausted"),
        _also_plan_status("completed"),
    ],
    ids=["nothing", "completed-unlogged", "skip-no-category", "other-item-edited",
         "disposed-item-rewritten", "item-appended", "plan-superseded", "item-deleted",
         "not-a-disposal", "plan-exhausted", "plan-completed"],
)
@pytest.mark.parametrize("tags", [_DISPOSE_TAGS, _NAMED_010], ids=["unnamed", "named"])
def test_dispose_gate_fails_a_wrong_disposal(mutate, tags):
    after = copy.deepcopy(BLOCKS)
    mutate(after)
    with pytest.raises(AssertionError):
        plan_dispose(_state(BLOCKS), _state(after), tags)


def test_dispose_gate_fails_an_unnamed_item_disposed():
    """Two planned items, one named: disposing the other is not Dispose mode."""
    before = copy.deepcopy(BLOCKS)
    extra = copy.deepcopy(_item(before, "pli_010"))
    extra["id"] = "pli_011"
    _plan(before, "pl_002")["items"].append(extra)
    after = copy.deepcopy(before)
    _item(after, "pli_011").update(status="skipped", skip_category="answered", skip_reason="x")
    with pytest.raises(AssertionError, match="did not name it"):
        plan_dispose(_state(before), _state(after), _NAMED_010)


def test_dispose_gate_fails_a_status_that_is_not_a_disposal():
    """One item disposed correctly and a second planned item moved to
    in_progress: only the "not a disposal" rule can see the second."""
    before = copy.deepcopy(BLOCKS)
    extra = copy.deepcopy(_item(before, "pli_010"))
    extra["id"] = "pli_011"
    _plan(before, "pl_002")["items"].append(extra)
    after = copy.deepcopy(before)
    _skip_pli_010(after)
    _item(after, "pli_011")["status"] = "in_progress"
    with pytest.raises(AssertionError, match="is not a disposal"):
        plan_dispose(_state(before), _state(after), _DISPOSE_TAGS)


def test_dispose_gate_fails_a_named_item_that_was_not_planned():
    """The hostile delegation: it names the in_progress probate item on
    mid-research-flynn. Skipping it abandons a live search."""
    after = copy.deepcopy(MID)
    _plan(after, "pl_002")["items"][-1].update(status="skipped", skip_category="answered", skip_reason="x")
    named = {**_DISPOSE_TAGS, "delegation": "planItemIds: pli_006"}
    assert _plan(MID, "pl_002")["items"][-1]["id"] == "pli_006"
    with pytest.raises(AssertionError, match="not planned"):
        plan_dispose(_state(MID), _state(after), named)
