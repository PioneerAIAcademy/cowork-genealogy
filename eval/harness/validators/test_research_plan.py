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

import json
import re

import pytest

from validators_lib import (
    assert_log_append_only,
    assert_no_section_deletions,
)

# Identifier extraction is shared with `make provenance-report` (issue #1667)
# so the two agree on what counts as a traceable identifier: ARKs and 5+ digit
# numbers only, which is what keeps four-digit years out of the match set.
from provenance_report import candidate_identifiers


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

    This is one of two routing-independent gates for `ut_research_plan_003`
    (`grade_on_invariant`): whichever skill ends up handling the prompt, no run
    may leave a mark on `plans[]`. Its companion
    `test_resolved_question_not_reopened` guards the question's own state —
    `status`, `exhaustive_declaration`, `project.status` — which this one does
    not look at and which is the likelier harm on that prompt. Both are gated
    on the same tag; neither is sufficient alone.
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
        # Accumulate PER PLAN. Checking the shared `errors` for emptiness would
        # let a second damaged plan slip through unnamed once the first has
        # reported — the assert still fires, but you fix pl_001, re-run, and
        # only then learn pl_002 was wrong too.
        plan_errors: list[str] = []
        for gone in before_items.keys() - after_items.keys():
            plan_errors.append(f"{pid}: item {gone} DELETED from an existing plan")
        for added in after_items.keys() - before_items.keys():
            plan_errors.append(f"{pid}: item {added} added to an existing plan")
        for both in before_items.keys() & after_items.keys():
            if before_items[both] != after_items[both]:
                plan_errors.append(f"{pid}: item {both} modified in place")
        for field in set(prior) | set(plan):
            if field == "items":
                continue
            if prior.get(field) != plan.get(field):
                plan_errors.append(
                    f"{pid}: plan field '{field}' changed "
                    f"{prior.get(field)!r} -> {plan.get(field)!r}"
                )
        if not plan_errors:  # differs, but no rule above named it — never silent
            plan_errors.append(
                f"{pid}: plan object changed in a way this check did not classify"
            )
        errors.extend(plan_errors)
    assert not errors, (
        "research-plan wrote to a question whose search is already declared "
        "exhaustive:\n  - " + "\n  - ".join(errors)
    )


def test_resolved_question_not_reopened(before_state, after_state, test):
    """Tag-gated: the resolved question's own state must survive untouched.

    Companion to `test_no_plan_writes_when_resolved`, and the more important
    half. That one guards `plans[]`; this guards the fields the ut_003 prompt
    actually tempts the skill to change.

    Why it has to exist here rather than being covered already: the universal
    `test_ownership_table` / `test_tree_ownership_table` **skip themselves on
    negative tests**, and their docstring gives the reason — "a negative test
    where the skill *does* wrongly activate already fails on the routing
    check." `grade_on_invariant: true` is precisely the flag that removes that
    routing check (`orchestrator.py` returns "pass" the moment validators
    pass), so for this test the premise behind the skip is void and nothing
    replaces it. Verified against the real fixture: with a writer-tool call
    present, flipping `q_001` back to open, un-declaring exhaustiveness,
    reopening `project.status`, or rewriting the question text all scored a
    clean pass before this check existed.

    That is the harm the prompt invites. "The probate search came up empty —
    are we done?" tempts reopening the question far more than it tempts adding
    a plan item, and reopening silently undoes a completed GPS proof: the
    declaration and the proof summary both cite the negative probate result.

    Deliberately narrow. A blanket "questions[] must not change" would
    false-fail the legitimate routes — `question-selection` may append a
    follow-on question, which is one of this test's `correct_skill` answers.
    So this names the specific deltas that are never legitimate here: the
    target question's `status` and `exhaustive_declaration`, and
    `project.status`. Same shape as
    `test_search_external_sites.py::test_no_external_search_or_log_on_routeaway_negative`.
    """
    if "no-plan-writes-when-resolved" not in test.get("tags", []):
        pytest.skip("not a no-plan-writes-when-resolved scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    def _resolved(research: dict) -> dict:
        return {
            q.get("id"): q
            for q in (research.get("questions") or [])
            if q.get("status") == "resolved"
            or (q.get("exhaustive_declaration") or {}).get("declared")
        }

    before_q = _resolved(before)
    if not before_q:
        pytest.skip("no resolved/declared question in the before-state")

    errors: list[str] = []
    after_q = {q.get("id"): q for q in (after.get("questions") or [])}
    for qid, was in before_q.items():
        now = after_q.get(qid)
        if now is None:
            errors.append(f"{qid}: resolved question DELETED")
            continue
        for field in ("status", "exhaustive_declaration", "question",
                      "resolution_assertion_ids", "resolved"):
            if was.get(field) != now.get(field):
                errors.append(
                    f"{qid}: '{field}' changed {was.get(field)!r} -> "
                    f"{now.get(field)!r} on a question whose search is "
                    f"already declared exhaustive"
                )

    before_status = (before.get("project") or {}).get("status")
    after_status = (after.get("project") or {}).get("status")
    if before_status != after_status:
        errors.append(
            f"project.status changed {before_status!r} -> {after_status!r}"
        )

    assert not errors, (
        "the resolved question's own state was modified:\n  - "
        + "\n  - ".join(errors)
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


# --- Tag-gated: the objective's target record leads the plan ----------

# Scenario-specific expectation for `hansen-kongsberg-baptism`. Its objective
# asks for a birth or baptism record and supplies the place, so SKILL.md
# step 4 item 7 makes the Kongsberg baptism the first research target. Trysil
# is the death place: legitimate corroboration, but not ahead of the target
# and not a precondition for reaching it.
#
# Deliberately mechanical and judge-independent. The rubric's `Sequencing
# logic` dimension does not discriminate: across every committed run log it
# scores 3 on all but one graded occurrence. No exact count is quoted here on
# purpose -- it has needed re-deriving twice (73 of 74, then 93 of 94) as new
# logs landed and old ones were pruned, and nothing guards the figure, so a
# number in this comment is stale the moment the corpus moves. Re-derive it
# from `eval/runlogs/unit/research-plan/v*.json` if you need it. The 2026-08-24
# dive called the dimension "worse than no" -- it once cited a fabricated
# collection id as its evidence -- and `rubric.md` is fenced by #1404/#1668, so
# the ordering this guards cannot be enforced there. Origin: alpha feedback
# #1945.
_TARGET_JURISDICTION = "kongsberg"
# `record_type` is an open string with only *recommended* values
# (`enums.schema.json` -> record_type_recommended), and a baptism register is
# defensibly either. Both spellings have been observed for this scenario's
# target: `church` in the 09:58 run, `vital_record` in the 18:16 run. The
# jurisdiction is the discriminator here, not the type -- the Trysil burial is
# `vital_record` as well -- so this set must stay narrow enough to exclude
# census/probate/military/land, which are breadth items and not the record the
# objective asked for.
_TARGET_RECORD_TYPES = ("church", "vital_record")
_INDIRECT_JURISDICTION = "trysil"


def _plan_items_in_sequence(research: dict) -> list[dict]:
    items: list[dict] = []
    for plan in research.get("plans", []) or []:
        for item in plan.get("items", []) or []:
            items.append(item)
    return sorted(items, key=lambda i: i.get("sequence") or 0)


def test_objective_target_leads_the_plan(before_state, after_state, test):
    """Tag-gated: the record the objective asks for is the first research
    target, and is not gated behind an indirect source (SKILL.md step 4
    item 7).

    Two distinct failures, both seen in the submitted session behind #1945:
    the target sequenced behind the death place, and the target written as
    a `fallback_for` of a death-place item so it is only reached if that
    search succeeds."""
    if "objective-target" not in test.get("tags", []):
        pytest.skip("not an objective-target scenario")
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("missing research.json for diff")

    items = _plan_items_in_sequence(after)
    if not items:
        pytest.skip("no plan items written")

    def juris(item: dict) -> str:
        return str(item.get("jurisdiction") or "").lower()

    # An item naming BOTH places cannot be the target. `jurisdiction` is free
    # text and the skill really writes multi-place values -- `r3d`'s own run
    # produced "Trysil, Hedmark, Norway; Kongsberg, Buskerud, Norway" -- so
    # without this exclusion one item satisfies both the target test and the
    # ahead-of-target test, and relabelling the seq-1 death item makes the
    # identical defect pass. Found in review of #2033.
    target = next(
        (
            i
            for i in items
            if _TARGET_JURISDICTION in juris(i)
            and _INDIRECT_JURISDICTION not in juris(i)
            and str(i.get("record_type") or "").lower() in _TARGET_RECORD_TYPES
        ),
        None,
    )
    assert target is not None, (
        f"no plan item targets the objective's record "
        f"(record_type in {_TARGET_RECORD_TYPES} in {_TARGET_JURISDICTION.title()}); "
        f"items were: "
        + ", ".join(
            f"seq {i.get('sequence')} {i.get('record_type')}/{i.get('jurisdiction')}"
            for i in items
        )
    )

    target_seq = target.get("sequence") or 0
    ahead = [
        i
        for i in items
        if _INDIRECT_JURISDICTION in juris(i)
        and (i.get("sequence") or 0) < target_seq
    ]
    assert not ahead, (
        f"the objective asks for a baptism record in "
        f"{_TARGET_JURISDICTION.title()} and supplies the place, but "
        f"{len(ahead)} {_INDIRECT_JURISDICTION.title()} item(s) are sequenced "
        f"ahead of it (target is seq {target_seq}):\n  - "
        + "\n  - ".join(
            f"seq {i.get('sequence')} {i.get('record_type')} — "
            f"{str(i.get('rationale') or '')[:120]}"
            for i in ahead
        )
    )

    # The target must not be reachable only via an indirect item.
    fallback_of = target.get("fallback_for")
    if fallback_of:
        parent = next((i for i in items if i.get("id") == fallback_of), None)
        assert parent is None or _INDIRECT_JURISDICTION not in juris(parent), (
            f"the objective's target item {target.get('id')} is a "
            f"fallback_for {fallback_of}, a {_INDIRECT_JURISDICTION.title()} "
            f"item — the requested record must not be gated behind an "
            f"indirect source"
        )
# ===========================================================================
# Deterministic checks over newly written plans (issue #1866, research-plan
# deep dive #1650). Unlike the tag-gated validators above these run on EVERY
# research-plan test and skip only when the run added no new plan: a tag
# nobody sets is how a validator runs, passes, and cannot fail (#1755, #1788).
# ===========================================================================


def _new_plans(before: dict, after: dict) -> list[dict]:
    """Plan objects present in after-state but not before-state."""
    before_ids = {p.get("id") for p in (before.get("plans") or [])}
    return [
        p
        for p in (after.get("plans") or [])
        if p.get("id") and p.get("id") not in before_ids
    ]


def _bare(tool: str) -> str:
    """Bare tool name, whatever server prefix the run exposed it under."""
    tool = tool or ""
    return tool.split("__")[-1] if "__" in tool else tool


# --- V3: fallback_for must name an item in the same plan --------------------

def test_research_plan_fallback_for_in_same_plan(before_state, after_state):
    """A new plan item's non-null `fallback_for` must be the id of another
    item in the same new plan. A fallback pointing into a different plan —
    often a completed one — leaves the new plan with no internal fallback
    chain at all. Issue #1866 V3, e.g. ut_research_plan_002 pli_013 →
    pli_006, an item of the completed pl_002."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new_plans = _new_plans(before, after)
    if not new_plans:
        pytest.skip("run added no new plan")

    errors: list[str] = []
    for plan in new_plans:
        item_ids = {
            item.get("id") for item in (plan.get("items") or []) if item.get("id")
        }
        for item in plan.get("items") or []:
            target = item.get("fallback_for")
            if target and target not in item_ids:
                errors.append(
                    f"{plan.get('id')} item {item.get('id')} has "
                    f"fallback_for={target!r}, not an item in the same plan "
                    f"(items: {sorted(item_ids)})"
                )
    assert not errors, (
        "fallback_for points outside its own plan:\n  - " + "\n  - ".join(errors)
    )


# --- V2: research-plan calls no MCP tool outside its six --------------------

_FORBIDDEN_TOOLS = {"wiki_search", "wiki_place_page", "place_population"}
_FORBIDDEN_SKILL = "locality-guide"


def test_research_plan_no_out_of_lane_tools(
    tool_calls, attempted_mcp_calls, skills_invoked
):
    """research-plan owns six tools and states "You have no wiki/place-fact
    tools of your own" (SKILL.md 137). Fail on any call OR attempt of
    wiki_search / wiki_place_page / place_population, or delegation to
    locality-guide (SKILL.md 128, 499). Issue #1866 V2.

    Named prohibition, not the complement of the six: project_context is
    attempted by sibling skills and forbidden by nothing, so a complement
    gate reds it. Deriving a deny from a grant is what PR #1774 retired. A
    denied call never reaches tool_calls, so union the attempts (#1748)."""
    called = [_bare(c.get("tool", "")) for c in (tool_calls or [])]
    attempted = [_bare(c.get("tool", "")) for c in (attempted_mcp_calls or [])]
    hit_tools = sorted({t for t in called + attempted if t in _FORBIDDEN_TOOLS})
    delegated = _FORBIDDEN_SKILL in (skills_invoked or [])

    problems: list[str] = []
    if hit_tools:
        problems.append(f"forbidden tool(s) called or attempted: {hit_tools}")
    if delegated:
        problems.append(f"delegated to {_FORBIDDEN_SKILL!r}")
    assert not problems, (
        "research-plan reached outside its six-tool lane:\n  - "
        + "\n  - ".join(problems)
    )


# --- V1: identifiers in a rationale must trace to a served response ---------

_TRACEABLE_ID_TOOLS = {"collections_search", "volume_search", "external_links_search"}


# Grounding is deliberately more permissive than candidate_identifiers. A
# served/before-state value written as a hyphenated RANGE — "(FamilySearch
# volumes 007316661-007316663)" — must ground BOTH endpoints, but
# candidate_identifiers' NUM_RE refuses any digit run touching a hyphen (one
# endpoint blocked by the trailing '-', the other by the leading one), so the
# range grounds nothing while the rationale, which cites the volumes
# individually, extracts and flags them as fabrications (issue #1866,
# johnmarkpeterbrown). This looser pattern tolerates hyphen adjacency; it is
# unioned onto candidate_identifiers so grounding stays a strict SUPERSET —
# permissive grounding can only remove a false fabrication, never add one. The
# CITED side keeps candidate_identifiers, matching make provenance-report.
# The lookbehind must NOT exclude '/': external_links_search is in
# _TRACEABLE_ID_TOOLS because it returns collection ids, and it returns them
# only as URL path segments ("ancestry.com/search/collections/61749/"), so
# excluding a slash-preceded run made every id that tool serves ungroundable
# — 22 of the 40 across its 16 fixtures — and turned a correct citation into
# a fabrication flag (ut_research_plan_r3d, v1_2026-09-01_07-35-31). Widening
# grounding can only clear a false positive, per the invariant above.
_GROUNDED_NUM_RE = re.compile(r"(?<![\w.:])\d{5,}(?![\w.])")


def _grounded_identifiers(text: str) -> set[str]:
    """Identifiers a rationale may cite without it counting as a fabrication.

    Superset of candidate_identifiers: the same ARKs and strict numbers, plus
    5+ digit runs that touch a hyphen (the endpoints of a written range), which
    candidate_identifiers deliberately refuses. Used only for the GROUNDED set
    (served responses ∪ before-state), never for the cited identifiers."""
    return candidate_identifiers(text) | set(_GROUNDED_NUM_RE.findall(text))


def _served_identifiers(tool_calls) -> set[str]:
    """Every ARK/5+digit identifier in a response this run received from a
    tool that returns collection/volume identifiers. Grounded (permissive):
    a hyphenated range in the response grounds both endpoints."""
    served: set[str] = set()
    for c in tool_calls or []:
        if _bare(c.get("tool", "")) not in _TRACEABLE_ID_TOOLS:
            continue
        resp = c.get("response")
        if resp is None:
            continue
        served |= _grounded_identifiers(json.dumps(resp))
    return served


def test_research_plan_rationale_identifiers_traceable(
    before_state, after_state, tool_calls
):
    """A collection or volume identifier written into a new plan item's
    rationale must appear in a tool response this run received OR in the
    research.json the run started from — otherwise search-records reads the
    persisted rationale and chases a collection the skill was never shown.
    Issue #1866 V1, e.g. ut_research_plan_006 pli_007 cites collection
    1401638, which no fixture that run served and which is not in that
    scenario's before-state.

    The grounded set is the UNION of two sources (issue #1866, EdmondOware's
    correction): every traceable-tool response the run received, and the
    starting research.json. SKILL.md Step 2 tells the skill to read the
    `localities` entries and carry their facts — including collection and
    volume ids — into the plan rationales, and those ids never appear in a
    tool response for that run. Grounding against served ids alone
    false-positives on exactly that correct behaviour (e.g.
    ut_research_plan_wzk cites loc_001's volume ids from the
    martha-remarriage-surname-plan scenario). An id in NEITHER source is a
    fabrication.

    Scoped to ARKs and 5+ digit numbers (candidate_identifiers, shared with
    make provenance-report), so four-digit years never enter the check."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new_plans = _new_plans(before, after)
    if not new_plans:
        pytest.skip("run added no new plan")

    # Grounded = served responses ∪ the run's starting research.json. The
    # before-state arm is scanned whole (not just `localities`): an id the
    # skill carried from any prior-state field it legitimately read is not a
    # fabrication, and _grounded_identifiers already excludes years. Both arms
    # use _grounded_identifiers so a hyphenated range (json.dumps preserves the
    # hyphen) grounds both endpoints; the CITED side below stays strict.
    grounded = _served_identifiers(tool_calls) | _grounded_identifiers(
        json.dumps(before)
    )
    errors: list[str] = []
    for plan in new_plans:
        for item in plan.get("items") or []:
            rationale = item.get("rationale") or ""
            for ident in sorted(candidate_identifiers(rationale)):
                if ident not in grounded:
                    errors.append(
                        f"{plan.get('id')} item {item.get('id')} rationale "
                        f"cites {ident!r}, which appears in no tool response "
                        f"this run received and not in the starting research.json"
                    )
    assert not errors, (
        "untraceable identifier in a plan rationale:\n  - " + "\n  - ".join(errors)
    )


# --- V5: an availability claim must match the returned personCount ----------

_INDEXED_RE = re.compile(r"\b(?:fully\s+)?indexed\b", re.I)
_UNINDEXED_RE = re.compile(r"\b(?:un-?indexed|not\s+indexed)\b", re.I)
_BROWSE_ONLY_RE = re.compile(r"\b(?:browse|image)[\s-]?only\b", re.I)


def _collection_person_counts(tool_calls) -> dict[str, set[int]]:
    """id -> set of personCounts across every collections_search response
    this run received. An id can be served with different counts in
    different responses (1999196 is 0 in schuylkill, 893214 in
    pennsylvania), so key on the response, not the id."""
    counts: dict[str, set[int]] = {}
    for c in tool_calls or []:
        if _bare(c.get("tool", "")) != "collections_search":
            continue
        resp = c.get("response") or {}
        for r in resp.get("results") or []:
            cid, pc = r.get("id"), r.get("personCount")
            if cid is None or pc is None:
                continue
            counts.setdefault(str(cid), set()).add(int(pc))
    return counts


def test_research_plan_availability_claim_matches_counts(
    before_state, after_state, tool_calls
):
    """A rationale that calls a served collection "indexed" must name one
    whose returned personCount is > 0; "browse-only"/"image-only" must name
    one whose personCount is 0. Issue #1866 V5, e.g. ut_research_plan_q7m
    pli_007 calls 1999196 "indexed" against a served personCount of 0.

    Bind the adjective to the identifier within one sentence and skip any
    sentence naming more than one served collection — a rationale routinely
    describes a browse-only volume and an indexed collection in one breath.
    personCount is a property of the response, so key on what was served."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    new_plans = _new_plans(before, after)
    if not new_plans:
        pytest.skip("run added no new plan")

    counts = _collection_person_counts(tool_calls)
    if not counts:
        pytest.skip("no collections_search response to check against")

    errors: list[str] = []
    for plan in new_plans:
        for item in plan.get("items") or []:
            rationale = item.get("rationale") or ""
            for sentence in re.split(r"(?<=[.;])\s+|\n+", rationale):
                ids_here = [i for i in candidate_identifiers(sentence) if i in counts]
                if len(ids_here) != 1:
                    continue  # skip no-collection and multi-collection sentences
                cid = ids_here[0]
                pcs = counts[cid]
                claims_indexed = bool(_INDEXED_RE.search(sentence)) and not (
                    _UNINDEXED_RE.search(sentence)
                )
                claims_browse = bool(_BROWSE_ONLY_RE.search(sentence)) or bool(
                    _UNINDEXED_RE.search(sentence)
                )
                if claims_indexed == claims_browse:
                    continue  # neither claim, or a self-contradicting sentence
                if claims_indexed and not any(pc > 0 for pc in pcs):
                    errors.append(
                        f"{plan.get('id')} item {item.get('id')} calls "
                        f"collection {cid} \"indexed\" but every response this "
                        f"run received returned personCount 0"
                    )
                elif claims_browse and not any(pc == 0 for pc in pcs):
                    errors.append(
                        f"{plan.get('id')} item {item.get('id')} calls "
                        f"collection {cid} browse/image-only but the served "
                        f"response returned personCount {sorted(pcs)}"
                    )
    assert not errors, (
        "availability claim contradicts returned personCount:\n  - "
        + "\n  - ".join(errors)
    )
