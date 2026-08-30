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

import re

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


# --- Tag-gated: already-attached FAN-cluster facts must reach the response ---

_YEAR_RE = re.compile(r"\b(1[0-9]{3}|20[0-4][0-9])\b")


def _extract_year(date_str: str | None) -> str | None:
    """Pull a 4-digit year out of any date representation -- a bare year,
    `~yyyy`, ISO `yyyy-mm-dd`/`yyyy-mm`, or a `standard_date` sidecar like
    "Abt 1850". None when no such pattern is found."""
    if not date_str:
        return None
    m = _YEAR_RE.search(date_str)
    return m.group(1) if m else None


def _word_grams(text: str, n: int) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {" ".join(words[i : i + n]) for i in range(len(words) - n + 1)}


def test_survey_surfaces_already_attached_fan_facts(before_state, text_response, test):
    """Tag-gated (issue #1948): when a non-subject person already has a
    sourced fact in `tree.gedcomx.json`, the response must actually mention
    it -- not just plan around it silently.

    Live alpha-feedback report: a first plan for a "why did the family move"
    question never surfaced a sibling's already-sourced 1875 land purchase in
    the destination county, seven years before the subject's own documented
    arrival. Three SKILL.md wording attempts (see the mined test
    `ut_research_plan_bpx`) moved the failure rate from "every sample" to
    roughly half -- expected, since the skill runs without `temperature=0`,
    so no wording can pin any behavior at exactly 100%. Measured directly
    (PR #2004 review, EdmondOware): 6 valid re-runs of `ut_research_plan_bpx`
    against the final wording (2 more runs were discarded as environment
    aborts -- a connection failure and an `sdk_stream_silence` stall, neither
    a skill behavior) came back 3 pass / 3 fail, exactly 50%. Not marked
    `expected_outcome: xfail` despite that rate: xfail's semantics are
    "known-failing", and a clean 50/50 split doesn't fit it -- half of
    future runs would come back as an unexpected `xpass` needing
    investigation just as often as an `xfail` would need dismissing.
    Instead: a solo red result on this test is expected roughly half the
    time and should be checked against this measured rate before being
    treated as a regression, the same way `eval/CLAUDE.md` already asks for
    any test's non-pass history across committed run logs.

    Deliberately gated on the `already-attached` tag rather than running on
    every research-plan test: several existing scenarios (e.g. `fixtures`)
    have non-subject persons with sourced facts that are incidental to their
    test's actual point, and checking every one of those for content the test
    was never designed to require would be a false-positive trap, not a
    guard.

    Check: for each non-subject person with a sourced fact, require in the
    SAME paragraph of the response (case-insensitive) -- their given name
    (word-boundary match, not a bare substring test: "Ann" must not match
    inside "planning") AND the fact's *content*: a date token (`date`,
    `standard_date`, or a bare year extracted from either, so `~1845`,
    `1908-03-12` and "Abt 1850" are all recognized, not just a literal bare
    year) AND, when the fact carries a `value`, at least one two-word gram
    from that value. A fact with no `value` degrades to name+date; a fact
    with no date at all degrades to name+value -- either signal alone still
    gates on *some* fact-specific content, never on the name alone. A fact
    with neither a date nor a value has nothing fact-specific to check
    against and is out of scope, the same as a person with no sourced facts
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
    (2) A committed run (`v1_2026-08-27_16-18-15.json`) exposed the deeper
    problem the value-gram requirement exists for: its response mentions
    Patrick seven times and a FAN plan item's own search-window header
    happens to read "Schuylkill County, PA -- 1875-1905" -- the *same*
    paragraph as his name, satisfying a bare name+date check, while the
    response's own text is entirely conditional ("if Patrick preceded
    Michael...") and proposes searching to *discover* what the tree already
    states. Name and date proximity cannot tell "citing a known fact" apart
    from "proposing a new search that happens to start near the same year";
    a content fragment from the fact's own `value` can. Paragraphs are
    split on blank lines (`\\n\\s*\\n`) rather than sentences to avoid a
    naive sentence-split's false negative on a period inside a citation
    ("S1, Deed Book 42 p. 118").

    Does not grade whether the response's *reasoning* about the fact is
    sound once it clears this bar -- that stays the judge's job
    (Completeness/Correctness already grade reasoning quality on this test).
    """
    if "already-attached" not in test.get("tags", []):
        pytest.skip("not an already-attached-fan-facts scenario")
    research = before_state.get("research_json")
    tree = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    if research is None or tree is None:
        pytest.skip("missing research.json or tree.gedcomx.json for before-state")
    if not text_response:
        pytest.skip("no text_response captured")

    subject_ids = set(research.get("project", {}).get("subject_person_ids") or [])
    response_lower = text_response.lower()
    paragraphs = re.split(r"\n\s*\n", response_lower)

    missed: list[str] = []
    for person in tree.get("persons", []) or []:
        pid = person.get("id")
        if not pid or pid in subject_ids:
            continue
        given = (person.get("names") or [{}])[0].get("given", "")
        if not given:
            continue
        sourced_facts = [f for f in (person.get("facts") or []) if f.get("sources")]
        if not sourced_facts:
            continue  # nothing already attached for this person -- not in scope for this check

        name_pattern = rf"\b{re.escape(given.lower())}\b"
        name_present = bool(re.search(name_pattern, response_lower))

        surfaced = False
        any_checkable = False
        for fact in sourced_facts:
            date_tokens = {
                t.lower() for t in (fact.get("date"), fact.get("standard_date")) if t
            }
            date_tokens |= {
                y
                for y in (_extract_year(fact.get("date")), _extract_year(fact.get("standard_date")))
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
            continue  # no sourced fact on this person has a date or value -- nothing to check

        if surfaced:
            continue

        if not name_present:
            reason = "the person's given name never appears in the response"
        else:
            reason = (
                "the person's given name appears, but no sourced fact's distinguishing "
                "content (date or description) appears alongside it in the same paragraph"
            )
        missed.append(f"{pid} ({given}): has a sourced fact but {reason}")
    assert not missed, (
        "already-attached FAN-cluster fact(s) never surfaced in the "
        "response:\n  - " + "\n  - ".join(missed)
    )
