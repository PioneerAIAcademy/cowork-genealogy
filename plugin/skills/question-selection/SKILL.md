---
name: question-selection
model: claude-sonnet-4-6
description: Selects the next research question (writing it to research.json) based on current project
  state — timeline gaps, unresolved conflicts, hypothesis tests, or
  exhausted direct evidence requiring FAN pivot. Also evaluates and writes
  the exhaustive declaration when all plan items for a question are complete.
  GPS Step 1 — Reasonably Exhaustive Research (question formulation and
  exhaustiveness assessment). Use when the user says "what should I research
  next?", "next question", "what's missing?", "should we try FAN research?",
  "is this research exhaustive?", "are we done?", after a question is
  resolved, or after a proof summary reveals gaps. Do NOT use when the user
  already has a specific question and wants to plan how to answer it (use
  research-plan), or when the user wants to search records (use
  search-records or search-external-sites).
allowed-tools:
  - validate_research_schema
---

# Question Selection

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Analyzes the current project state and either selects the next research
question or evaluates whether research on an existing question is
reasonably exhaustive.

**Load reference files before proceeding:**
- Read `references/question-formulation.md` for research question criteria
- Read `references/question-exhaustiveness.md` for stop criteria
- Read `references/pedigree-analysis.md` for gap detection guidance

## Two modes

1. **Select next question** — Project needs a new research question
2. **Evaluate exhaustiveness** — All plan items for a question are done

## Mode 1: Select next question

### 1. Read project state

Read all sections of `research.json` and persons in
`tree.gedcomx.json`. Identify:

- **Objective:** The overarching research goal. Every question must
  trace back to it.
- **Open questions:** Status `open` or `in_progress`
- **Resolved questions:** What has been answered
- **Pedigree gaps:** Individuals missing a name, specific date, or
  locality at county/parish level (see `references/pedigree-analysis.md`)
- **Timeline gaps:** Missing periods in the subject's life
- **Unresolved conflicts:** Disputed facts, especially those that
  block downstream questions
- **Hypotheses:** Active candidates being tested
- **Log coverage:** What has been searched and where gaps remain
- **Assertions:** The current evidence landscape

### 2. Identify the highest-value question

Apply these priorities in order. When multiple candidates exist at
the same priority level, prefer the one that unblocks the most
downstream questions.

| Priority | Trigger | `selection_basis` |
|----------|---------|-------------------|
| 1 | A conflict has `blocks_question_ids` entries | `unresolved_conflict` |
| 2 | The objective maps to an active hypothesis needing test | `hypothesis_test` |
| 3 | Timeline has high-severity gaps spanning census/vital years | `timeline_gap` |
| 4 | Objective not yet decomposed into sub-questions | `objective_decomposition` |
| 5 | Pedigree analysis reveals missing key data or inconsistencies | `pedigree_gap` |
| 6 | Direct evidence exhausted; pivot to Family/Associates/Neighbors | `fan_pivot` |
| 7 | A recently extracted assertion opens a new line of inquiry | `new_evidence` |

**Priority 4 detail:** Each sub-question targets a single fact (one
identity, relationship, or event). Example decomposition of "Identify
the parents of Patrick Flynn":
- "Where was Patrick Flynn in the 1850 census?"
- "What does Patrick Flynn's death certificate say about his parents?"
- "Did Thomas Flynn leave a will naming his children?"

**Priority 6 detail:** Don't pivot to FAN just because one search
returned nil. Pivot when all planned direct searches are complete and
unresolved. FAN examples:
- "Who witnessed Thomas Flynn's land deeds?"
- "Who were Thomas Flynn's neighbors in the 1850 census?"

### 3. Formulate the question

See `references/question-formulation.md` for the three criteria
(one objective, named individual, testable scope) and examples.

Before formulating, verify the starting-point information is sound.
Do not build a question on unverified claims from compiled sources
(online trees, unsourced genealogies). If the premise is unverified,
the first question should verify it.

### 4. Write the question

Add a new question to `research.json` `questions[]`:

```json
{
  "id": "q_003",
  "question": "Did Thomas Flynn leave a will or probate record in Schuylkill County naming Patrick as a son?",
  "rationale": "Direct evidence from a probate record would confirm the parent-child relationship. Thomas Flynn died circa 1881 based on his disappearance from tax records. Schuylkill County probate records are available on FamilySearch.",
  "selection_basis": "hypothesis_test",
  "priority": "high",
  "status": "open",
  "depends_on": [],
  "unblocks": ["q_001"],
  "created": "2026-05-04",
  "resolved": null,
  "resolution_assertion_ids": [],
  "exhaustive_declaration": {
    "declared": false,
    "justification": null,
    "log_entry_ids": [],
    "stop_criteria": null
  }
}
```

**Set dependency links:**
- `depends_on`: Questions that must be resolved before this one can
  be meaningfully pursued
- `unblocks`: Questions that this question's resolution would
  enable or advance. High `unblocks` counts indicate gatekeeper
  questions — prioritize these.

### 5. Validate and present

Call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before presenting. Then tell the user:
- The question selected and why (the rationale)
- What it depends on and what it unblocks
- Suggest next step: "Would you like me to plan the research for
  this question?" (research-plan)

---

## Mode 2: Evaluate exhaustiveness

Fires when all plan items for a question have status `completed`
or `skipped`. See `references/question-exhaustiveness.md` for
the full framework (five threshold questions, overturn risk test,
termination criteria).

### 1. Gather evidence

Read:
- Log entries for this question's plan items (via `plan_item_id`)
- Assertions produced by those searches (via each assertion's `log_entry_id`)
- Skipped plan items and their reasons

### 2. Apply the five threshold questions

(From `references/question-exhaustiveness.md`)

1. Has the question been answered with sufficient evidence?
2. Broad range of record types searched?
3. All relevant strategies employed (FAN, variant spellings)?
4. Derivative sources replaced with originals where accessible?
5. Enough evidence to resolve conflicts?

If any answer is "no," identify what is missing and stop here.

### 3. Assess the 7-Point Stop Criteria

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

### 4. Decide: declare or continue

**Declare exhaustive** if all criteria are met. Update the question
to `status: "exhaustive_declared"` with a filled `exhaustive_declaration`
object (see JSON example below).

**Do not declare** if criteria are unmet. Explain what is missing and
either create new plan items or inform the user what remains.

**Early termination** is valid for resource limits or no further known
sources, but the declaration must honestly state `declared: false`
with a clear explanation. Terminating before sufficient evidence means
the conclusion cannot meet the GPS standard.

### 5. Write the declaration

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

### 6. Validate and present

Call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before presenting. Tell the user:
- If exhaustive: "Research declared reasonably exhaustive. Ready for
  proof-conclusion."
- If not: "Not yet exhaustive. [What's missing.] Create a plan to
  address the gaps?"

---

## Rules

- **One question at a time.** Each invocation produces at most one
  new question or one exhaustive declaration.
- **Sound basis required.** Do not build questions on unsound
  assumptions (claims that may be plausible but have no supporting
  evidence). If the premise is unverified, verify it first.
- **Objectives vs. questions.** Never write an objective as a
  question. Questions are narrow, single-fact, testable sub-problems.
- **FAN pivot is a judgment call.** Pivot only when all planned
  direct searches are complete and unresolved — not after one nil
  result.
- **Exhaustive does not mean exhausting.** The overturn risk
  criterion is the ultimate test: could a real, unsearched source
  plausibly change the conclusion?
- **Proof is all-or-nothing.** If exhaustiveness cannot be declared
  honestly, say so.
- **Historical context matters.** Factor in jurisdictional boundary
  changes, migration patterns, wars, and record availability for the
  time and place when selecting questions.

## Edge cases

- **Fresh project, no clear gaps:** If init-project just ran and the
  pedigree has no obvious errors, default to Priority 4 (decompose
  the objective into sub-questions).
- **All questions blocked:** If every open question depends on an
  unresolved predecessor, identify the root blocker and formulate a
  question to resolve it — even if it means addressing a conflict
  that doesn't yet have a formal conflict entry.
- **User wants to stop early:** Record `declared: false` with an
  honest explanation. Do not inflate exhaustiveness to justify
  stopping.
