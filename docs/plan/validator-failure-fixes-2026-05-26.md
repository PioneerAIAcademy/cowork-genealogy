# Validator-failure fixes — 2026-05-26

Execution plan for the 11 tests across 8 skills that currently fail
deterministic validators in their v1 candidate runlogs. The judge is
skipped when validators fail, so these tests show 0/0 dimensions in
`eval/app` and cannot be human-graded until the underlying issues are
fixed and the harness is re-run.

Companion to `runlog-triage-2026-05-24.md`, which was the
deferred-work backlog. This document converts that backlog into
ordered work with concrete edits and acceptance criteria, and adds
two refinements the prior doc didn't have (see "Refinements" below).

## The 11 failing tests

| # | Skill | Test | Validator | Root cause | Fix location |
|---|---|---|---|---|---|
| 1 | assertion-classification | ut_001 | `test_a001_preserves_classification` | Skill misread subject-identification as indirect | SKILL.md |
| 2 | conflict-resolution | ut_002 | `test_resolved_conflicts_have_required_fields` | Skill resolved both conflicts in one turn; c_002 left without `preferred_assertion_id` | SKILL.md |
| 3 | person-evidence | ut_013 | `test_low_score_variant_still_links` | Low score vetoed a strong qualitative match | SKILL.md |
| 4 | question-selection | ut_002 | `test_first_question_depends_on_empty` + 2 others | Routed to `project-status`, not `question-selection` | test prompt or SKILL.md descriptions |
| 5 | question-selection | ut_003 | `test_selection_basis_unresolved_conflict` | Same routing failure | same |
| 6 | research-plan | ut_001 | `test_research_plan_no_new_plan` | Skill created a new plan when review-only was expected | SKILL.md + maybe test prompt |
| 7 | research-plan | ut_002 | `test_research_plan_new_plan_for_q_001` | Skill added a new plan AND mutated `pl_002` | SKILL.md |
| 8 | search-external-sites | ut_002 | `test_log_site_myheritage`, `test_positive_appends_external_site_log_entry` | Skill generated URL in prose but never appended the log entry | SKILL.md |
| 9 | search-records | ut_001 | `test_log_outcome_positive_record_search`, `test_positive_appends_log_entry` | Scenario already has 3 prior `record_search` logs on `pli_001`; skill correctly decided not to redo | scenario fixture or test prompt |
| 10 | search-records | ut_010 | `test_log_append_only` | Skill inserted new log entry mid-array, shifting `log_004`'s index | SKILL.md |
| 11 | timeline | ut_002 | `test_no_impossibilities_when_resolved` | Skill put identity-conflict text into `timeline.impossibilities` (which is chronological-only) | SKILL.md |

## Categorized by fix type

### A. SKILL.md content fixes (7 tests, 6 skills)

The skill activated, validators caught a specific behavioral miss.
Fix in `packages/engine/plugin/skills/<skill>/SKILL.md`.

1. **assertion-classification** — Add a rule and worked example:
   *"When the assertion's value identifies the subject within the
   record (e.g. the name assertion for the record's subject), and the
   assertion was extracted **for** a question that asks where/when the
   subject was, the evidence is **direct** — even if the assertion's
   `place` is null. The location lives on a sibling assertion (e.g.
   `residence`), but the name assertion is what anchors the subject
   in the source. Changing such name assertions to `indirect` is a
   common mistake."*

2. **conflict-resolution** — Two rules:
   - *"Resolve **one** conflict per turn. If multiple conflicts are
     unresolved, pick the most foundational and update only its
     analysis fields, leaving siblings untouched."*
   - *"A conflict's status transitions to `resolved` **only when
     `preferred_assertion_id` is set** along with
     `resolution_rationale`, `weighing_analysis`, and
     `independence_analysis`. Otherwise leave status as
     `unresolved`."*

3. **person-evidence** — Override rule:
   *"`match_two_examples` score is **input**, not a veto. When the
   non-name identifiers (age, year, place, household members) all
   corroborate the match, create the `person_evidence` link even
   if the score is low. Cite the transcription-variant explanation
   in `rationale`."*

4. **research-plan** (covers ut_001 + ut_002) — Decision tree:
   - *"Read every active (`in_progress` or `planned`) plan for the
     target question before doing anything else."*
   - *"If an active plan covers the next logical step, **review
     only** — do not create a new plan, do not mutate existing
     items, just narrate the next step."*
   - *"If the active plan is `completed` but the question is not yet
     `proved`, **add a new plan** with new `pli_*` items. Do not
     mutate the completed plan."*

5. **search-external-sites** — Required write step:
   *"Every URL-generation turn ends with a `tool: external_site`
   log entry appended to `research.json#log[]`, containing
   `external_site.site` (e.g. `myheritage`),
   `external_site.url_generated`, and
   `external_site.capture_received: false`. The URL is not the
   deliverable — the log entry is."*

6. **search-records** ut_010 — Insertion rule:
   *"Append new log entries to the **end** of `log[]`. Never
   re-sort, insert mid-array, or mutate existing entries. The
   array's order is the audit trail."*

7. **timeline** — Section boundary:
   *"`impossibilities[]` is for **chronological contradictions**
   only — events that cannot coexist in time (e.g. an event before
   the person's birth, two locations on the same day). Identity
   uncertainty, source disagreement, and informant conflicts are
   already captured in `conflicts[]` and must not be duplicated
   here. If the underlying conflict is unresolved, **omit the
   affected events from the timeline** (or annotate them in the
   timeline's `notes`); do not add an impossibility."*

### B. Test / scenario fixes (2 tests)

The skill behaved reasonably; the test or fixture is the problem.

8. **question-selection** ut_002, ut_003 — Routing failure. Both
   prompts route to `project-status` ("Where should I start?" /
   "What should I research next given the current state?"). Two
   options:
   - **Preferred:** rewrite the user_message to be unambiguously
     question-selection: `"Pick the next research question for me
     to work on."` Less natural but disambiguates from status.
   - Alternative: sharpen `question-selection`'s SKILL.md
     `description` to claim "what to research next / pick the next
     question" phrasing, and verify `project-status`'s description
     doesn't claim the same.

9. **search-records** ut_001 — Scenario has 3 prior `record_search`
   log entries on `pli_001` (all `outcome: positive`). The skill
   correctly decided not to redo work. Two options:
   - **Preferred:** edit
     `eval/fixtures/scenarios/flynn-record-matching/research.json`
     to remove `log_001`, `log_002`, `log_003` (or move them to a
     different plan item). The scenario was probably copied from a
     more-progressed state without trimming for this test.
     **Caveat:** this scenario is also used by ut_010 and
     ut_013 — verify the removal doesn't break them. If it does,
     fork the scenario.
   - Alternative: tighten the test prompt to say *"Re-execute the
     1850 census search — the prior log entries are inconclusive."*

## Execution order

Group by skill so each skill's harness re-run picks up all its
fixes in one shot:

1. **research-plan** (#6, #7) — single SKILL.md edit covers both.
2. **search-records** (#9, #10) — scenario edit + SKILL.md edit.
   Run after research-plan because the scenario edit may interact.
3. **conflict-resolution** (#2) — SKILL.md only.
4. **search-external-sites** (#8) — SKILL.md only.
5. **person-evidence** (#3) — SKILL.md only.
6. **timeline** (#11) — SKILL.md only.
7. **assertion-classification** (#1) — SKILL.md only.
8. **question-selection** (#4, #5) — last because routing changes
   may affect multiple skills' description fields.

For each skill: edit SKILL.md / fixture / test, then re-run with
`uv run python run_tests.py --skill <name>` from `eval/harness/`.
Annotate the new candidate runlog in `eval/app`, then proceed to the
next skill.

## Acceptance criteria

For each test, the next candidate runlog must:

- Have `validators.passed: true` for every previously-failing
  validator.
- Have `judge.skipped: false` (i.e. the judge actually ran).
- Have a non-empty `aggregated_dimensions[]` so the eval app can
  render dimensions for human review.

Aggregate criterion: all 8 affected skills produce a new releasable
v1 candidate that can be annotated end-to-end in the UI without 0/0
dimensions on any test.

## Refinements vs. the prior triage doc

`runlog-triage-2026-05-24.md` covered the same set as a backlog.
Two refinements from this survey:

- **conflict-resolution ut_002** — the prior doc treated
  `conflict-resolution` only as the aborted ut_001 case (addressed
  by the silence-budget code change). The re-run produced
  `v1_2026-05-25_02-26-39.json` where ut_002 now fails validation
  for a *different* reason than the prior doc's analysis covered.
  This plan captures the new failure mode.
- **timeline ut_002** — the prior doc framed the cause as "agent
  flagged impossibility for a scenario where the conflict had been
  resolved", but the `flynn-multi-conflict` scenario actually has
  the conflict **unresolved**. The accurate framing is that
  `impossibilities` is for chronological contradictions only;
  identity/factual conflicts belong in `conflicts[]` regardless of
  resolved status. The SKILL.md fix above reflects the corrected
  framing.
