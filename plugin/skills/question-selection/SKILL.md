---
name: question-selection
description: Selects the next research question based on current project
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
---

# Question Selection

Analyzes the current project state and either selects the next research
question or evaluates whether research on an existing question is
reasonably exhaustive. This skill drives the GPS research cycle — it
determines what to investigate next and when to stop.

## Two modes

This skill operates in two modes:

1. **Select next question** — When the project needs a new research
   question (no open questions, or current questions are resolved/blocked)
2. **Evaluate exhaustiveness** — When all plan items for a question are
   completed and the skill assesses whether the search was reasonably
   exhaustive

## Mode 1: Select next question

### 1. Read project state

Read all sections of `research.json` and the persons in
`tree.gedcomx.json`. Build a mental picture of:

- **Objective:** What is the project trying to prove?
- **Open questions:** What questions are still `open` or `in_progress`?
- **Resolved questions:** What has been answered already?
- **Timeline gaps:** Where are there missing periods in the subject's
  life? (Read `timelines` section)
- **Unresolved conflicts:** What facts are in dispute? Which conflicts
  block downstream questions? (Read `conflicts` section)
- **Hypotheses:** What candidates are being tested? What evidence
  supports or contradicts each? (Read `hypotheses` section)
- **Log coverage:** What has already been searched? Where are the
  gaps in repository coverage? (Read `log` section)
- **Assertions:** What do we know? What is the evidence landscape?

### 2. Identify the highest-value question

Apply these heuristics in priority order:

**Priority 1: Unblock gated questions.**
If a conflict has `blocks_question_ids` entries, resolving that
conflict is the highest priority. Formulate a question that targets
the evidence needed to resolve it.
- `selection_basis`: `unresolved_conflict`

**Priority 2: Test the primary hypothesis.**
If the project objective maps to an active hypothesis, the next
question should test it — either by seeking corroborating evidence
or by trying to disprove it.
- `selection_basis`: `hypothesis_test`

**Priority 3: Fill timeline gaps.**
If the timeline has high-severity gaps (especially gaps that span
census years or vital event dates), formulate a question that
targets the missing period.
- `selection_basis`: `timeline_gap`

**Priority 4: Decompose the objective.**
If the objective hasn't been broken into sub-questions yet, decompose
it. "Identify the parents of Patrick Flynn" decomposes into:
- "Where was Patrick Flynn in the 1850 census?"
- "What does Patrick Flynn's death certificate say about his parents?"
- "Did Thomas Flynn leave a will naming his children?"
- `selection_basis`: `objective_decomposition`

**Priority 5: Pivot to FAN research.**
If direct evidence for the subject is exhausted (all planned searches
complete, but the question remains unresolved), consider pivoting to
the subject's Family, Associates, and Neighbors.
- "Who witnessed Thomas Flynn's land deeds?"
- "Who were Thomas Flynn's neighbors in the 1850 census?"
- "Did any Flynn siblings file probate records naming Patrick?"
- `selection_basis`: `fan_pivot`

**Priority 6: Respond to new evidence.**
If a recently extracted assertion opens a new line of inquiry
(e.g., a death certificate names an unexpected parent), formulate
a question to investigate.
- `selection_basis`: `new_evidence`

### 3. Formulate the question

A well-formed research question must be:

- **Specific:** Focus on one person, one event, one relationship
- **Measurable:** The answer is verifiable — you can tell when it's
  resolved
- **Scoped:** Restricted to a specific place and time period

**Bad:** "Trace the Flynn family back as far as possible."
**Good:** "Where was Patrick Flynn in the 1850 census?"
**Good:** "Did Thomas Flynn leave a will naming Patrick as a son?"
**Good:** "Who witnessed Thomas Flynn's 1860 land deed in Schuylkill
County?"

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

Invoke `validate-schema`. Then tell the user:
- The question selected and why (the rationale)
- What it depends on and what it unblocks
- Suggest next step: "Would you like me to plan the research for
  this question?" (research-plan)

---

## Mode 2: Evaluate exhaustiveness

This mode fires when all plan items for a question have status
`completed` or `skipped`.

### 1. Gather evidence of exhaustiveness

Read:
- All log entries referencing plan items for this question
  (via `plan_item_id`)
- All assertions produced by those searches
  (via `produced_assertion_ids` on log entries)
- The plan items themselves — were any skipped? Why?
- The `record_profiles` tool output for the jurisdiction and time
  period — what record types are available?

### 2. Call record_profiles

Call the `record_profiles` MCP tool to determine what types of
records exist for the research subject's country and time period:

```
record_profiles({ country: "United States", timeperiod: "1840-1910" })
```

Compare the available record types against what has actually been
searched (from the log). Flag any record types that are available
but haven't been searched.

### 3. Assess the 7-Point Stop Criteria

Evaluate each criterion and write a 1-2 sentence assessment:

| Criterion | What to assess |
|-----------|---------------|
| `goal_alignment` | Have the results provided a convincing answer to the research question? |
| `repository_breadth` | Have all potentially relevant repositories been addressed? For identity and relationship questions, has FAN research been attempted when direct evidence is insufficient? Compare against `record_profiles` output. |
| `original_substitution` | Has derivative information been replaced by original records wherever possible? Check if any assertions rely solely on derivative sources when originals are available. |
| `independent_verification` | Have at least two independent sources been used to verify the data? Check `independence_analysis` on any related conflicts. |
| `evidence_class` | Does the evidence include at least one original record with primary information? |
| `conflict_resolution` | Have all discrepancies been resolved through reasoning? Check for `unresolved` conflicts related to this question. |
| `overturn_risk` | What is the likelihood that new evidence would overturn this conclusion? Consider unsearched record types, unexplored jurisdictions, and the strength of existing evidence. |

### 4. Write the exhaustive declaration

If all criteria are met, update the question:

```json
{
  "status": "exhaustive_declared",
  "exhaustive_declaration": {
    "declared": true,
    "justification": "Searched 1850 and 1860 censuses (FamilySearch, Ancestry), death certificate (FamilySearch), and probate records (FamilySearch). Three independent sources confirm parentage. No additional record types available for this jurisdiction and period that would bear on the question.",
    "log_entry_ids": ["log_001", "log_002", "log_003", "log_004", "log_005", "log_006"],
    "stop_criteria": {
      "goal_alignment": "Yes — three sources name Thomas Flynn as Patrick's father.",
      "repository_breadth": "Searched FamilySearch and Ancestry. MyHeritage had no coverage for this collection. record_profiles confirms census, vital records, and probate are the primary record types for 1840-1910 Pennsylvania — all searched.",
      "original_substitution": "Original census images and death certificate accessed. Ancestry derivative index confirmed against original.",
      "independent_verification": "Three independent sources: 1850 census, 1860 census, death certificate. Census informants may share a household member, but the death certificate informant (son-in-law) is independent.",
      "evidence_class": "Yes — 1860 census (original, primary for relationship) and death certificate (original, secondary for parentage but direct evidence).",
      "conflict_resolution": "Birthplace conflict (Ireland vs. Pennsylvania) resolved in favor of Ireland per preponderance hierarchy.",
      "overturn_risk": "Low. Three independent sources agree on parentage. No unexamined record type is likely to name a different father."
    }
  }
}
```

If criteria are NOT met, explain what's missing:
- "Repository breadth: probate records not yet searched"
- "Independent verification: only two sources, need a third"
- "Conflict resolution: birthplace conflict still unresolved"

Then either create new questions/plan items to address the gaps,
or explain to the user what remains.

### 5. Validate and present

Invoke `validate-schema`. Tell the user the result:
- If exhaustive: "Research on this question is declared reasonably
  exhaustive. [Summary of what was searched and found.] Ready for
  proof-conclusion."
- If not exhaustive: "Research is not yet exhaustive. [What's
  missing.] Would you like me to create a plan to address the gaps?"

---

## Important rules

- **One question at a time.** Each invocation produces at most one
  new question or one exhaustive declaration. Don't batch multiple
  questions in one pass.
- **Never fabricate evidence.** The question must be answerable by
  real records. Don't ask questions that assume facts not in evidence.
- **FAN pivot is a judgment call, not automatic.** Don't pivot to
  FAN research just because one search returned nil. Pivot when the
  direct evidence path is genuinely exhausted — all planned searches
  completed, and the subject's direct records don't resolve the question.
- **Exhaustive ≠ exhausting.** "Reasonably exhaustive" means further
  searching is unlikely to overturn the conclusion. It does NOT mean
  every possible record has been checked. Use the overturn risk
  criterion as the ultimate test.
