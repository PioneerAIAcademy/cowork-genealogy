---
name: question-selection
model: claude-sonnet-4-6
description: Selects the next research question (writing it to research.json) based on current project
  state — timeline gaps, unresolved conflicts, hypothesis tests, or
  exhausted direct evidence requiring FAN pivot. Also derives the first
  research question on a brand-new project. GPS Step 1 — Reasonably
  Exhaustive Research. Use when the user says "what should I research
  next?", "what should we work on next?", "next question", "where should
  I start?", "where do I begin?", "what's missing?", "should we try FAN
  research?", after a question is resolved, or after a proof summary
  reveals gaps. Do NOT use when
  the user already has a specific question and wants to plan how to
  answer it (use research-plan), when the user wants to evaluate
  whether research on a question is exhaustive (use
  research-exhaustiveness), when the user only wants a summary of the
  project's current state (use project-status), or when the user wants
  to search records (use search-records or search-external-sites).
allowed-tools:
  - validate_research_schema
---

# Question Selection

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Analyzes the current project state and selects the next research
question.

**Load reference files before proceeding:**
- Read `references/question-formulation.md` for research question criteria
- Read `references/pedigree-analysis.md` for gap detection guidance

## 1. Read project state

Read all sections of `research.json` and persons in
`tree.gedcomx.json`. Identify:

- **Objective:** The overarching research goal. Every question must
  trace back to it.
- **Open questions:** Status `open` or `in_progress`
- **In-progress plan items:** Any `plan_items[].status == "in_progress"`
  on an open question. These represent in-flight research the user
  has already committed to.
- **Resolved questions:** What has been answered
- **Pedigree gaps:** Individuals missing a name, specific date, or
  locality at county/parish level (see `references/pedigree-analysis.md`)
- **Timeline gaps:** Missing periods in the subject's life
- **Unresolved conflicts:** Disputed facts, especially those that
  block downstream questions
- **Hypotheses:** Active candidates being tested
- **Log coverage:** What has been searched and where gaps remain
- **Assertions:** The current evidence landscape

### 1a. Finish what's already open before selecting a new question

If any open question has plan items with `status: "in_progress"`,
**do NOT create a new question** — with one exception (below).
Recommend that the user complete the in-flight plan items first.
Reference them by `pli_XXX` ID and name the repository/record type
so the user knows exactly what to finish (e.g., "Complete `pli_006`
— the Thomas Flynn probate search on FamilySearch — before adding
new questions").

Adding new questions while existing plans are mid-flight churns
research direction without resolving anything; the in-flight item
may produce evidence that changes which question is next-highest
value. Only proceed to Step 2 (priority selection) when no
in-progress plan items exist, or when the user explicitly overrides
with "add a question anyway." In the override case, set the new
question's `depends_on` to include the question whose plan is in
flight.

**Exception — blocking unresolved conflicts.** If `conflicts[]`
contains any entry whose `status == "unresolved"` and whose
`blocks_question_ids` lists an open question, the in-progress rule
does NOT block adding a new question. A blocking conflict means
the in-flight plan items cannot meaningfully resolve the question
they belong to — the conflict itself has to be addressed first.
Proceed to Step 2; Priority 1 (`unresolved_conflict`) will fire,
producing a question that targets evidence to resolve the conflict.
Set the new question's `unblocks` to include the question whose
plan is in flight, since resolving the conflict is what re-enables
that plan's progress.

## 2. Identify the highest-value question

Apply these priorities in order. When multiple candidates exist at
the same priority level, prefer the one that unblocks the most
downstream questions.

| Priority | Trigger | `selection_basis` |
|----------|---------|-------------------|
| 1 | A conflict has `blocks_question_ids` entries | `unresolved_conflict` |
| 2 | The objective maps to an active hypothesis needing test | `hypothesis_test` |
| 3 | Timeline has high-severity gaps spanning census/vital years | `timeline_gap` |
| 4 | Objective not yet decomposed into sub-questions | `objective_decomposition` |
| 5 | Pedigree analysis reveals missing key data or inconsistencies | `objective_decomposition` |
| 6 | Direct evidence exhausted; pivot to Family/Associates/Neighbors | `fan_pivot` |
| 7 | A recently extracted assertion opens a new line of inquiry | `new_evidence` |

**Priority 3 detail:** Only fires when `severity == "high"` in the timeline gap. Low-severity gaps do not trigger this priority.

**Priority 4 detail:** Each sub-question targets a single fact (one
identity, relationship, or event). Example decomposition of "Identify
the parents of Patrick Flynn":
- "Where was Patrick Flynn in the 1850 census?"
- "What does Patrick Flynn's death certificate say about his parents?"
- "Did Thomas Flynn leave a will naming his children?"

**Priority 6 detail:** Don't pivot to FAN just because one search
returned nil. Pivot when all planned direct searches are complete and
unresolved. If the primary question's `exhaustive_declaration.declared`
is `true`, the researcher has declared all reasonable direct evidence
exhausted — take this as the FAN pivot signal and do NOT propose
additional direct-evidence paths. FAN examples:
- "Who witnessed Thomas Flynn's land deeds?"
- "Who were Thomas Flynn's neighbors in the 1850 census?"

## 3. Formulate the question

See `references/question-formulation.md` for the three criteria
(one objective, named individual, testable scope) and examples.

Before formulating, verify the starting-point information is sound.
Do not build a question on unverified claims from compiled sources
(online trees, unsourced genealogies). If the premise is unverified,
the first question should verify it.

## 4. Write the question

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
- `depends_on`: Questions whose resolution enables or informs this
  question's research path. Include a question in `depends_on` when
  either: (a) it must be resolved before this question can be
  meaningfully pursued, OR (b) this question's most efficient research
  strategy relies on specific findings from that question (e.g., q_001
  identified a specific household and the new question searches within
  that household — include q_001 even if it is already resolved).
- `unblocks`: Questions that this question's resolution would
  enable or advance. High `unblocks` counts indicate gatekeeper
  questions — prioritize these.

The new question's `exhaustive_declaration` must be unstarted at
creation time (`declared: false`, `log_entry_ids: []`,
`stop_criteria: null`). Evaluation of exhaustiveness is the
`research-exhaustiveness` skill's job, run after all plan items
for the question are completed.

## 5. Validate and present

Call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before presenting. Then tell the user:
- The question selected and why (the rationale)
- What it depends on and what it unblocks
- Suggest next step: "Would you like me to plan the research for
  this question?" (research-plan)

## Rules

- **One question at a time.** Each invocation produces at most one
  new question.
- **Finish what's open.** Do not introduce new questions while any
  open question's plan items are `in_progress`. Recommend completing
  the in-flight work first (see Step 1a).
- **Sound basis required.** Do not build questions on unsound
  assumptions (claims that may be plausible but have no supporting
  evidence). If the premise is unverified, verify it first.
- **Objectives vs. questions.** Never write an objective as a
  question. Questions are narrow, single-fact, testable sub-problems.
- **FAN pivot is a judgment call.** Pivot only when all planned
  direct searches are complete and unresolved — not after one nil
  result.
- **Don't declare exhaustiveness here.** Evaluating whether
  research on a question is reasonably exhaustive is the
  `research-exhaustiveness` skill's responsibility. This skill
  creates new questions; it does not close them.
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
- **All plan items for a question are complete:** Recommend
  `research-exhaustiveness` to evaluate whether the question's
  research is reasonably exhaustive, rather than adding another
  question — but only when no higher-priority signal (1–3) is
  present. Run the priority ladder in Step 2 first: a blocking
  conflict, an untested hypothesis, or a high-severity timeline gap
  still outranks this edge case even if every plan item for the
  current question is complete. This edge case is the fallback for
  when Priorities 1–3 do not fire — it does not override them.

## Re-invocation behavior

**Writes:** entries in the `questions` section of `research.json`
(`q_` ids) and their `status` field. Mutable in place; never deletes
entries — supersedes via `status`.

**On repeat invocation:** re-evaluates which question to work on next.
May update the `status` of an existing question (e.g. mark it
`answered` or `superseded`), or select a different question that is
already in the section. Adds a new `q_` only if the next question
isn't already present.

**Do not duplicate:** never write a second `q_` entry for the same
research question. If the question already exists, update its
`status` rather than re-creating it.

