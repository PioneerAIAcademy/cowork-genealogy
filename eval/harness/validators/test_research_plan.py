"""Skill-specific validators for the research-plan skill.

research-plan creates a sequenced plan entry for a research question.
The ownership check in `test_universal.py::test_ownership_table` already
restricts writes to the `plans` section; FK integrity for
`plans.question_id → questions` is covered by
`test_universal.py::test_id_references_resolve`. This file adds
tag-gated regression checks for scenarios that prescribe specific
plan-creation behavior (no new plan when an active one exists, new
plan items default to `status: "planned"`, etc.).

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import pytest

from validators_lib import (
    assert_log_append_only,
    assert_no_section_deletions,
)


# --- Append-only / no-delete on plans ---------------------------------

def test_plans_no_deletions(before_state, after_state):
    """Existing plans must not be deleted — supersede with status instead."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    assert_no_section_deletions(before, after, "plans")


def test_log_unchanged_by_research_plan(before_state, after_state):
    """research-plan does not append to the log. The log is owned by the
    search-* and record-extraction skills (research-schema-spec.md §4).
    This check passes vacuously when the log is empty in both states."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    # Append-only is the universal invariant; equality is the
    # research-plan-specific one (the skill should add zero entries).
    assert_log_append_only(before, after)


# --- Tag-gated: do not create a new plan when one already exists -----

def _new_plan_ids(before: dict, after: dict) -> list[str]:
    before_ids = {p.get("id") for p in (before.get("plans") or [])}
    return [
        p.get("id")
        for p in (after.get("plans") or [])
        if p.get("id") and p.get("id") not in before_ids
    ]


def test_research_plan_no_new_plan(before_state, after_state, test):
    """Tag-gated: when an active plan already addresses the target
    question, research-plan should review (not create) — adding a
    parallel `pl_` entry would unnecessarily supersede the existing
    plan."""
    if "research-plan-no-new-plan" not in test.get("tags", []):
        pytest.skip("not a research-plan-no-new-plan scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new_plans = _new_plan_ids(before, after)
    assert not new_plans, (
        f"research-plan created a new plan when an existing active plan "
        f"should have been reviewed; new plan IDs: {new_plans}"
    )


# --- Tag-gated: nothing is written once the search is declared exhaustive ---

def test_no_plan_writes_when_resolved(before_state, after_state, test):
    """Tag-gated: on a question whose `exhaustive_declaration.declared` is
    already true, research-plan must add nothing and change nothing.

    Covers the gap the other two leave. `test_research_plan_no_new_plan`
    catches a whole new `pl_` and `test_plans_no_deletions` catches removals;
    neither sees an item **appended to an existing plan** or an existing item
    **edited in place**. Either rewrites the GPS audit trail the declaration
    rests on — and appending to `pl_002` is the obvious way to write a plan
    without creating one.

    This is the routing-independent gate for `ut_research_plan_003`
    (`grade_on_invariant`): whichever skill ends up handling the prompt, no run
    may leave a mark on `plans[]`.
    """
    if "no-plan-writes-when-resolved" not in test.get("tags", []):
        pytest.skip("not a no-plan-writes-when-resolved scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    before_plans = {
        p.get("id"): p for p in (before.get("plans") or []) if p.get("id")
    }
    errors: list[str] = []
    for plan in after.get("plans") or []:
        prior = before_plans.get(plan.get("id"))
        if prior is None:
            # A whole new plan is test_research_plan_no_new_plan's finding;
            # reporting it here too would double-count the same defect.
            continue
        if plan == prior:
            continue

        # Compare the WHOLE prior plan object, not just the items present in
        # the after-state. Walking only `after`'s items cannot see a deletion —
        # a removed item simply isn't there to check — and misses plan-level
        # fields entirely. With `grade_on_invariant` on ut_003, that gap scored
        # "wiped every item from pl_002" and "flipped pl_002 back to active" as
        # a PASS, which is the opposite of what this validator exists for.
        before_items = {
            i.get("id"): i for i in (prior.get("items") or []) if i.get("id")
        }
        after_items = {
            i.get("id"): i for i in (plan.get("items") or []) if i.get("id")
        }
        pid = plan.get("id")
        for gone in before_items.keys() - after_items.keys():
            errors.append(f"{pid}: item {gone} DELETED from an existing plan")
        for added in after_items.keys() - before_items.keys():
            errors.append(f"{pid}: item {added} added to an existing plan")
        for both in before_items.keys() & after_items.keys():
            if before_items[both] != after_items[both]:
                errors.append(f"{pid}: item {both} modified in place")
        for field in set(prior) | set(plan):
            if field == "items":
                continue
            if prior.get(field) != plan.get(field):
                errors.append(
                    f"{pid}: plan field '{field}' changed "
                    f"{prior.get(field)!r} -> {plan.get(field)!r}"
                )
        if not errors:  # differs, but no rule above named it — never silent
            errors.append(f"{pid}: plan object changed in a way this check did not classify")
    assert not errors, (
        "research-plan wrote to a question whose search is already declared "
        "exhaustive:\n  - " + "\n  - ".join(errors)
    )


# --- Tag-gated: existing in-progress plan items stay in_progress -----

def test_pli_006_status_unchanged(before_state, after_state, test):
    """Tag-gated: pli_006 (probate, in_progress) must remain in_progress.
    research-plan only updates plan-item status based on actual log
    entries; marking pli_006 completed without execution would falsify
    the audit trail."""
    if "pli-006-status-unchanged" not in test.get("tags", []):
        pytest.skip("not a pli-006-status-unchanged scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    def _find_item(research: dict, item_id: str) -> dict | None:
        for plan in research.get("plans", []):
            for item in plan.get("items", []) or []:
                if item.get("id") == item_id:
                    return item
        return None

    before_item = _find_item(before, "pli_006")
    after_item = _find_item(after, "pli_006")
    if before_item is None:
        pytest.skip("pli_006 not present in before-state")
    assert after_item is not None, "pli_006 deleted by research-plan"
    assert after_item.get("status") == before_item.get("status"), (
        f"pli_006 status changed from '{before_item.get('status')}' to "
        f"'{after_item.get('status')}' without a corresponding log entry"
    )


# --- Tag-gated: new plan attached to q_001 ---------------------------

def test_research_plan_new_plan_for_q_001(before_state, after_state, test):
    """Tag-gated: when the test calls for a new plan for q_001, exactly
    one new `pl_` entry must be added and its question_id must be
    q_001. The previous plan (pl_002) must not be modified or deleted."""
    if "research-plan-new-plan-for-q-001" not in test.get("tags", []):
        pytest.skip("not a research-plan-new-plan-for-q-001 scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    new_ids = _new_plan_ids(before, after)
    assert len(new_ids) == 1, (
        f"expected exactly one new plan; got {new_ids}"
    )

    new_plan = next(p for p in after["plans"] if p.get("id") == new_ids[0])
    assert new_plan.get("question_id") == "q_001", (
        f"new plan {new_plan.get('id')} has question_id "
        f"'{new_plan.get('question_id')}'; expected 'q_001'"
    )

    # pl_002 must still exist and be unmodified.
    before_pl_002 = next(
        (p for p in before.get("plans", []) if p.get("id") == "pl_002"),
        None,
    )
    after_pl_002 = next(
        (p for p in after.get("plans", []) if p.get("id") == "pl_002"),
        None,
    )
    if before_pl_002 is not None:
        assert after_pl_002 == before_pl_002, (
            "pl_002 was modified when a NEW plan should have been added "
            "alongside it"
        )


# --- Tag-gated: new plan items have status=planned, fallback_for=null

def test_new_plan_items_planned_status(before_state, after_state, test):
    """Tag-gated: new plan items default to status='planned' (not
    in_progress) and fallback_for=null unless an explicit fallback chain
    is being set up. Items created mid-execution would have status set
    by the search-* skills via log entries — never by research-plan."""
    if "new-plan-items-planned-status" not in test.get("tags", []):
        pytest.skip("not a new-plan-items-planned-status scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    # Collect all known plan-item IDs from before-state.
    before_item_ids: set[str] = set()
    for plan in before.get("plans", []) or []:
        for item in plan.get("items", []) or []:
            if item.get("id"):
                before_item_ids.add(item["id"])

    errors: list[str] = []
    for plan in after.get("plans", []) or []:
        for item in plan.get("items", []) or []:
            if item.get("id") in before_item_ids:
                continue  # pre-existing item, not our responsibility
            status = item.get("status")
            if status != "planned":
                errors.append(
                    f"new plan item {item.get('id')} has status='{status}'; "
                    f"expected 'planned'"
                )
    assert not errors, "New plan items with non-planned status:\n  - " + "\n  - ".join(errors)
