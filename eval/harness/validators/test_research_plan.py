"""Suite-specific validators for the research-plan agent.

research-plan creates a sequenced plan entry for a research question. It was a
skill until issue #2116; the validators for the one test that moved to the
research suite (`ut_research_rpn`) moved to `test_research.py` with it.
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
    extract_year,
)
from validators_lib import existing_plan_changes
from validators_lib import new_plan_ids as _new_plan_ids

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


# --- Tag-gated: review mode writes nothing to plans ------------------------

def test_review_writes_no_plan(before_state, after_state, test):
    """Tag-gated (``research-plan-review-no-writes``): a review leaves `plans[]`
    exactly as it found it.

    Review mode (Step 1a) recaps an active plan that still has unfinished items
    and writes nothing. ``research-plan-no-new-plan`` catches only a whole new
    ``pl_``, and ``pli-006-status-unchanged`` only that one item's status, so an
    item appended to the active plan, an existing item edited, or the plan's own
    ``status`` set to ``completed`` passed both -- the last being exactly what a
    delegation saying "the current plan is finished" invites
    (``ut_research_plan_d01``). Issue #2116. Measured before gating: across the
    eight committed run logs from 2026-10-07 on, the two review tests made zero
    ``research_append`` calls in all 16 runs, so this cannot false-fail a run
    that reviewed.
    """
    if "research-plan-review-no-writes" not in test.get("tags", []):
        pytest.skip("not a research-plan-review-no-writes scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    errors = [f"new plan {pid} written" for pid in _new_plan_ids(before, after)]
    errors += existing_plan_changes(before, after)
    assert not errors, (
        "review mode wrote to plans:\n  - " + "\n  - ".join(errors)
    )


# --- Tag-gated: Dispose mode closes out only the named planned items -------

_DISPOSE_FIELDS = ("status", "skip_category", "skip_reason")


def _delegated_item_ids(test: dict) -> str:
    """The `planItemIds:` line of a direct test's delegation, or "" (any id)."""
    for line in (test.get("delegation") or "").splitlines():
        if line.strip().lower().startswith("planitemids:"):
            return line
    return ""


def test_dispose_named_items(before_state, after_state, test):
    """Tag-gated (``research-plan-dispose``): Dispose mode (Step 1a) closes out
    the open items it was named and does nothing else.

    research-exhaustiveness refuses a stop-gate declaration while an item on the
    active plan is still `planned`, and the router then spawns research-plan to
    dispose of the named items: each becomes `completed` if its search was done
    and logged, otherwise `skipped` with a `skip_category`. No item is added or
    deleted, no plan is superseded or written, and a planned item changes only
    in those three fields. A `completed` item no log entry names claims a search
    that never ran. Issue #2116: Dispose mode is entered on the caller's word, so
    it is the one mode the agent's delegation rule has to let through, and no
    test reached it before.
    """
    if "research-plan-dispose" not in test.get("tags", []):
        pytest.skip("not a research-plan-dispose scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")

    named = set(re.findall(r"pli_\d+", _delegated_item_ids(test)))
    errors = [f"new plan {pid} written" for pid in _new_plan_ids(before, after)]
    logged = {
        entry.get("plan_item_id")
        for entry in (after.get("log") or [])
        if entry.get("plan_item_id")
    }
    before_plans = {p.get("id"): p for p in (before.get("plans") or []) if p.get("id")}
    disposed: list[str] = []
    for plan in after.get("plans") or []:
        prior = before_plans.get(plan.get("id"))
        if prior is None:
            continue
        pid = plan.get("id")
        for field in sorted((set(prior) | set(plan)) - {"items"}):
            if prior.get(field) != plan.get(field):
                errors.append(
                    f"{pid}: plan field {field!r} changed {prior.get(field)!r} -> "
                    f"{plan.get(field)!r}; Dispose mode leaves the plan itself alone"
                )
        was_items = {i.get("id"): i for i in (prior.get("items") or []) if i.get("id")}
        now_items = {i.get("id"): i for i in (plan.get("items") or []) if i.get("id")}
        errors += [f"{pid}: item {i} added" for i in sorted(now_items.keys() - was_items.keys())]
        errors += [f"{pid}: item {i} deleted" for i in sorted(was_items.keys() - now_items.keys())]
        for iid in sorted(was_items.keys() & now_items.keys()):
            was, now = was_items[iid], now_items[iid]
            if was == now:
                continue
            # `in_progress` counts too, since section B of
            # docs/plan/research-step-mode.md: a search that ran without closing
            # its item leaves it `in_progress`, and the router's dispose row now
            # names those as well. Leaving them out is what let a searched item
            # sit undisposed while the declaration stayed refused for good.
            if was.get("status") not in ("planned", "in_progress"):
                errors.append(
                    f"{iid}: changed, but it was {was.get('status')!r}, "
                    "not planned or in_progress"
                )
                continue
            if named and iid not in named:
                errors.append(f"{iid}: changed, but the delegation did not name it")
            rest = lambda item: {k: v for k, v in item.items() if k not in _DISPOSE_FIELDS}  # noqa: E731
            if rest(was) != rest(now):
                errors.append(f"{iid}: fields other than status/skip_category/skip_reason changed")
            status = now.get("status")
            if status == "skipped":
                if not now.get("skip_category"):
                    errors.append(f"{iid}: skipped with no skip_category")
                # A search that RAN is never `skipped`: `research_append` refuses it
                # (decision 9 of docs/plan/attached-records-baseline.md), because a
                # skip says nothing was searched and research-exhaustiveness reads a
                # disposed item as settled.
                if iid in logged:
                    errors.append(
                        f"{iid}: skipped, but a log entry names it -- a searched item "
                        "is `completed`, and research_append refuses the skip"
                    )
                disposed.append(iid)
            elif status == "completed":
                if iid not in logged:
                    errors.append(f"{iid}: completed, but no log entry names it")
                disposed.append(iid)
            else:
                errors.append(f"{iid}: status {status!r} is not a disposal")
    if not disposed:
        errors.append("no item was disposed of")
    still_open = {
        i.get("id")
        for p in (after.get("plans") or [])
        for i in (p.get("items") or [])
        if i.get("status") in ("planned", "in_progress")
    }
    errors += [
        f"{iid}: named for disposal but still open"
        for iid in sorted(named & still_open)
    ]
    assert not errors, "Dispose mode wrote the wrong thing:\n  - " + "\n  - ".join(errors)


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

def _enumerative_skip(item: dict, question: dict | None) -> bool:
    """The one non-`planned` status a new item may carry: on an `enumerative`
    question (#1830 item 1, the lead's 2026-08-31 ruling on #1917), each of
    the five event types the plan does not cover is written as a `skipped`
    item stating why — a category and a reason, both non-empty, for one of
    the five events (`_covered_events`)."""
    return (
        (question or {}).get("question_kind") == "enumerative"
        and item.get("status") == "skipped"
        and bool(str(item.get("skip_category") or "").strip())
        and bool(str(item.get("skip_reason") or "").strip())
        and bool(_covered_events(item))
    )


def test_new_plan_items_planned_status(before_state, after_state, test):
    """Tag-gated: new plan items default to status='planned' (not
    in_progress) and fallback_for=null unless an explicit fallback chain
    is being set up. Items created mid-execution would have status set
    by the search-* skills via log entries — never by research-plan.
    The one exception is `_enumerative_skip`; on a targeted or unlabelled
    question a `skipped` item at creation still fails, which is what stops
    the enumerative obligation over-firing."""
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

    questions = {q.get("id"): q for q in after.get("questions", []) or []}

    errors: list[str] = []
    for plan in after.get("plans", []) or []:
        question = questions.get(plan.get("question_id"))
        for item in plan.get("items", []) or []:
            if item.get("id") in before_item_ids:
                continue  # pre-existing item, not our responsibility
            status = item.get("status")
            if status != "planned" and not _enumerative_skip(item, question):
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
    # ANY earlier item, not just an indirect-jurisdiction one. Keying this on
    # `_INDIRECT_JURISDICTION` made it a place-name substring match: `jurisdiction`
    # is free text and the skill routinely writes a bare county or country, so a
    # leading item labelled "Norway" — an actual value in this scenario's own run —
    # slipped past while the identical defect labelled "Trysil, Hedmark, Norway"
    # was caught. Same evasion class as the combined-jurisdiction one, one field
    # over (#2033 review). The rule the objective states is that the target LEADS;
    # what precedes it is not the point.
    ahead = [i for i in items if (i.get("sequence") or 0) < target_seq]
    assert not ahead, (
        f"the objective asks for a baptism record in "
        f"{_TARGET_JURISDICTION.title()} and supplies the place, but "
        f"{len(ahead)} item(s) are sequenced "
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


# --- Tag-gated: a pension item reaches past the question's window -----------

# Issue #1830 item A, scenario `rowe-window-is-not-a-ceiling`. The question asks
# about 1850-1865; the record that answers it is a widow's pension file, which
# cannot predate Josiah Rowe's 1879 death. The fixture never dates the file, so
# 1879 is a fixture choice, stated in its README. The general rule stays in
# principle 10; this certifies the one fixture.
_PENSION_REACH_BY_TEST_ID = {
    "ut_research_plan_wnc": 1879,
}
# `record_type` only, not the rationale. Over the 12 scratch plans a rationale
# match adds no pension item a `record_type` match misses, and admits a
# cemetery item dated 1848-1880 whose rationale mentions the pension -- so a
# plan whose every military item stopped at 1865 would pass on it, the same
# hole as any-item-reaches-past (mechanism 3 on the issue).
_PENSION_RECORD_TYPE_RE = re.compile(r"military|pension", re.IGNORECASE)
# A decade ("1870s") reaches its last year. "later"/"after" open a range only as
# its last word: "1862-1865 (after enlistment)" stops at 1865.
_DATE_RANGE_YEAR_RE = re.compile(r"\b(1\d{3}|20\d{2})(s?)\b")
_OPEN_ENDED_RE = re.compile(
    r"[-–—]\s*$|\b(?:present|onwards?|forward)\b|\b(?:later|after)\s*$|\+\s*$", re.IGNORECASE
)


def _date_range_reaches(date_range: object, threshold: int) -> bool:
    text = str(date_range or "").strip()
    years = [int(y) + (9 if decade else 0) for y, decade in _DATE_RANGE_YEAR_RE.findall(text)]
    if not years:
        return False
    if max(years) >= threshold:
        return True
    return bool(_OPEN_ENDED_RE.search(text))


def test_pension_item_reaches_past_window(before_state, after_state, test):
    """Tag-gated: at least one new military/pension plan item has a
    `date_range` reaching the fixture's pension-file year.

    At least one, not every: a compiled-service-record item dated to the
    service years is legitimate alongside a pension item. Only military and
    pension items are scoped, so a late probate or cemetery item cannot carry
    a plan whose pension search stops at the window."""
    tags = test.get("tags") or []
    test_id = test.get("id")
    assert test_id not in _PENSION_REACH_BY_TEST_ID or "pension-reaches-past-window" in tags, (
        f"{test_id} has a _PENSION_REACH_BY_TEST_ID entry but no "
        "'pension-reaches-past-window' tag - restore the tag or delete the entry"
    )
    if "pension-reaches-past-window" not in tags:
        pytest.skip("not a pension-reaches-past-window test")
    threshold = _PENSION_REACH_BY_TEST_ID.get(test_id)
    assert threshold, (
        f"{test_id} carries 'pension-reaches-past-window' but has no entry in "
        "_PENSION_REACH_BY_TEST_ID"
    )
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    items = [i for p in _new_plans(before, after) for i in (p.get("items") or [])]
    assert items, "no new plan items were written"

    pension_items = [
        i for i in items if _PENSION_RECORD_TYPE_RE.search(str(i.get("record_type") or ""))
    ]
    assert any(_date_range_reaches(i.get("date_range"), threshold) for i in pension_items), (
        f"no military/pension item's date_range reaches {threshold}, the "
        f"pension file's earliest date; the window bounds the question, not "
        f"the records that answer it. Military/pension items: "
        + (
            "; ".join(
                f"{i.get('id')} {i.get('record_type')} {i.get('date_range')!r}"
                for i in pension_items
            )
            or "none"
        )
    )


# --- Tag-gated: an enumerative question's plan accounts for five events ------

# Issue #1830 item 1, the lead's 2026-08-31 ruling on #1917: an enumerative
# question's plan covers birth, marriage, death, census and probate, and says in
# writing why any is absent. "In writing" is a `skipped` item with a category
# and a reason (`_enumerative_skip`). `record_type` alone cannot separate the
# three vital events — the five enumerative corpus plans file birth, marriage and
# death alike as `vital_record` — so a vital-type item counts for the one event
# its record_type names, else the first event its rationale names. Only the
# first: in 8 of the 9 pre-edit `ut_research_plan_enm` runs a marriage or
# cemetery item's rationale mentioned children "born", and no item searched for
# a birth. Death is not matched on a probate rationale that merely says the
# subject died.
_VITAL_RECORD_TYPES = re.compile(r"vital|church|parish|civil|birth|marriage|death|cemetery|burial", re.IGNORECASE)
_CENSUS_RE = re.compile(r"\bcensus", re.IGNORECASE)
_PROBATE_RECORD_TYPE_RE = re.compile(r"probate|(?<!real[_ ])estate|\bwills?\b", re.IGNORECASE)
_PROBATE_TEXT_RE = re.compile(r"\bprobate|\bestates?\b|\bwills\b|\btestament", re.IGNORECASE)
_FIVE_EVENTS = {
    "birth": re.compile(r"\b(?:births?|born|baptisms?|baptized|baptised|christenings?|christened)\b", re.IGNORECASE),
    "marriage": re.compile(r"\b(?:marriages?|married|marry|banns|wedding)\b", re.IGNORECASE),
    "death": re.compile(r"\b(?:deaths?|died|burials?|buried|obituary|obituaries)\b", re.IGNORECASE),
}
_EVENT_IN_RECORD_TYPE = {
    "birth": re.compile(r"birth|baptis|christen", re.IGNORECASE),
    "marriage": re.compile(r"marri|wedding", re.IGNORECASE),
    "death": re.compile(r"death|burial|cemetery|obit", re.IGNORECASE),
}


def _vital_events(record_type: str, rationale: str) -> set[str]:
    named = {name for name, pattern in _EVENT_IN_RECORD_TYPE.items() if pattern.search(record_type)}
    if named:
        return named
    hits = [(m.start(), name) for name, pattern in _FIVE_EVENTS.items() if (m := pattern.search(rationale))]
    return {min(hits)[1]} if hits else set()


def _covered_events(item: dict) -> set[str]:
    """The one event an item searches, or skips. A `skipped` item filed under a
    `record_type` that names no event counts for the first of the five its
    `skip_reason` names: the agent is told to write the reason, not which type
    to file the skip under."""
    record_type = str(item.get("record_type") or "")
    if _CENSUS_RE.search(record_type):
        return {"census"}
    if _PROBATE_RECORD_TYPE_RE.search(record_type):
        return {"probate"}
    if _VITAL_RECORD_TYPES.search(record_type):
        return _vital_events(record_type, str(item.get("rationale") or ""))
    if item.get("status") != "skipped":
        return set()
    reason = str(item.get("skip_reason") or "")
    patterns = {**_FIVE_EVENTS, "census": _CENSUS_RE, "probate": _PROBATE_TEXT_RE}
    hits = [(m.start(), name) for name, pattern in patterns.items() if (m := pattern.search(reason))]
    return {min(hits)[1]} if hits else set()


def test_enumerative_plan_accounts_for_five_events(before_state, after_state, test):
    """Tag-gated: for an enumerative question, each of birth, marriage, death,
    census and probate is either covered by a new plan item or written as a
    `skipped` item with a category and a reason."""
    if "enumerative-five-events" not in (test.get("tags") or []):
        pytest.skip("not an enumerative-five-events test")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    plans = _new_plans(before, after)
    assert plans, "no new plan was written"
    questions = {q.get("id"): q for q in after.get("questions") or []}

    for plan in plans:
        question = questions.get(plan.get("question_id"))
        assert (question or {}).get("question_kind") == "enumerative", (
            f"{plan.get('id')} plans {plan.get('question_id')}, which is not "
            f"enumerative — the fixture is wrong, not the plan"
        )
        accounted: set[str] = set()
        for item in plan.get("items") or []:
            if item.get("status") == "skipped" and not _enumerative_skip(item, question):
                continue  # a skip with no written reason accounts for nothing
            accounted |= _covered_events(item)
        missing = [e for e in ("birth", "marriage", "death", "census", "probate") if e not in accounted]
        assert not missing, (
            f"{plan.get('id')} (enumerative question {plan.get('question_id')}) "
            f"neither covers nor gives a written reason for: {', '.join(missing)}. "
            f"Items: "
            + "; ".join(
                f"{i.get('id')} {i.get('status')} {i.get('record_type')}"
                for i in plan.get("items") or []
            )
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


# --- V2: research-plan calls none of locality-guide's place-survey tools ----

_FORBIDDEN_TOOLS = {"wiki_search", "wiki_place_page", "place_population"}
_FORBIDDEN_SKILL = "locality-guide"


def test_research_plan_no_out_of_lane_tools(
    tool_calls, attempted_mcp_calls, skills_invoked, builtin_tool_calls=None
):
    """research-plan states "You have no place-survey tools" (the agent body's
    Step 2). Fail on any call OR attempt of wiki_search / wiki_place_page /
    place_population, or delegation to locality-guide. Issue #1866 V2.

    The agent holds none of these tools and no spawn tool (its `tools:` list,
    pinned by agent-tool-names.test.ts), so on the direct arm this gate catches
    a widened grant or a dispatcher that strays from its one Agent call, not a
    call the agent can make today.
    `wiki_read` is granted since issue #2251 for the Step 3 record-type
    pre-work and is deliberately not in the prohibition.

    Named prohibition, not the complement of the grant: project_context is
    attempted by sibling skills and forbidden by nothing, so a complement
    gate reds it. Deriving a deny from a grant is what PR #1774 retired. A
    denied call never reaches tool_calls, so union the attempts (#1748)."""
    called = [_bare(c.get("tool", "")) for c in (tool_calls or [])]
    attempted = [_bare(c.get("tool", "")) for c in (attempted_mcp_calls or [])]
    from harness.skill_runner import handoffs

    hit_tools = sorted({t for t in called + attempted if t in _FORBIDDEN_TOOLS})
    delegated = _FORBIDDEN_SKILL in handoffs(skills_invoked, builtin_tool_calls)

    problems: list[str] = []
    if hit_tools:
        problems.append(f"forbidden tool(s) called or attempted: {hit_tools}")
    if delegated:
        problems.append(f"delegated to {_FORBIDDEN_SKILL!r}")
    assert not problems, (
        "research-plan reached outside its tool lane:\n  - "
        + "\n  - ".join(problems)
    )


# --- Tag-gated: the question person's FamilySearch profile is read first -----


def _plan_write_ops(args: dict) -> list[dict]:
    """The ops of one `research_append` call, in either shape the model sends:
    `ops` as a list or a JSON string, or a single top-level op (same parse as
    test_universal.py's assertion-update check)."""
    ops = args.get("ops")
    if isinstance(ops, str):
        try:
            ops = json.loads(ops)
        except (ValueError, TypeError):
            ops = None
    candidates = ops if isinstance(ops, list) else ([args] if args.get("section") else [])
    return [op for op in candidates if isinstance(op, dict)]


def _pid_tail(value: str) -> str:
    """A FamilySearch person id as compared here: the text after an `ark`'s last
    `:` (a bare id has none), upper-cased, so `ark:/61903/4:1:zzkr-br1` and
    `ZZKR-BR1` are one person."""
    return value.split("?")[0].strip().rstrip("/").rsplit(":", 1)[-1].strip().upper()


def _subject_pids(research: dict, tree: dict) -> set[str]:
    """The `ark` ids of the project's subjects (`project.subject_person_ids`),
    read from the ids themselves, never by matching names."""
    subject_ids = set((research.get("project") or {}).get("subject_person_ids") or [])
    return {
        _pid_tail(p["ark"])
        for p in tree.get("persons") or []
        if p.get("id") in subject_ids and isinstance(p.get("ark"), str) and p["ark"].strip()
    }


def _question_person_pids(research: dict, tree: dict, subjects: str | None = None) -> set[str]:
    """FamilySearch ids of tree persons named in an open question's text: the
    `ark` tail (`ark:/61903/4:1:<PID>`) of every person whose preferred given
    name and surname both appear in it. `subjects="exclude"` leaves out the
    project's subjects (`project.subject_person_ids`)."""
    subject_ids = set((research.get("project") or {}).get("subject_person_ids") or [])
    text = " ".join(
        (q.get("question") or "")
        for q in research.get("questions") or []
        if q.get("status") in {"open", "in_progress"}
    ).lower()
    pids: set[str] = set()
    for person in tree.get("persons") or []:
        ark = person.get("ark") or ""
        if not ark:
            continue
        if subjects == "exclude" and person.get("id") in subject_ids:
            continue
        name = next(
            (n for n in person.get("names") or [] if n.get("preferred")),
            (person.get("names") or [{}])[0],
        )
        given = (name.get("given") or "").strip().lower()
        surname = (name.get("surname") or "").strip().lower()
        if given and surname and re.search(rf"\b{re.escape(given)}\b", text) and re.search(
            rf"\b{re.escape(surname)}\b", text
        ):
            pids.add(_pid_tail(ark))
    return pids


def _first_plan_write(calls: list[dict]) -> int | None:
    """Index of the first `research_append` that wrote `plans`/`plan_items`; a
    refused write (`ok: false`) wrote nothing, so it is not it."""
    return next(
        (
            i
            for i, c in enumerate(calls)
            if _bare(c.get("tool", "")) == "research_append"
            and isinstance(c.get("args"), dict)
            and (c.get("response") or {}).get("ok") is not False
            and any(
                op.get("section") in {"plans", "plan_items"}
                for op in _plan_write_ops(c["args"])
            )
        ),
        None,
    )


def test_research_plan_plans_subject_from_tree(before_state, tool_calls, test):
    """Tag-gated (``subject-from-tree``), tier 1. Issue #3384 step 3.

    `project_create` builds the starting tree from the subject's full
    FamilySearch read, so a question about a project subject is planned from the
    project tree: no `person_read` of that subject, at any point in the run, and
    no `person_read` of anyone else the question's text does not name. A tagged
    run with no plan write fails: it planned nothing."""
    if "subject-from-tree" not in test.get("tags", []):
        pytest.skip("not a subject-from-tree test")
    research = before_state.get("research_json")
    tree = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    if research is None or tree is None:
        pytest.skip("missing research.json or tree.gedcomx.json for before-state")
    subjects = _subject_pids(research, tree)
    assert subjects, "subject-from-tree scenario has no project subject with an `ark`"

    calls = [c for c in tool_calls or [] if isinstance(c, dict)]
    assert _first_plan_write(calls) is not None, "no research_append wrote plans or plan_items"
    named = _question_person_pids(research, tree, subjects="exclude")
    rereads = [
        (i, (c.get("args") or {}).get("personId"))
        for i, c in enumerate(calls)
        if _bare(c.get("tool", "")) == "person_read"
        and isinstance((c.get("args") or {}).get("personId"), str)
        and _pid_tail((c.get("args") or {}).get("personId")) not in named
    ]
    assert not rereads, (
        f"A project subject is planned from the project tree, never re-read, and no "
        f"other profile is read unless the question names that person: person_read "
        f"(index, personId)={rereads}."
    )


def test_research_plan_reads_question_person_profile(before_state, tool_calls, test):
    """Tag-gated (``profile-reread``), tier 1. Issue #2208, alpha report #3244.

    The project tree is a setup snapshot: a relative imported with the subject
    arrives without his own parents or attached sources. Before writing a plan,
    the skill must `person_read` the FamilySearch profile of the person the
    question is about. Graded on the call log, so narrating a check cannot pass.

    Every mock call lands in `tool_calls`, matched or not; `matched.kind` is
    what tells a fixture hit from a `fixture_not_found`. A read counts only if
    it matched and its `personId` is a question person's `ark` PID, and only if
    it comes before the first `research_append` writing `plans`/`plan_items`.
    A refused write (`ok: false`) wrote nothing, so it is not the first write.
    A tagged run with no plan write fails: it planned nothing."""
    if "profile-reread" not in test.get("tags", []):
        pytest.skip("not a profile-reread test")
    research = before_state.get("research_json")
    tree = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    if research is None or tree is None:
        pytest.skip("missing research.json or tree.gedcomx.json for before-state")
    wanted = _question_person_pids(research, tree, subjects="exclude")
    assert wanted, "profile-reread scenario names no non-subject tree person with an `ark` in an open question"

    calls = [c for c in tool_calls or [] if isinstance(c, dict)]
    first_write = _first_plan_write(calls)
    assert first_write is not None, "no research_append wrote plans or plan_items"

    reads = [
        (i, (c.get("args") or {}).get("personId"))
        for i, c in enumerate(calls)
        if _bare(c.get("tool", "")) == "person_read"
    ]
    good = [
        i
        for i, pid in reads
        if isinstance(pid, str)
        and _pid_tail(pid) in wanted
        and (calls[i].get("matched") or {}).get("kind") == "predicate"
    ]
    assert good and good[0] < first_write, (
        f"The plan must read the question person's FamilySearch profile "
        f"(personId in {sorted(wanted)}) before writing. person_read calls "
        f"(index, personId)={reads}; first plan write at index {first_write}."
    )


# --- V1: identifiers in a rationale must trace to a served response ---------

# person_read (issue #2208): the plan cites the attached-source ARKs a profile read
# returns. wiki_read (issue #2251): a fetched record-type page links collection ids
# (the Denmark_Military_Records fixture links collection/2243379). research_query
# (#2995): research-plan reads collection urls back through
# `research_query({section: "external_collections"})` instead of fetching. All are
# ids "a tool returned this session", so they are served, not invented.
_TRACEABLE_ID_TOOLS = {
    "collections_search",
    "volume_search",
    "external_links_search",
    "person_read",
    "wiki_read",
    "research_query",
}


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
    grounded = (
        _served_identifiers(tool_calls)
        | _grounded_identifiers(json.dumps(before))
        | _grounded_identifiers(
            str((before_state.get("files") or {}).get("external-collections.json") or "")
        )
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


# The tool's `collectionKey` (external-collections-store.ts): two spellings of
# one Ancestry collection (`/search/collections/7163/`, `?dbid=7163`) are one key.
_ANCESTRY_ID = re.compile(r"ancestry\.[a-z.]+/search/collections/(\d+)/?(?:[?#]|$)|[?&]dbid=(\d+)", re.I)
_MYHERITAGE_COLLECTION = re.compile(r"myheritage\.[a-z.]+/research/collection-\d+", re.I)


def _collection_key(url: str) -> str:
    m = _ANCESTRY_ID.search(url)
    if m and re.search(r"ancestry\.", url, re.I):
        return f"ancestry:{m.group(1) or m.group(2)}"
    if _MYHERITAGE_COLLECTION.search(url):
        return re.split(r"[?#]", url)[0]
    return url


def _stored_places(state) -> dict:
    raw = (state.get("files") or {}).get("external-collections.json")
    try:
        doc = json.loads(raw) if isinstance(raw, str) else None
    except ValueError:
        return {}
    places = doc.get("places") if isinstance(doc, dict) else None
    return places if isinstance(places, dict) else {}


def _stored_rows(state):
    for place, entry in _stored_places(state).items():
        for row in ((entry or {}).get("rows") or [] if isinstance(entry, dict) else []):
            if isinstance(row, dict) and isinstance(row.get("url"), str):
                yield place, row


def _stored_collection_keys(state) -> set[str]:
    return {_collection_key(row["url"]) for _place, row in _stored_rows(state)}


def _is_external(item) -> bool:
    return str(item.get("repository") or "").lower() not in ("", "familysearch")


def test_written_collection_urls_are_stored_collections(before_state, after_state):
    """Every `collection_url` a new plan writes names a collection in the
    project's `external-collections.json`, compared by the tool's collection key
    (lead ruling 2026-10-23). `research_append` refuses the rest; this pins that a
    run cannot end with one anyway."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    items = [i for p in _new_plans(before, after) for i in (p.get("items") or []) if isinstance(i, dict)]
    written = [i for i in items if i.get("collection_url")]
    if not written:
        pytest.skip("no new plan item carries collection_url")
    stored = _stored_collection_keys(after_state)
    bad = [
        f"{i.get('id')}: {i['collection_url']!r}"
        for i in written
        if _collection_key(str(i["collection_url"])) not in stored
    ]
    assert not bad, "collection_url is not a stored curated collection:\n  - " + "\n  - ".join(bad)


_PLACE_NOISE = re.compile(r"\b(county|parish|co\.|township|twp\.?|city of)\b", re.I)


def report_external_items_missing_a_stored_collection(before_state, after_state):
    """Tier 2 — counts, never gates (lead ruling 2026-10-23, #2995).

    Counts the new external-site plan items written with no `collection_url`
    although the stored list holds a collection that fits them: a stored place
    whose first part names a part of the item's jurisdiction, of the item's record
    type. The same loose match `research_append`'s warning uses; good enough to
    measure the miss rate, not to fail a run."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    rows = list(_stored_rows(after_state))
    if not rows:
        pytest.skip("nothing stored in external-collections.json")
    items = [i for p in _new_plans(before, after) for i in (p.get("items") or []) if isinstance(i, dict)]
    external = [i for i in items if _is_external(i)]
    if not external:
        pytest.skip("no new external-site plan item")
    missed = []
    for i in external:
        if i.get("collection_url"):
            continue
        parts = {x.strip().lower() for x in _PLACE_NOISE.sub(" ", str(i.get("jurisdiction") or "")).split(",") if x.strip()}
        rtype = str(i.get("record_type") or "").lower()
        if any(
            place.split(",")[0].strip().lower() in parts
            and (not rtype or not row.get("record_types") or rtype in [str(t).lower() for t in row["record_types"]])
            for place, row in rows
        ):
            missed.append(str(i.get("id")))
    assert not missed, (
        f"{len(missed)} of {len(external)} new external-site plan items have no collection_url "
        f"although a stored collection fits them: {missed}"
    )


# --- V5: an availability claim must match the returned personCount ----------

# "name-searchable" is SKILL.md's prescribed phrase for personCount > 0
# (issue #2251), so it is an indexed claim too; without it a mislabel written in
# the new phrasing would pass unseen.
_INDEXED_RE = re.compile(r"\b(?:(?:fully\s+)?indexed|name[\s-]searchable)\b", re.I)
# "no indexed name search is possible" and "not name-indexed" both negate the
# indexed claim.  Allow an optional adjective between "not" and "indexed"
# (e.g. "not name-indexed", "not record-indexed") and keep "no indexed" and
# the bare "un-?indexed" forms.
# ut_research_plan_002, v1_2026-09-24_19-25-44, pli_012: "no indexed name search"
# ut_research_plan_q7m, v1_2026-09-25_08-29-32, pli_003: "not name-indexed"
# "not fully indexed" is a PARTIAL-indexing claim (personCount > 0), not a
# browse-only claim — exclude it with a negative lookahead on "fully".
# An article may sit before the adjective: ut_research_plan_007,
# v3_2026-10-07_16-40-45, pli_014: "…returned personCount 0, confirming this is
# an image browse … not a name-indexed search" was charged with calling
# 1999196 "indexed" because the one optional word was spent on "a".
_UNINDEXED_RE = re.compile(
    r"\b(?:un-?indexed|not\s+(?:(?:a|an|the)\s+)?(?!fully\s)(?:\w+[\s-])?indexed"
    r"|not\s+(?:(?:a|an|the)\s+)?name[\s-]searchable|no\s+indexed)\b",
    re.I,
)
_BROWSE_ONLY_RE = re.compile(r"\b(?:browse|image)[\s-]?only\b", re.I)
# A browse/unindexed adjective sitting directly on a non-collection noun ("the
# browse-only volume (item 3)") describes that volume, not the one collection
# id the sentence names. ut_research_plan_016, v1_2026-09-01_17-38-18 (issue
# #2110): "Paid fallback if FamilySearch collection 1804888 (item 2) and the
# browse-only volume (item 3) both return nothing" charged "browse-only" to
# 1804888 (personCount 421870). The volume's own id is not in that sentence, so
# keying on a served volume id would not have caught it.
# "unindexed for this jurisdiction" similarly qualifies a sub-area volume, not
# the collection itself. ut_research_plan_015, v1_2026-09-25_09-24-00, pli_003:
# "collection 2513529 (…personCount 200K) is indexed at collection level, but
# …image group 004748896 …is entirely unindexed for this jurisdiction".
_ADJ_ON_NON_COLLECTION_RE = re.compile(
    r"\b(?:(?:browse|image)[\s-]?only|un-?indexed|not\s+indexed)\s+"
    r"(?:volumes?|films?|microfilms?|image\s+groups?|registers?|items?|"
    r"for\s+(?:this|the)\s+\w+)\b",
    re.I,
)
# An availability adjective describes the nearest identifier before it. When
# that is a volume, film or image group, it is not a claim about the one
# collection the sentence names. Two recorded false positives, both
# ut_research_plan_015: pli_009 on 2026-10-13, "Image group 004748896 (Thisted
# Amt military levy rolls, 1789-1814, browse-only (personCount 0)) provides the
# raw roll images if the name search in collection 2513529 (item 3) fails", and
# pli_008 on 2026-10-14, "If the probate index (pli_007, collection 2015318)
# does not return an entry …, browse volume 004392710, which covers Hassing
# Herred probate records 1690-1850 and is browse-only (personCount 0)".
_NON_COLLECTION_ID_RE = re.compile(
    r"\b(?:image\s+groups?|volumes?|films?|microfilms?|dgs)\s+(?:no\.?\s*)?\d{5,}",
    re.I,
)


def _claim_on_collection(pattern: re.Pattern, text: str, cid: str) -> bool:
    """True when some match of `pattern` in `text` binds to collection `cid`:
    the nearest identifier before it is `cid`, or there is none."""
    subjects = sorted(
        [(m.end(), False) for m in _NON_COLLECTION_ID_RE.finditer(text)]
        + [(m.end(), True) for m in re.finditer(rf"(?<!\d){re.escape(cid)}(?!\d)", text)]
    )
    for m in pattern.finditer(text):
        before = [is_collection for end, is_collection in subjects if end <= m.start()]
        if not before or before[-1]:
            return True
    return False
# A coverage percentage ("412 images, 0% indexed", "only 4% name-indexed") is
# neither an indexed nor a browse-only claim. ut_research_plan_007 run 0 on
# 2026-09-24 (issue #2685) wrote "…returned personCount 0, so this is a browse
# of image group 007936749 (…, 0% indexed)" and was charged with calling
# 1999196 "indexed".
_PERCENT_INDEXED_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s*%\s*(?:name[\s-]?)?(?:indexed|record[\s-]searchable)\b", re.I
)


def _collection_person_counts(tool_calls) -> dict[str, set[int]]:
    """id -> set of personCounts across every collections_search response
    this run received. An id can be served with different counts in
    different responses (1999196 was once 0 in schuylkill and 893214 in
    pennsylvania, reconciled 2026-09-24 under issue #2685), so key on the
    response, not the id."""
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
    one whose personCount is 0. Issue #1866 V5, e.g. ut_research_plan_010
    pli_007 (v1_2026-09-17_15-04-52) calls 1999196 "indexed" against a served
    personCount of 0.

    Bind the adjective to the identifier within one sentence and skip any
    sentence naming more than one served collection — a rationale routinely
    describes a browse-only volume and an indexed collection in one breath.
    A browse/unindexed adjective attached to a non-collection noun ("the
    browse-only volume") is not a claim about the collection and is ignored,
    and neither is a coverage percentage ("0% indexed").
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
                claim_text = _PERCENT_INDEXED_RE.sub(" ", sentence)
                claims_indexed = _claim_on_collection(
                    _INDEXED_RE, claim_text, cid
                ) and not _claim_on_collection(_UNINDEXED_RE, claim_text, cid)
                about_collection = _ADJ_ON_NON_COLLECTION_RE.sub(" ", claim_text)
                claims_browse = _claim_on_collection(
                    _BROWSE_ONLY_RE, about_collection, cid
                ) or _claim_on_collection(_UNINDEXED_RE, about_collection, cid)
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


# --- Tag-gated: already-attached FAN-cluster facts must reach the response ---


def _word_grams(text: str, n: int) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {" ".join(words[i : i + n]) for i in range(len(words) - n + 1)}


def _survey_noise_grams(research: dict, tree: dict) -> set[str]:
    """Two-word grams a response can produce without reading any source: the
    questions' own wording, every place a fact names, and every person name."""
    text = [q.get("question") or "" for q in research.get("questions") or []]
    for person in tree.get("persons") or []:
        text += [f.get("place") or "" for f in person.get("facts") or []]
        text += [f"{n.get('given') or ''} {n.get('surname') or ''}" for n in person.get("names") or []]
    return _word_grams(" ".join(text), 2)


def _person_source_grams(person: dict, tree: dict, noise: set[str]) -> set[str]:
    """Distinctive two-word grams from the title and citation of every source
    the person's own `sources` refs resolve to (noise removed)."""
    by_id = {s.get("id"): s for s in tree.get("sources") or [] if isinstance(s, dict)}
    grams: set[str] = set()
    for ref in person.get("sources") or []:
        src = by_id.get(ref.get("ref")) if isinstance(ref, dict) else None
        if src:
            grams |= _word_grams(f"{src.get('title') or ''} {src.get('citation') or ''}", 2)
    return grams - noise


def report_survey_surfaces_already_attached_fan_facts(before_state, text_response, test, agent_returns=None):
    """Tag-gated (issue #1948), tier 2 -- reporting only, per ADR-0011 /
    `unit-test-spec.md`: the harness can detect whether a non-subject
    person's already-sourced fact was surfaced, but not decide whether the
    response's reasoning about it is sound, so a miss here is an observation
    fed to the judge (Correctness/Completeness), not an independent gate on
    the run's outcome.

    Started as tier 1 and was moved during PR #2004 review (clack391): a
    tier-1 gate on this behavior means a coin-flip miss makes ordinary model
    variance loud rather than regressions loud (EdmondOware, round 1), and
    -- separately and more importantly -- the predicate can be satisfied by
    a response that read nothing (see the false-positive shapes below),
    which a tier-1 pass would have hidden from the judge entirely
    (only a tier-2 finding is fed to the judge as an observation).

    Live alpha-feedback report: a first plan for a "why did the family move"
    question never surfaced a sibling's already-sourced 1875 land purchase in
    the destination county, seven years before the subject's own documented
    arrival. Three SKILL.md wording attempts (see the mined test
    `ut_research_plan_bpx`) moved the failure rate from "every sample" to
    roughly half -- expected, since the skill runs without `temperature=0`,
    so no wording can pin any behavior at exactly 100%. The 5 committed runs
    of `ut_research_plan_bpx` against the final wording
    (`v1_2026-08-28_06-14-42`, `_10-59-10`, `v1_2026-08-30_04-40-39`,
    `_16-05-12`, `v1_2026-08-31_10-37-11`) give 3 pass / 2 fail -- roughly
    the same "about half" rate, though five runs is too few to pin the exact
    fraction. Now that this check is tier 2, that rate no longer independently
    decides the test's outcome (the judge does), which is what makes the
    rate a curiosity rather than a marking decision.

    Deliberately gated on the `already-attached` tag rather than running on
    every research-plan test. Measured against the corpus at review time
    (clack391): of the research-plan tests then in the suite, only this
    PR's own fixture had a non-subject person with a checkable sourced
    fact, so gating false-positives on nothing today -- but a future
    scenario could add one incidentally, and this check has no way to know
    whether surfacing it was that test's point.

    The tag gate carries more weight since issue #2208 widened the checked
    population from source-ref'd facts to all recorded facts, and to a
    relative's person-level sources: on an imported tree that is nearly every
    relative. Both tagged scenarios are hand-authored with a single
    checkable non-subject person, so nothing over-fires today -- but do NOT
    apply the `already-attached` tag to an imported tree without re-scoping
    this check, or it will demand a date-and-value for every relative and fire
    on every honest response. Note also that `surfaced` is satisfied by ANY of
    the person's facts, so widening the fact set made the per-person bar
    easier, not harder.

    A person with person-level `sources` is checked on those instead: the
    response must name them and carry a distinctive two-word gram from a
    source's title or citation (question wording, fact places and person names
    removed), because a name and a year can be written without reading it.

    Check: for each non-subject person with a fact the tree records --
    sourced or not (issue #2208; see the inline note at the loop) -- require
    somewhere in the response (case-insensitive) -- their given name
    (word-boundary match, not a bare substring test: "Ann" must not match
    inside "planning") AND the fact's *content*: a date token (`date`,
    `standard_date`, or a bare year extracted from either, so `~1845`,
    `1908-03-12` and "Abt 1850" are all recognized, not just a literal bare
    year) AND, when the fact carries a `value`, at least one two-word gram
    from that value. A fact with no `value` degrades to name+date; a fact
    with no date at all degrades to name+value -- either signal alone still
    gates on *some* fact-specific content, never on the name alone. A fact
    with neither a date nor a value has nothing fact-specific to check
    against and is out of scope, the same as a person with no facts
    at all (there is no content to confirm was read, so nothing is asked of
    the response) -- this closes a real false negative found during review
    (clack391): `date` is optional in the schema, so a sourced fact that
    only carries a place, say, previously failed unconditionally regardless
    of what the response said.

    This design replaced an earlier name+date-only check found to have two
    real gaps during PR #2004's review (clack391): (1) matching `date`
    verbatim missed every non-bare-year format -- of 113 sourced facts with
    a date across the scenario corpus, only 9 are bare years; 53 are
    `~yyyy`, 47 are ISO `yyyy-mm-dd`, the rest free text -- so `"~1845" in
    "...about 1845..."` was false and the check failed a correct response.
    (2) A committed run (`v1_2026-08-27_16-18-15.json`, since pruned by
    retention -- see the review thread for its recorded text) exposed the
    deeper problem the value-gram requirement exists for: its response
    mentions Patrick seven times and a FAN plan item's own search-window
    header happens to read "Schuylkill County, PA -- 1875-1905", satisfying
    a bare name+date check, while the response's own text is entirely
    conditional ("if Patrick preceded Michael...") and proposes searching to
    *discover* what the tree already states. Name and date co-occurrence
    cannot tell "citing a known fact" apart from "proposing a new search
    that happens to start near the same year"; a content fragment from the
    fact's own `value` can.

    Checked against the WHOLE response, not scoped to one paragraph. An
    earlier version required the name and the content signals to land in
    the same blank-line-delimited paragraph, on the theory that a stray
    date elsewhere in the response shouldn't count. Review (clack391) found
    this scoping was itself a false-positive hole, not a precision gain: a
    response naming nobody can still pass if a date token and a value gram
    both happen to appear anywhere near the person's name by coincidence of
    the fixture's own wording (measured directly against this fixture's own
    plan-item search window), and restricting to same-paragraph did nothing
    to prevent it while failing at least one honestly-correct response
    whose citation sits in its own paragraph, separate from the name. Since
    this is now tier 2, the judge is the backstop for "did the response
    actually reason about this fact" regardless of scope; the mechanical
    check's job is only to flag whether the content appears at all.

    Does not grade whether the response's *reasoning* about the fact is
    sound once it clears this bar -- that is exactly what moving this to
    tier 2 hands to the judge (Completeness/Correctness already grade
    reasoning quality on this test).
    """
    if "already-attached" not in test.get("tags", []):
        pytest.skip("not an already-attached-fan-facts scenario")
    research = before_state.get("research_json")
    tree = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    if research is None or tree is None:
        pytest.skip("missing research.json or tree.gedcomx.json for before-state")
    # On the direct arm `text_response` is the dispatcher relaying the agent's
    # return, possibly paraphrased; grade the agent's own words (issue #2116).
    from harness.skill_runner import subject_reply_text

    reply = subject_reply_text(agent_returns, text_response, test.get("skill") or "research-plan", test)
    if not reply:
        pytest.skip("no reply captured")

    subject_ids = set(research.get("project", {}).get("subject_person_ids") or [])
    response_lower = reply.lower()
    paragraphs = [response_lower]
    noise = _survey_noise_grams(research, tree)

    missed: list[str] = []
    for person in tree.get("persons", []) or []:
        pid = person.get("id")
        if not pid or pid in subject_ids:
            continue
        given = (person.get("names") or [{}])[0].get("given", "")
        if not given:
            continue
        # EVERY fact the tree records, not only the source-ref'd ones (issue #2208): a
        # fact's ref is no evidence the person was surveyed, and trees authored before
        # project_create built from person_read (#3140) carry no refs at all.
        recorded_facts = list(person.get("facts") or [])
        # A relative's own attachments live at the person level (#3066), referenced
        # from `persons[].sources`, not from a fact. When there are any, their content
        # -- not a name and a year -- is what shows the survey read them.
        source_grams = _person_source_grams(person, tree, noise)
        if not recorded_facts and not source_grams:
            continue  # nothing recorded for this person -- not in scope for this check

        name_pattern = rf"\b{re.escape(given.lower())}\b"
        name_present = bool(re.search(name_pattern, response_lower))

        surfaced = False
        any_checkable = bool(source_grams)
        if source_grams:
            recorded_facts = []
            surfaced = name_present and bool(source_grams & _word_grams(response_lower, 2))
        for fact in recorded_facts:
            date_tokens = {
                t.lower() for t in (fact.get("date"), fact.get("standard_date")) if t
            }
            date_tokens |= {
                y
                for y in (extract_year(fact.get("date")), extract_year(fact.get("standard_date")))
                if y
            }
            value_grams = _word_grams(fact["value"], 2) if fact.get("value") else set()
            if not date_tokens and not value_grams:
                continue  # nothing fact-specific to check for this one
            any_checkable = True

            for para in paragraphs:
                if not re.search(name_pattern, para):
                    continue
                date_ok = not date_tokens or any(
                    re.search(rf"\b{re.escape(tok)}\b", para) for tok in date_tokens
                )
                value_ok = not value_grams or bool(value_grams & _word_grams(para, 2))
                if date_ok and value_ok:
                    surfaced = True
                    break
            if surfaced:
                break

        if not any_checkable:
            continue  # no recorded fact on this person has a date or value -- nothing to check

        if surfaced:
            continue

        if not name_present:
            reason = "the person's given name never appears in the response"
        else:
            reason = (
                "the person's given name appears, but no recorded fact's date and value "
                "content (whichever the fact carries) both also appear in the response"
            )
        missed.append(f"{pid} ({given}): the tree records a fact for them but {reason}")
    assert not missed, (
        "already-recorded FAN-cluster fact(s) never surfaced in the "
        "response:\n  - " + "\n  - ".join(missed)
    )


_PURCHASE = re.compile(r"purchas|bought|deed book 42", re.IGNORECASE)
_PURCHASE_TAG = "sibling-purchase-stated"


def test_research_plan_states_sibling_purchase(
    before_state, after_state, text_response, test, agent_returns=None
):
    """Tag-gated (`sibling-purchase-stated`, issue #3957): the only grader of
    whether the two Sheahan FAN tests state Patrick's 1875 deed. Their
    `judge_context` tells the judge not to grade it: given a pass anchor, the
    judge still scored 2 on replies that met it, for where or in what words
    the deed was stated. This fails the run when no paragraph of the agent's
    own reply, and no new plan item's rationale, carries "Patrick" together
    with a purchase, a purchase verb or Deed Book 42. A
    reply giving his 1875 residence, date or place alone is the shape it
    rejects: replayed over every committed run of both tests, it fails seven
    `bpx` runs from v1 to v7, all partial, and passes every run graded pass.

    Unlike `report_survey_surfaces_already_attached_fan_facts`, it checks one
    fixed fact of two fixed scenarios. A reply that mentions a purchase
    without having read the deed passes it; the judge is not asked to catch
    that, and the trade is a criterion graded the same way on every run."""
    if _PURCHASE_TAG not in test.get("tags", []):
        pytest.skip("not a sibling-purchase-stated scenario")
    from harness.skill_runner import subject_reply_text

    reply = subject_reply_text(agent_returns, text_response, test.get("skill") or "research-plan", test)
    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    old_ids = {i.get("id") for p in before.get("plans") or [] for i in p.get("items") or []}
    rationales = [
        i.get("rationale") or ""
        for p in after.get("plans") or []
        for i in p.get("items") or []
        if i.get("id") not in old_ids
    ]
    chunks = re.split(r"\n\s*\n", reply) + rationales
    stated = [c for c in chunks if re.search(r"\bPatrick\b", c) and _PURCHASE.search(c)]
    assert stated, (
        "Patrick's already-attached 1875 deed is never stated: no paragraph of the "
        "reply, and no new plan item's rationale, names Patrick together with a "
        "purchase, a purchase verb or Deed Book 42."
    )


# --- Step 3 pre-work: the subject-triggered wiki pages are actually fetched --

# Maps a `wiki-prework` test to the wiki_read fixture stems its subject
# triggers (SKILL.md Step 3 pre-work; issue #2251, lead ruling 2026-09-27).
# Hardcoded rather than read from the spec: the `test` fixture carries only the
# inner "test" block, not top-level `mcp_fixtures` (validator_runner.py) --
# the same reason test_search_full_text.py keeps _TOPICAL_FIXTURES_BY_TEST_ID.
# Add an entry whenever "wiki-prework" is added to a research-plan test.
_WIKI_FIXTURES_BY_TEST_ID = {
    "ut_research_plan_015": (
        "wiki-read-denmark-military-records",
        "wiki-read-denmark-naming-customs",
    ),
    "ut_research_plan_dth": ("wiki-read-sweden-naming-customs",),
    "ut_research_plan_csn": ("wiki-read-spain-naming-customs",),
}


def test_wiki_prework_fetches_triggered_pages(tool_calls, test):
    """A `wiki-prework` test must fetch every record-type page its subject
    triggers, and land on the page, not beside it.

    ADR-0012, "Name the fetch so it runs": `gps-mentor` named the wiki tools at
    five sites and made zero calls in 91 invocations, so prose that names a
    call is not a call. Matching on the served fixture stem rather than on
    "some wiki_read happened" is what makes a guessed slug fail: a 404 slug
    (`Denmark_Military_Record`, `Spain_Names,_Personal`) misses the page's
    predicate and is served no fixture, and a sibling tool (`wiki_search`)
    never serves a wiki_read stem at all.

    Asserts only that the page was READ. Whether its content reached the plan
    is the judge's, per each test's judge_context.
    """
    tags = test.get("tags") or []
    test_id = test.get("id")
    # Map -> tag direction BEFORE the skip, or the skip swallows it: dropping
    # the tag from a spec would silently disarm this guard.
    assert test_id not in _WIKI_FIXTURES_BY_TEST_ID or "wiki-prework" in tags, (
        f"{test_id} has a _WIKI_FIXTURES_BY_TEST_ID entry but no 'wiki-prework' "
        "tag - restore the tag or delete the entry"
    )
    if "wiki-prework" not in tags:
        pytest.skip("not a wiki-prework test")
    expected = _WIKI_FIXTURES_BY_TEST_ID.get(test_id)
    assert expected, (
        f"{test_id} carries 'wiki-prework' but has no entry in "
        "_WIKI_FIXTURES_BY_TEST_ID - add the wiki_read stems its subject triggers"
    )
    hit = {
        c.get("response_fixture")
        for c in (tool_calls or [])
        if _bare(c.get("tool", "")) == "wiki_read" and c.get("response_fixture")
    }
    missing = [stem for stem in expected if stem not in hit]
    assert not missing, (
        f"{test_id}: SKILL.md Step 3 pre-work requires {list(expected)}, and "
        f"{missing} was never served -- the page was not fetched, or was "
        f"fetched under a slug its predicate does not match. wiki_read "
        f"fixtures served: {sorted(hit) or '(none)'}"
    )


# --- Pre-register birth: the plan works back from the subject's death --------

# test id -> (subject's given name, earliest start year a death or burial item
# may carry). The bound sits after the subject's birth window, which is what
# separates a search for her own death entry from a baptism-window search whose
# rationale merely mentions a death. Elena: born c. 1680-1692 per q_001, married
# 1712, alive 1718; a burial search starting 1712 or 1718 passes, one starting
# 1675 does not.
_DEATH_ROUTE_BY_TEST_ID = {
    "ut_research_plan_dth": ("Elena", 1700),
}

_DEATH_WORD = r"(?:death|died|burial|buried|bur\.|d[öo]d|d[öo]de|begrav\w*|begraf\w*)"
_YEAR_RE = re.compile(r"\b(1[5-9]\d\d)\b")


_RELATIVE = r"(?:(?:grand|step)?(?:son|daughter|child|children|father|mother|parents?)|husband|brother|sister|wife|spouse)"
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-ZÅÄÖ])")


def _death_route_res(given: str) -> tuple[re.Pattern, re.Pattern]:
    """(own, relative): `own` ties the entry to the subject ("Elena's burial",
    "burials index for Elena", "her age at death", "Elena's entry");
    `relative` names a relative of hers ("Elena's son", "her husband")."""
    g = re.escape(given)
    own = re.compile(
        rf"\b{g}(?:\s+\w+)?['’]s\s+(?:own\s+)?(?:{_DEATH_WORD}|entry)"
        rf"|\b{_DEATH_WORD}\w*(?:\s+[\w-]+){{0,2}}\s+(?:of|for)\s+{g}\b(?!['’]s)"
        rf"|(?<!\bof\s)\b{g}(?:\s+\w+)?,?\s+(?:was\s+)?(?:buried|died)\b"
        rf"|\bher\s+(?:own\s+)?(?:age\s+at\s+)?{_DEATH_WORD}",
        re.IGNORECASE,
    )
    relative = re.compile(
        rf"(?:\b{g}['’]s|\bher)\s+{_RELATIVE}\b|\b{_RELATIVE}\s+of\s+{g}\b",
        re.IGNORECASE,
    )
    return own, relative


def test_pre_register_birth_plans_death_route(before_state, after_state, test):
    """When the birth predates the register, the plan must carry the
    subject's OWN death or burial entry as its own item, and must not be one
    record type throughout.

    The e2e evidence (issue #2676, merged into #2251): on
    elena-asmundsdotter-origin run-2026-09-18_21-35-53 the one active plan held
    ten items, all `record_type: "church"`, with no death or burial item, so the
    agent never opened the register section where her 1745 death entry states
    her birthplace. Both defects are asserted here.

    An item counts only when its rationale or jurisdiction names the subject
    and a death/burial word, and its `date_range` starts after the subject's
    birth window. When every sentence carrying a death word also names a
    relative of hers ("Elena's son", "her husband"), the item counts only if
    it ties the entry to her elsewhere ("Elena's burial", "her age at death"),
    so a son's, husband's or father's burial fails, as does a baptism search
    whose rationale notes she later died.
    """
    tags = test.get("tags") or []
    test_id = test.get("id")
    assert test_id not in _DEATH_ROUTE_BY_TEST_ID or "pre-register-birth" in tags, (
        f"{test_id} has a _DEATH_ROUTE_BY_TEST_ID entry but no "
        "'pre-register-birth' tag - restore the tag or delete the entry"
    )
    if "pre-register-birth" not in tags:
        pytest.skip("not a pre-register-birth test")
    spec = _DEATH_ROUTE_BY_TEST_ID.get(test_id)
    assert spec, (
        f"{test_id} carries 'pre-register-birth' but has no entry in "
        "_DEATH_ROUTE_BY_TEST_ID"
    )
    given, earliest_start = spec
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    items = [i for p in _new_plans(before, after) for i in (p.get("items") or [])]
    assert items, "no new plan items were written"

    own, relative = _death_route_res(given)

    def _qualifies(item: dict) -> bool:
        text = f"{item.get('rationale') or ''} {item.get('jurisdiction') or ''}"
        if given.lower() not in text.lower() or not re.search(_DEATH_WORD, text, re.IGNORECASE):
            return False
        death_sentences = [
            s for s in _SENTENCE_SPLIT_RE.split(text)
            if re.search(_DEATH_WORD, s, re.IGNORECASE)
        ]
        if all(relative.search(s) for s in death_sentences) and not own.search(text):
            return False
        years = [int(y) for y in _YEAR_RE.findall(str(item.get("date_range") or ""))]
        return bool(years) and min(years) >= earliest_start

    problems: list[str] = []
    if not any(_qualifies(i) for i in items):
        problems.append(
            f"no item targets {given}'s own death or burial entry dated from "
            f"{earliest_start} on (items: "
            + "; ".join(
                f"{i.get('id')} {i.get('record_type')} {i.get('date_range')}"
                for i in items
            )
            + ")"
        )
    types = {i.get("record_type") for i in items}
    if len(types) < 2:
        problems.append(f"every item shares one record_type: {sorted(map(str, types))}")
    assert not problems, (
        "pre-register birth planned as if a baptism could be found:\n  - "
        + "\n  - ".join(problems)
    )
