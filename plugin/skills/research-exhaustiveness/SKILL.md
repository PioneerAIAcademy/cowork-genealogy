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
  - validate_research_schema
---

# Research Exhaustiveness

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Evaluates whether research on a single question qualifies as
"reasonably exhaustive" under GPS Component 1.

**Load reference files before proceeding:**
- Read `references/research-exhaustiveness.md` for the framework
  (five threshold questions, overturn risk test, termination criteria)

Fires when all plan items for a question have status `completed`
or `skipped`. If items are still `in_progress`, refuse to declare
and recommend completing the in-flight work first.

## 1. Gather evidence

Read:
- The question being evaluated and its `exhaustive_declaration`
- Log entries for this question's plan items (via `plan_item_id`)
- Assertions produced by those searches (via each assertion's `log_entry_id`)
- Skipped plan items and their reasons

## 2. Apply the five threshold questions

(From `references/research-exhaustiveness.md`)

1. Has the question been answered with sufficient evidence?
2. Broad range of record types searched?
3. All relevant strategies employed (FAN, variant spellings)?
4. Derivative sources replaced with originals where accessible?
5. Enough evidence to resolve conflicts?

If any answer is "no," identify what is missing and stop here.

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
| `overturn_risk` | Likelihood that an unsearched source would change the conclusion? |

## 4. Decide: declare or continue

**Declare exhaustive** if all criteria are met. Update the question
to `status: "exhaustive_declared"` with a filled `exhaustive_declaration`
object (see JSON example below).

**Do not declare** if criteria are unmet. Explain what is missing and
recommend either expanding the plan (`research-plan`) or, if no further
sources are available, an honest early termination.

**Early termination** is valid for resource limits or no further known
sources, but the declaration must honestly state `declared: false`
with a clear explanation. Terminating before sufficient evidence means
the conclusion cannot meet the GPS standard.

## 5. Write the declaration

```json
{
  "status": "exhaustive_declared",
  "exhaustive_declaration": {
    "declared": true,
    "justification": "Searched 1850 and 1860 censuses (FamilySearch, Ancestry), death certificate (FamilySearch), and probate records (FamilySearch). Three independent sources confirm parentage.",
    "log_entry_ids": ["log_001", "log_002", "log_003"],
    "stop_criteria": {
      "goal_alignment": "Yes — three sources name Thomas Flynn as Patrick's father.",
      "repository_breadth": "Census, vital records, and probate all searched.",
      "original_substitution": "Original images accessed; derivative index confirmed.",
      "independent_verification": "Three independent sources with different informants.",
      "evidence_class": "1860 census (original, primary) and death certificate (original, direct).",
      "conflict_resolution": "Birthplace conflict resolved per preponderance hierarchy.",
      "overturn_risk": "Low. No unexamined record type likely to name a different father."
    }
  }
}
```

## 6. Validate and present

Call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before presenting. Tell the user:
- If exhaustive: "Research declared reasonably exhaustive. Ready for
  proof-conclusion."
- If not: "Not yet exhaustive. [What's missing.] Create a plan to
  address the gaps?" (research-plan)

## Rules

- **One declaration at a time.** Each invocation evaluates exactly one
  question.
- **Plan must be complete.** Only evaluate questions whose plan items
  are all `completed` or `skipped`. If items are still `in_progress`,
  recommend completing them first instead of declaring.
- **Exhaustive does not mean exhausting.** The overturn risk
  criterion is the ultimate test: could a real, unsearched source
  plausibly change the conclusion?
- **Proof is all-or-nothing.** If exhaustiveness cannot be declared
  honestly, say so.
- **Historical context matters.** Factor in jurisdictional boundary
  changes, migration patterns, wars, and record availability for the
  time and place when evaluating breadth.

## Edge cases

- **User wants to stop early:** Record `declared: false` with an
  honest explanation. Do not inflate exhaustiveness to justify
  stopping.
- **Plan items still in progress:** Refuse to declare; recommend
  completing the in-flight work first.
- **Already declared:** If `exhaustive_declaration.declared` is
  already true, do not re-declare. Report the existing declaration
  and suggest `proof-conclusion` instead.

## Re-invocation behavior

**Writes:** the `exhaustive_declaration` object and the `status` field
on a single `question` (`q_` id) in `research.json`. Writes nothing
else — no new questions, no `tree.gedcomx.json` changes.

**On repeat invocation:** if the question's
`exhaustive_declaration.declared` is already `true`, does not
re-declare — it reports the existing declaration and points the user
at `proof-conclusion`. If not yet declared, it re-evaluates the same
question against the five threshold questions and the 7-point stop
criteria and may reach a different result as the underlying evidence
changes.

**Do not duplicate:** each invocation evaluates exactly one question
and refines that question's `exhaustive_declaration` in place. Never
write a second declaration for the same question.
