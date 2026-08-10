---
name: question-selection
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

- **Objective** — the overarching goal, and the **scope boundary**. Every
  question must trace back to it and none may reach outside it (Step 1c).
- **Open questions** (`open` / `in_progress`) and **in-progress plan items**
  (`plan_items[].status == "in_progress"` on an open question — in-flight
  research the user has already committed to).
- **Resolved questions** — what has been answered.
- **Pedigree gaps** — individuals missing a name, specific date, or
  county/parish-level locality (see `references/pedigree-analysis.md`). That
  reference sweeps the **whole tree**, so its output is a candidate list, not
  a work list: discard every gap outside the objective's scope before it
  reaches Step 2 (Step 1c).
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

### 1b. Stop when the objective is already answered at a defensible tier

Gate new-question creation on **answered**, not **proved.** Once every
*independent* part of the objective is `resolved` with a `proof_summary` at a
defensible tier (`probable` or better), the objective is answered — that is
the autonomous stop point. Do **NOT** spawn a new question to **corroborate**
or upgrade the tier of a part already concluded (a second source to move
`probable` → `proved`): that is optional corroboration, not required for
autonomous completion, and chasing it after the answer is already in the tree
is what runs an autonomous session out of its budget. Return the "no further
questions — objective answered" signal so `/research` writes
`project.status = "completed"` and stops.

This applies **only** to corroboration of a fact **already concluded** at a
defensible tier. It does **not** suppress any of: a **genuinely independent,
still-open** part of the objective (a death *and* a burial are two independent
facts — answer both); a **Priority 1** unresolved conflict; or a **Priority 6
FAN pivot** when a question's direct evidence is exhausted *without* a
defensible answer — that question is unresolved, so FAN is the legitimate next
step, not tier-chasing. The line: any *unanswered* objective fact → select the
appropriate question (decompose, or FAN-pivot when direct evidence is spent);
another source for a fact *already concluded* at a defensible tier → stop.

### 1c. Match the question's scope to the objective's — neither narrower nor wider

The question is the framing the user is asked to confirm, so it must be
recognizable as what they asked for. Screen every candidate for both scope
errors below before Step 2.

**Not narrower — a record is not a question, where the question stands in for
the objective.** When nothing in `questions[]` covers the objective yet, the
question you write *is* the user's framing, and which record set answers it is
`research-plan`'s call, not yours. "Where was Reuben Smith in the 1900
census?" is then a plan item in a question's clothing: it commits the project
to one census before anyone has asked whether the census is the best source,
and a question scoped to one record invites a search scoped to one record.
Name the fact sought — "Who were the parents of Reuben Smith, b. ~1850,
Ohio?" — and let the plan name the census.

**Scope is not granularity.** "Never write an objective as a question" (see
Rules) forbids restating a **multi-fact** objective ("Reconstruct the Flynn
family"), which names no single testable fact. It does *not* require the first
question to be narrower than the objective. When the objective is already a
single fact ("Identify the parents of Patrick Flynn, born ca. 1845 in
Pennsylvania"), that objective **is** the first question: restate it with the
identifying detail the three criteria require and stop. Decompose only an
objective that genuinely holds more than one independent fact.

**Once a question at the objective's scope exists, narrower is correct.** The
two rules above govern only the question that stands in for the objective;
they do not freeze the project there. When `questions[]` already holds an open
question at the objective's scope, your job is the next **sub-question beneath
it**, and that one is legitimately narrower — a premise to verify (Step 3 and
the "Sound basis required" rule), a specific source to test, a decomposed
part. Naming a record is right there: "What does Patrick Flynn's 1908 death
certificate say about his parents?" *tests* a premise and does not replace the
objective, because the objective-level question already holds that ground.
"A question at the objective's scope already exists" is **not** a reason to
add nothing — the only stop condition is Step 1b's answered-at-a-defensible-
tier test.

**Not wider — appearing in the tree does not put a person in scope.** On
"identify the parents of X", X's spouse and children are out of scope: their
own missing dates, marriages, and records are a *different* objective, however
incomplete the pedigree sweep makes them look. Select a question about a
relative only when its answer is evidence about **the objective's subject**
(Priority 6 FAN pivot, under its exhaustion gate) — never to complete that
relative's own record. If the tree convinces you the objective should be wider,
say so and ask the user to change it; don't widen it yourself.

## 2. Identify the highest-value question

Apply these priorities in order. When multiple candidates exist at the same
priority level, prefer the one that unblocks the most downstream questions.

| Priority | Trigger | `selection_basis` |
|----------|---------|-------------------|
| 1 | A conflict has `blocks_question_ids` entries | `unresolved_conflict` |
| 2 | The objective maps to an active hypothesis needing test | `hypothesis_test` |
| 3 | Timeline has high-severity gaps spanning census/vital years | `timeline_gap` |
| 4 | Objective not yet decomposed into sub-questions | `objective_decomposition` |
| 5 | Pedigree analysis reveals missing key data or inconsistencies **within the objective's scope** | `objective_decomposition` |
| 6 | Direct evidence exhausted; pivot to Family/Associates/Neighbors | `fan_pivot` |
| 7 | A recently extracted assertion opens a new line of inquiry | `new_evidence` |

**Priority 3 detail:** Only fires when `severity == "high"`. Low-severity
timeline gaps do not trigger it.

**Priority 4 detail:** This priority still fires for the first question on a
single-fact objective, and `objective_decomposition` remains the correct
`selection_basis` — but there the "decomposition" is **one** question at the
objective's own scope, not a narrower one (Step 1c). Split into several
sub-questions only when the objective holds more than one independent fact.
Each sub-question targets a single fact (one identity, relationship, or event)
and names **that fact, never the record that might carry it**. Example
decomposition of the multi-fact
objective "Reconstruct the family of Thomas Flynn of Schuylkill County":
"Whom did Thomas Flynn marry?" / "Which children were born to Thomas Flynn
and his wife?" / "When and where did Thomas Flynn die?" The record choices
for each ("the 1850 census", "his death certificate", "a will") belong in
that question's plan, not in the question.

**Priority 5 detail:** The sweep in `references/pedigree-analysis.md` covers
the whole tree, so filter its output through Step 1c before acting on it — a
gap on the subject's spouse or child is not a Priority 5 signal. This
priority's `selection_basis` is `objective_decomposition`, which is only
honest if the gap you selected actually decomposes the objective.

**Priority 6 detail:** Don't pivot to FAN just because one search returned
nil — pivot only when all planned direct searches are complete and
unresolved. If the primary question's `exhaustive_declaration.declared` is
`true`, the researcher has declared direct evidence exhausted: take that as
the FAN signal and do NOT propose additional direct-evidence paths. A FAN
question still obeys Step 1c — name the cluster by person, place, and period,
and its answer must be evidence about the objective's subject. Examples: "Who
witnessed Thomas Flynn's land transactions in Schuylkill County?" / "Who were
Thomas Flynn's neighbors in Schuylkill County in 1850?" (the deeds and the
census are how the *plan* answers these).

## 3. Formulate the question

See `references/question-formulation.md` for the three criteria (one
objective, named individual, testable scope) and examples.

Apply Step 1c as you write. Some examples in that reference are phrased
record-first ("What does John Smith's 1870 death certificate say about his
parents?") — that is a **plan item**, not a question. Use the reference for its
three criteria and Common Failures table, but phrase the question around the
fact: "Who were the parents of John Smith, b. ~1820, Greene County, Ohio?"

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

**Never report only the id** — "q_001 written." has no referent for a user who
cannot see `research.json`. Always give:

- **The question in full, quoted as written.** This is the wording the user is
  confirming, and the one thing they can check against what they asked for.
- **Its id, glossed on first use** — "saved as `q_001` (this project's label
  for it, so we can refer back)".
- **What a research question is, the first time one is created in a project** —
  one sentence against the objective: the objective is the project's overall
  goal; the question is the single fact pursued next, which may be the
  objective itself when that is already one fact (Step 1c).
- Why this question now (the rationale), and what it depends on / unblocks —
  naming any other `q_` by its question text, not by id alone.
- **Next step in plain language, as an offer:** "Would you like me to work out
  which records to search for this?" Name what happens, not the skill that does
  it — a first-time user has never heard of `research-plan`.

## Rules

- **One question at a time.** Each invocation produces at most one new question.
- **Finish what's open.** Don't introduce new questions while any open
  question's plan items are `in_progress` (see Step 1a).
- **Sound basis required.** Don't build questions on unsound assumptions —
  if the premise is unverified, verify it first.
- **Objectives vs. questions.** Never write a **multi-fact** objective as a
  question — questions are single-fact and testable. But a single-fact
  objective already *is* one: restate it, don't narrow it, and never narrow it
  to a record. See Step 1c.
- **Stay inside the objective's scope.** No question about a person the
  objective does not cover — a spouse's or child's own missing facts are a
  different objective — except a Priority 6 FAN pivot whose answer is evidence
  about the objective's subject. See Step 1c.
- **Don't declare exhaustiveness here.** Closing questions is the
  `research-exhaustiveness` skill's job — this skill only creates them.
- **Never delete a question, and never change an existing question's `status`
  here.** `question_status` ∈ `open` | `in_progress` | `exhaustive_declared` |
  `resolved`. This skill owns none of those transitions —
  `exhaustive_declared` is `research-exhaustiveness`'s, `resolved` is
  `proof-conclusion`'s — so there is no way to retire a question here, and none
  is needed: an overtaken question stays as it is. Never write a second `q_` for
  a question that already exists.
- **Historical context matters.** Factor in jurisdictional boundary changes,
  migration, wars, and record availability for the time and place.

## Edge cases

- **Fresh project, no clear gaps:** default to Priority 4. If the objective
  holds several independent facts, decompose it into sub-questions; if it is
  already a single fact, the first question is that objective restated with
  identifying detail — not a narrower record-scoped one (Step 1c).
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

**Writes:** new entries in the `questions` section of `research.json` (`q_`
ids), via `research_append`. Not their `status` after creation — see the Rules
above.

**On repeat invocation:** re-evaluate which question is next, and either select
a question already present or add a new `q_` when the next question isn't
already in the section — never write a second `q_` for the same question, and
never revise an existing question's `status`.
