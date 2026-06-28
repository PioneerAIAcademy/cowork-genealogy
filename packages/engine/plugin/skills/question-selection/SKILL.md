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
  - research_append
---

# Question Selection

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Analyzes the current project state and selects the next research question.

**Load reference files before proceeding:**
- Read `references/question-formulation.md` for research question criteria
- Read `references/pedigree-analysis.md` for gap detection guidance

## 1. Read project state

You need the current project state to select a question. If you already
hold the relevant sections in context from the same continuous run
(e.g. the orchestrator just routed here after a write whose compact
return you have), trust that and don't re-read to be safe — the writer
tools validate the whole project on every write, so an in-context view
can't be silently stale. Re-read `research.json` (and persons in
`tree.gedcomx.json`) when you're entering this phase cold, or when a
sub-skill or the user changed the file in a way you don't already have.
Either way, identify:

- **Objective** — the overarching goal; every question must trace back to it.
- **Open questions** (`open` / `in_progress`) and **in-progress plan items**
  (`plan_items[].status == "in_progress"` on an open question — in-flight
  research the user has already committed to).
- **Resolved questions** — what has been answered.
- **Pedigree gaps** — individuals missing a name, specific date, or
  county/parish-level locality (see `references/pedigree-analysis.md`).
- **Timeline gaps**, **unresolved conflicts** (especially those blocking
  downstream questions), **active hypotheses**, **log coverage**, and the
  current **assertion** landscape.

### 1a. Finish what's already open before selecting a new question

If any open question has plan items with `status: "in_progress"`, **do NOT
create a new question** (one exception below) — adding questions mid-flight
churns direction without resolving anything, and the in-flight item may
produce evidence that changes which question is next-highest value.
Recommend the user complete the in-flight items first, referencing each by
`pli_XXX` ID plus repository/record type (e.g. "Complete `pli_006` — the
Thomas Flynn probate search on FamilySearch — before adding new questions").
Only proceed to Step 2 when no in-progress plan items exist, or when the
user explicitly overrides with "add a question anyway." In the override
case, set the new question's `depends_on` to include the question whose
plan is in flight.

**Exception — blocking unresolved conflicts.** If any `conflicts[]` entry
has `status == "unresolved"` and lists an open question in
`blocks_question_ids`, the in-progress rule does NOT block a new question:
the conflict means the in-flight plan items cannot meaningfully resolve the
question they belong to, so it has to be addressed first. Proceed to Step 2
(Priority 1 `unresolved_conflict` will fire), and set the new question's
`unblocks` to include the question whose plan is in flight, since resolving
the conflict re-enables that plan's progress.

## 2. Identify the highest-value question

Apply these priorities in order. When multiple candidates exist at the same
priority level, prefer the one that unblocks the most downstream questions.

| Priority | Trigger | `selection_basis` |
|----------|---------|-------------------|
| 1 | A conflict has `blocks_question_ids` entries | `unresolved_conflict` |
| 2 | The objective maps to an active hypothesis needing test | `hypothesis_test` |
| 3 | Timeline has high-severity gaps spanning census/vital years | `timeline_gap` |
| 4 | Objective not yet decomposed into sub-questions | `objective_decomposition` |
| 5 | Pedigree analysis reveals missing key data or inconsistencies | `objective_decomposition` |
| 6 | Direct evidence exhausted; pivot to Family/Associates/Neighbors | `fan_pivot` |
| 7 | A recently extracted assertion opens a new line of inquiry | `new_evidence` |

**Priority 3 detail:** Only fires when `severity == "high"`. Low-severity
timeline gaps do not trigger it.

**Priority 4 detail:** Each sub-question targets a single fact (one identity,
relationship, or event). Example decomposition of "Identify the parents of
Patrick Flynn": "Where was Patrick Flynn in the 1850 census?" / "What does
his death certificate say about his parents?" / "Did Thomas Flynn leave a
will naming his children?"

**Priority 6 detail:** Don't pivot to FAN just because one search returned
nil — pivot only when all planned direct searches are complete and
unresolved. If the primary question's `exhaustive_declaration.declared` is
`true`, the researcher has declared direct evidence exhausted: take that as
the FAN signal and do NOT propose additional direct-evidence paths. FAN
examples: "Who witnessed Thomas Flynn's land deeds?" / "Who were his
neighbors in the 1850 census?"

## 3. Formulate the question

See `references/question-formulation.md` for the three criteria (one
objective, named individual, testable scope) and examples.

Before formulating, verify the starting-point information is sound. Do not
build a question on unverified claims from compiled sources (online trees,
unsourced genealogies). If the premise is unverified, the first question
should verify it.

## 4. Write the question

Persisting the question is the point of this skill — describing it in prose
is not enough. Append it to `research.json` `questions[]` via
`research_append` (`op: "append"`), omitting `id` (the tool assigns the next
`q_NNN` and stamps `created`). Use exactly these field names:

```
research_append({
  projectPath: "<absolute-path-to-project-directory>",
  section: "questions",
  op: "append",
  entry: {
    question: "<one single-fact question>",
    rationale: "<why now — grounded in record availability/methodology>",
    selection_basis: "<the basis you chose from the Step 2 priority table>",
    priority: "<high | medium | low>",
    status: "open",
    depends_on: [], unblocks: ["q_001"],
    resolved: null, resolution_assertion_ids: [],
    exhaustive_declaration: { declared: false, justification: null, log_entry_ids: [], stop_criteria: null }
  }
})
```

The tool validates the whole project before writing and writes nothing on
failure; on `{ ok: false, errors }`, surface the errors and fix the entry —
do not retry the same payload blindly.

**Set dependency links:**
- `depends_on`: questions whose resolution enables or informs this question's
  research path. Include a question when either (a) it must be resolved
  before this one can be meaningfully pursued, or (b) this question's most
  efficient strategy relies on its specific findings (e.g. q_001 identified a
  household and the new question searches within it — include q_001 even if
  already resolved).
- `unblocks`: questions this one's resolution would enable or advance. High
  `unblocks` counts mark gatekeeper questions — prioritize them.
- When neither applies (e.g. a first question), set both explicitly to `[]`.

The `exhaustive_declaration` must be unstarted at creation (as shown above:
`declared: false`, empty `log_entry_ids`, null `stop_criteria`). Evaluating
exhaustiveness is the `research-exhaustiveness` skill's job, run after all
plan items complete.

## 5. Present

- The question selected and why (the rationale).
- What it depends on and what it unblocks.
- Suggest next step: "Would you like me to plan the research for this
  question?" (research-plan).

## Rules

- **One question at a time.** Each invocation produces at most one new question.
- **Finish what's open.** Don't introduce new questions while any open
  question's plan items are `in_progress` (see Step 1a).
- **Sound basis required.** Don't build questions on unsound assumptions —
  if the premise is unverified, verify it first.
- **Objectives vs. questions.** Never write an objective as a question;
  questions are narrow, single-fact, testable sub-problems.
- **Don't declare exhaustiveness here.** Closing questions is the
  `research-exhaustiveness` skill's job — this skill only creates them.
- **Never delete a question.** To retire one, `research_append`
  `op: "update"` its `status` (`superseded` / `answered`); the id is
  preserved. Never write a second `q_` for a question that already exists —
  update its status instead.
- **Historical context matters.** Factor in jurisdictional boundary changes,
  migration, wars, and record availability for the time and place.

## Edge cases

- **Fresh project, no clear gaps:** default to Priority 4 (decompose the
  objective into sub-questions).
- **All questions blocked:** identify the root blocker and formulate a
  question to resolve it — even if that means a conflict with no formal
  `conflicts[]` entry yet.
- **All plan items for a question complete:** run the priority ladder
  first. If direct evidence is exhausted — `exhaustive_declaration.declared`
  is true, or all planned direct searches are complete and unresolved —
  **Priority 6 fires: create a `fan_pivot` question** (FAN exhaustion comes
  before declaring the project reasonably exhaustive). Recommend
  `research-exhaustiveness` instead only when no Priority 1–6 signal applies
  (e.g. FAN avenues are themselves already worked).

## Re-invocation behavior

**Writes:** entries in the `questions` section of `research.json` (`q_` ids)
and their `status`, via `research_append`.

**On repeat invocation:** re-evaluate which question is next. Update an
existing question's `status` in place (`op: "update"` — e.g. mark it
`answered` or `superseded`; the id is preserved, never deleted), or select a
question already present. Add a new `q_` only when the next question isn't
already in the section — never write a second `q_` for the same question.
