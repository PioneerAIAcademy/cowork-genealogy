# Runlog triage — 2026-05-24 all-24-skills serial run

## Summary

Across all 24 skills (93 tests, $20.31), the May 24 serial run produced:

| Outcome | Count |
|---|---|
| pass | 58 |
| partial | 10 |
| fail | 24 |
| aborted | 1 |

Three code-level changes shipped in the same session — per-test `sdk_message_silence_seconds` override, `validate_research_schema` exemption from `test_no_mcp_tools_called`, and `null` allowed on optional `researcher_profile.narration_guidance`. Those should clear ~6 of the failures on the next run.

This document is the **deferred-work backlog**: 19 in-skill issues that other developers should address. Each entry names the affected test(s), the failure signature, and a short triage of the root cause. No code changes — these all want SKILL.md, test JSON, fixture, or scenario edits.

## Format

For each item: **affected test(s)**, **signature** (validator failure, judge dimension score, abort reason), **probable root cause**, **suggested intervention**.

---

## Routing / activation issues (description-level)

These tests fail because the skill that should have handled the prompt didn't, or the wrong skill did. Fixes belong in `packages/engine/plugin/skills/<skill>/SKILL.md` frontmatter `description` blocks, occasionally in the user_message wording of the test JSON.

### search-familysearch-wiki `_003` (positive, fail)
- Signature: `skills_invoked=['locality-guide']` — routed away from search-familysearch-wiki.
- Cause: prompt "build me a useful locality guide… for Germany" lexically matches `locality-guide`'s trigger phrases more strongly than search-familysearch-wiki's.
- Suggested: tighten the test prompt to lean on search-familysearch-wiki's actual capability (querying the FamilySearch wiki for a specific topic), or extend search-familysearch-wiki's description to claim "country-level wiki overview" explicitly.

### tree-edit `_001` (positive, fail)
- Signature: `skills_invoked=['project-status']` — routed to project-status instead of tree-edit.
- Cause: prompt "verify Patrick Flynn's birth fact" reads as a status/audit query rather than a tree edit.
- Suggested: clarify the user_message to involve an actual edit ("update Patrick's birth fact in the tree…") or widen tree-edit's description to cover verify-then-edit prompts.

### convert-dates `_003` (negative, fail)
- Signature: `skills_invoked=[]` — no skill activated; agent answered conversationally about Quaker month numbering.
- Cause: prompt was an out-of-skill historical-context question, but convert-dates' description didn't help the model route to historical-context.
- Suggested: review historical-context's description for Quaker-calendar coverage, or accept that conversational answers count as a valid "decline" for this negative test.

### research-plan `_003` (negative, fail)
- Signature: `skills_invoked=['research-plan']` — the skill DID activate but then declined inline.
- Cause: the test (flipped to negative in this triage cycle) wants the skill to route to `question-selection` or `project-status`, but research-plan's description still pulls "what's the next plan item?" prompts on resolved projects.
- Suggested: narrow research-plan's description so it excludes already-resolved questions, or accept self-declined activation as routing-correct.

### search-wikipedia `_008` (negative, fail)
- Signature: `skills_invoked=[]`, text_response is a Python CSV parsing function.
- Cause: agent answered an out-of-scope programming question conversationally instead of declining. Negative tests of this kind probe a *cross-skill* "decline out-of-scope" boundary that no single skill owns.
- Suggested: this is a system-prompt or harness-level concern. Either accept "no skill activated + decline appropriate" as a valid outcome shape, or invest in a `decline-out-of-scope` skill / harness assertion that's tested separately.

### hypothesis-tracking `_003` (negative, fail)
- Signature: `skills_invoked=['conflict-resolution']` — wrong skill activated and produced work.
- Cause: prompt apparently has conflict-resolution-flavored language that pulls routing wrong.
- Suggested: review the prompt text; either retarget the negative test to actually expect conflict-resolution, or rephrase to remove the conflict-resolution lure.

---

## Model-output quality (judge fails)

These tests have the right skill activated, validators pass, but the judge marks output below the rubric. Fixes belong in `packages/engine/plugin/skills/<skill>/SKILL.md` body (prompting / examples / explicit rules), occasionally in the test rubric itself.

### record-extraction `_010` (positive, fail)
- Signature: Correctness=1, Assertion atomicity=1, Informant identification=2, Evidence type accuracy=2.
- Cause: assertions are systematically compound (combining age + birth year + birthplace into single `value` fields); `record_id` is truncated rather than the full arkUrl; informant proximity is generic.
- Suggested: strengthen the atomicity rule in SKILL.md with a worked counter-example. Bold the `record_id` exact-arkUrl rule. Add an informant-proximity decision tree.

### search-records `_002` (positive, fail)
- Signature: Correctness=1, Log quality=1 — agent treated 1850-collection results as 1870-query answers.
- Cause: the SKILL's "Sanity-check the collection" rule (added this triage cycle) isn't yet sticky enough; the agent logged fabricated 1870 outcomes.
- Suggested: bold the rule and add a concrete "if collection year ≠ query year, the entry is `outcome: negative` for the asked-for year" example.

### search-records `_011` (positive, fail)
- Signature: Tool Arguments=1 — agent invented an `fatherGivenName` parameter that `record_search` doesn't support.
- Cause: SKILL's variant-strategy section lists "spouse/parent names" loosely; the model invented a non-existent parameter.
- Suggested: enumerate the actual `record_search` parameters in the SKILL, or link to the MCP tool's schema.

### search-records `_010` (positive, fail)
- Signature: `test_log_append_only: Log entry log_004 was modified`.
- Cause: agent edited an existing log entry rather than appending a new one. The append-only rule is in the spec but not surfaced in SKILL.md.
- Suggested: add an "append-only — never modify or delete existing log entries" rule in search-records SKILL.md (and possibly mirror in other write-to-log skills).

### search-full-text `_002` (positive, fail)
- Signature: Correctness=1, Tool Arguments=1, FAN awareness=1 — invalid variant query plus missing FAN exploration.
- Cause: SKILL doesn't tell the agent enough about valid query operators and doesn't strongly prompt for FAN searches.
- Suggested: SKILL prompting tweaks; possible new reference doc on valid full-text query operators.

### research-plan `_001` (positive, fail)
- Signature: `test_research_plan_no_new_plan: created pl_003 when an existing active plan should have been reviewed`.
- Cause: ambiguous user_message ("Create or review the research plan…") — the agent picked "create."
- Suggested: tighten the test prompt to specifically ask for a review of the existing plan, OR add SKILL.md guidance for distinguishing review vs. create.

### research-plan `_002` (positive, fail)
- Signature: `test_research_plan_new_plan_for_q_001: pl_002 was modified when a NEW plan should have been added`.
- Cause: agent modified the existing plan instead of creating a sibling. Inverse of `_001`'s problem.
- Suggested: SKILL.md guidance on when to add a new plan vs. update the active one.

### record-extraction `_002` (positive, fail)
- Signature: Informant identification=1 — agent listed "Census enumerator" as informant for a *negative-evidence* absence fact.
- Cause: SKILL doesn't address informant identification for negative evidence specifically.
- Suggested: add a negative-evidence informant rule to record-extraction SKILL.md (the informant is "unknown household member" or similar, not the enumerator).

### person-evidence `_013` (positive, fail)
- Signature: `test_low_score_variant_still_links: expected a new person_evidence entry linking a_003`.
- Cause: agent didn't create the expected pe entry.
- Suggested: SKILL.md may need clearer rule on when a low match score should still result in a link (the qualitative-corroboration override).

### question-selection `_002`, `_003` (positive, fail)
- Signature: `test_first_question_depends_on_empty: expected a new question; none was added` and `test_selection_basis_unresolved_conflict: expected a new question; none was added`.
- Cause: agent declined to add a new question in scenarios where it was warranted (empty project, unresolved conflict driving need).
- Suggested: SKILL.md guidance on when the skill SHOULD propose a new question vs. defer.

### timeline `_002` (positive, fail)
- Signature: `test_no_impossibilities_when_resolved: added unwarranted impossibilities`.
- Cause: agent flagged a timeline impossibility ("Two Patrick Flynns of similar age…") for a scenario where the conflict had been resolved.
- Suggested: SKILL.md rule that the timeline skill must respect resolved-conflict status from `conflicts[]` and not re-raise.

### assertion-classification `_001` (positive, fail)
- Signature: `test_a001_preserves_classification: a_001 evidence_type should be 'direct'; got 'indirect'`.
- Cause: model misclassified a specific assertion.
- Suggested: SKILL.md may need clearer direct-vs-indirect examples for this fact type.

### proof-conclusion `_001`, `_002` (positive, fail)
- Signature: Both fail `test_no_mcp_tools_called`. After this triage cycle's code fix, those will pass — but the underlying judge data wasn't surfaced because the validator failed first. **Re-run after the code fix is shipped to surface what's actually next.**

---

## Notes on excluded items

- `conflict-resolution _001` (aborted, sdk_stream_silence) — addressed by code change 1 in this triage cycle.
- `assertion-classification _002`, `proof-conclusion _001`/`_002` validator-only fails on `test_no_mcp_tools_called` — addressed by code change 2.
- `record-extraction _001` `narration_guidance: None` schema fail — addressed by code change 3.

---

## Re-run priority

After the 3 code changes ship, the **5 skills that contained false-positive validator failures** should be re-run first to surface the real underlying signal:

1. `assertion-classification` (currently 1 pass + 2 fail — both fails are validator false positives)
2. `proof-conclusion` (currently 1 pass + 2 fail — both fails are validator false positives)
3. `conflict-resolution` (currently 3 pass + 1 abort — abort gets longer silence budget)
4. `record-extraction` (currently 2 pass + 1 partial + 2 fail — `_001` schema fail goes away)
5. The other affected validators (`check-warnings`, `project-status`, `translation`) didn't trip but should be re-run for confidence — covered by a simple full-suite re-run, no separate priority.

A full `--all` re-run is the cleanest way to compare. Skills not listed should be re-run as part of the standard release cadence; they're not blocked.
