---
name: research-exhaustiveness
model: claude-sonnet-4-6
description: Evaluates whether research on a question is reasonably
  exhaustive — applies the five threshold questions and the 7-point
  stop criteria, then either writes the exhaustive_declaration on the
  question or explains what's missing. GPS Step 1 — Reasonably
  Exhaustive Research. Use when the user says "is this research
  exhaustive?", "are we done?", "have we searched enough?", "can we
  declare exhaustive?", or after all plan items for a question are
  complete. Do NOT use when the user wants the next research question
  (use question-selection), when the user wants to plan more searches
  for an open question (use research-plan), or when the user wants to
  write the proof conclusion (use proof-conclusion).
allowed-tools:
  - research_append
---

# Research Exhaustiveness

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Evaluates whether research on a single question qualifies as
"reasonably exhaustive" under GPS Component 1.

**Before proceeding**, read `references/research-exhaustiveness.md` for
the framework (five threshold questions, overturn risk test,
termination criteria).

**First, confirm this is an exhaustiveness evaluation.** This skill judges
whether an *already-planned, already-searched* question is reasonably
exhaustive. If the request is really to pick the **next question** (→
`question-selection`), to **plan more searches** for an open question (→
`research-plan`), or to **write the conclusion** (→ `proof-conclusion`),
**decline and route there — do not run the evaluation below.** The
declare/proof guidance in this skill applies only *after* you have decided
this genuinely is an exhaustiveness check.

Only evaluate a question whose plan items are all `completed` or
`skipped`. If any is `in_progress`, refuse to declare and recommend
finishing the in-flight work first.

## 0. Precondition check (run first)

The `evidence_class` and `independent_verification` criteria in Step 3 are
meaningless against unclassified assertions, or when the persons the judgment
depends on have not been identified in the tree. Before applying the five
threshold questions, run two checks over the assertions tied to this question
(via `extracted_for_question_ids`):

- **Classification (hard block, all assertions).** Every assertion must have
  a real `information_quality` and `evidence_type` from
  `assertion-classification` (not a leftover record-extraction default). If
  any assertion fails, stop here, name the specific assertion IDs, and
  recommend `assertion-classification`.
- **person_evidence (hard block scoped to person identity).** `person_evidence`
  is identity resolution. Confirm **each person the judgment depends on** — the
  subject and any candidate parent/relative — is identified by **at least one**
  linked assertion. If any such person has no linked identity assertion, stop
  and recommend `person-evidence`. Unlinked *fact* and *negative* assertions
  about an already-identified person are advisory, not blockers — note them and
  continue.

Do not declare exhaustive while a blocking check fails.

## 1. Gather evidence

Read:
- The question and its `exhaustive_declaration`
- Log entries for its plan items (via `plan_item_id`)
- Assertions from those searches (via each assertion's `log_entry_id`)
- Skipped plan items and their reasons

## 2. Apply the five threshold questions

(From `references/research-exhaustiveness.md`.) If any answer is "no,"
identify what is missing and stop here.

1. Answered with sufficient evidence?
2. Broad range of record types searched?
3. All relevant strategies employed (FAN, variant spellings)?
4. Derivative sources replaced with originals where accessible?
5. Enough evidence to resolve conflicts?

## 3. Assess the 7-Point Stop Criteria

Write a 1-2 sentence assessment for each:

| Criterion | Key question |
|-----------|-------------|
| `goal_alignment` | Convincing answer obtained? |
| `repository_breadth` | All relevant repositories, jurisdictions, and name variants tried? |
| `original_substitution` | Derivatives replaced with originals where available? |
| `independent_verification` | At least two independent sources? (Same informant = one unit.) |
| `evidence_class` | At least one original record with primary information? |
| `conflict_resolution` | All discrepancies resolved? Unresolved conflicts block proof. |
| `overturn_risk` | Could an unsearched source plausibly change the conclusion? |

## 4. Decide: declare or continue

- **Declare exhaustive** — all criteria met. Persist the declaration
  and set `status: "exhaustive_declared"` in one call (Step 5).
- **Do not declare** — criteria unmet because a genuinely **unsearched**
  source remains. Explain what is missing and recommend expanding the plan
  (`research-plan`). **When in doubt, a gap is unsearched, not unobtainable —
  default to `research-plan`.**
  - *Narrow exception — a source verified **inaccessible*** (a browse-only
    image over the MCP transport cap, or nil across `record_search` /
    `fulltext_search` / `image_search` / external sites after the bounded
    search-records attempts) is *pursued-and-unavailable*, not an unsearched
    gap. **Only** when the **accessible** evidence already supports a
    defensible conclusion, do not loop `research-plan` to re-attempt it: set
    `status: "exhaustive_declared"` (note the limitation in a `stop_criteria`
    note + `overturn_risk`) and route to `proof-conclusion`, which sets the
    honest tier the available (often indirect) evidence supports. Documenting
    an unobtainable source is exhaustive research; re-searching it is not.
- **Early termination** — valid for resource limits or no further known
  sources, but the declaration must honestly state `declared: false`.
  **Do not change `status`** — leave it `"in_progress"`.
  `"exhaustive_declared"` means the research WAS exhaustive; a
  `declared: false` termination is explicitly not, so the status stays
  `"in_progress"`. Terminating before sufficient evidence means the
  conclusion cannot meet the GPS standard.

## 5. Write the declaration

Persist via `research_append` `op: "update"` on the question. You pass
the analytical judgment (the `stop_criteria` assessments and the
`log_entry_ids` you gathered); the tool validates-before-persist and
writes atomically.

**Declare exhaustive** (all criteria met) — sets `status` and the
declaration in one call:

```
research_append({
  projectPath: "<absolute-path-to-project-directory>",
  section: "questions",
  op: "update",
  entryId: "<q_ id of the question being evaluated>",
  fields: {
    status: "exhaustive_declared",
    exhaustive_declaration: {
      declared: true,
      justification: "Searched 1850/1860 censuses, death certificate, and probate (FamilySearch, Ancestry). Three independent sources confirm parentage.",
      log_entry_ids: ["log_001", "log_002", "log_003"],
      stop_criteria: {
        goal_alignment: "Yes — three sources name Thomas Flynn as father.",
        repository_breadth: "Census, vital records, and probate all searched.",
        original_substitution: "Original images accessed; derivative index confirmed.",
        independent_verification: "Three independent sources, different informants.",
        evidence_class: "1860 census (original, primary) and death certificate (original, direct).",
        conflict_resolution: "Birthplace conflict resolved per preponderance hierarchy.",
        overturn_risk: "Low. No unexamined record type likely to name a different father."
      }
    }
  }
})
```

**Early termination** (`declared: false`) — leave `status` as
`"in_progress"`; pass only `exhaustive_declaration`, NOT `status`:

```
research_append({
  projectPath: "<absolute-path-to-project-directory>",
  section: "questions",
  op: "update",
  entryId: "<q_ id of the question being evaluated>",
  fields: {
    exhaustive_declaration: {
      declared: false,
      justification: "Probate and church records were destroyed in an 1862 fire; no surviving source names the father. Terminating for lack of further known sources.",
      log_entry_ids: ["log_001", "log_002"],
      stop_criteria: { /* honest per-criterion assessment of what was and wasn't met */ }
    }
  }
})
```

If the call returns `{ ok: false, errors }`, surface the errors and fix
the offending field — do not blindly retry the same payload.

## 6. Present

- If exhaustive: "Research declared reasonably exhaustive. Ready for
  proof-conclusion."
- If not: "Not yet exhaustive. [What's missing.] Create a plan to
  address the gaps?" (research-plan)

## Rules

- **One declaration at a time.** Each invocation evaluates exactly one
  question.
- **Plan must be complete.** Only evaluate questions whose plan items
  are all `completed` or `skipped`; if any is `in_progress`, recommend
  completing them first instead of declaring.
- **Exhaustive does not mean exhausting.** Overturn risk is the
  ultimate test: could a real, unsearched source plausibly change the
  conclusion?
- **Proof is all-or-nothing.** If exhaustiveness cannot be declared
  honestly, say so.
- **Historical context matters.** Factor in jurisdictional boundary
  changes, migration, wars, and record availability for the time and
  place when judging breadth.

## Edge cases

- **User wants to stop early:** Record `declared: false` with an
  honest explanation. Do not inflate exhaustiveness to justify
  stopping.
- **Plan items still in progress:** Refuse to declare; recommend
  completing the in-flight work first.
- **Already declared:** If `exhaustive_declaration.declared` is already
  `true`, do not re-declare — re-running Step 5's `update` is a
  structural no-op. Report the existing declaration and suggest
  `proof-conclusion` instead.

## Re-invocation behavior

**Writes:** the `exhaustive_declaration` object and `status` on a single
`question` (`q_` id) via `research_append` `op: "update"`. Nothing else
— no new questions, no `tree.gedcomx.json` changes.

**On repeat invocation:** if `exhaustive_declaration.declared` is
already `true`, does not re-declare — it reports the existing
declaration and points to `proof-conclusion`. If not yet declared, it
re-evaluates the same question against the five threshold questions and
the 7-point stop criteria, and may reach a different result as evidence
changes.

**Do not duplicate:** each invocation evaluates exactly one question and
refines that question's `exhaustive_declaration` in place. Never write a
second declaration for the same question.
