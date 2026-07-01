---
name: project-status
description: Reads the current state of a genealogy research project and
  produces two summaries — a detailed GPS-state summary for experienced
  genealogists and a user-friendly narrative for casual users. Detects
  broken foreign keys and serves as the "resume project" skill when
  returning to existing work. Use when the user says "where are we?",
  "summarize progress", "status", "tell me the story", "what have we
  found?", "give me an overview", when the user opens an existing project
  folder, or resumes a project that already has research progress. Do NOT
  use when the user is asking what research question to pursue or add next
  (use question-selection), when no research.json exists in the folder
  (use init-project instead), when the user wants to start a new project
  (use init-project), or when the user wants to execute a specific
  research step (use the appropriate skill directly).
---

# Project Status

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Reads the full state of both project files and produces a summary
of where the research stands, what's been found, what remains, and
what the recommended next step is. This is the first skill that fires
when a user returns to an existing project.

## GPS Foundation

Project status measures progress toward meeting all five GPS elements
for each research question. A question is not "resolved" until all
five are satisfied:

1. Reasonably exhaustive search
2. Complete and accurate citations
3. Analysis and correlation
4. Conflict resolution
5. Soundly written conclusion

See `references/project-exhaustiveness.md` for how to assess
element 1. The other elements map directly to project data: sources
(element 2), assertions (element 3), conflicts (element 4), and
proof_summaries (element 5).

## Two summaries

This skill produces two outputs, presented user-friendly first:

1. **Detailed summary** (for experienced genealogists) — the GPS state
   of the project: objective, per-question status and which of the 5
   GPS elements are met, plan progress, log statistics and diversity,
   evidence classification, conflicts, hypotheses, timeline gaps,
   exhaustiveness level, conclusion readiness, and proof conclusions.
2. **User-friendly summary** (for casual users) — the story so far in
   plain language: who we're researching and why, what we've found,
   what the evidence says, what we're unsure about, and the next step.

The literal output shapes for both are in
`references/output-formats.md` — read it before presenting (step 5).

## Steps

### 1. Read project state

Read ALL sections of both files:
- `research.json`: project, questions, plans, log, sources,
  assertions, person_evidence, conflicts, hypotheses, timelines,
  proof_summaries
- `tree.gedcomx.json`: persons, relationships, sources

### 2. Check integrity

#### Broken foreign keys

Detect references that no longer resolve:
- `person_evidence.person_id` → person doesn't exist in
  tree.gedcomx.json
- `sources.gedcomx_source_description_id` → source doesn't exist
  in tree.gedcomx.json
- `project.subject_person_ids` → person doesn't exist in
  tree.gedcomx.json
- `timelines.person_ids` → person doesn't exist in tree.gedcomx.json

Surface these as warnings: "Warning: person_evidence entry pe_003
references person 'I9' which no longer exists in tree.gedcomx.json.
This may be due to a manual edit or a merge. Consider updating or
removing the reference."

#### Stale plans

Flag any active plan whose most recent item was created BEFORE the
newest log entry or assertion for that question. This suggests new
evidence was found that may require revising the plan. Research
plans should adapt to new discoveries — a plan that ignores newly
found information may be pursuing outdated leads.

### 3. Compute statistics

| Metric | How to compute |
|--------|---------------|
| Questions: open / in_progress / exhaustive / resolved | Count by status |
| Plans: active items remaining | Count plan items with status "planned" in active plans |
| Searches performed | Count log entries |
| Positive / negative / partial outcomes | Count by log outcome |
| Record types searched | Distinct record types across all log entries |
| Repositories consulted | Distinct repositories/collections across log entries |
| Nil results documented | Count log entries with outcome "negative" |
| Sources documented | Count sources[] entries |
| Assertions extracted | Count assertions[] entries |
| Assertions classified (primary/secondary/indeterminate) | Count by information_quality |
| Person links (confident/probable/speculative) | Count person_evidence by confidence |
| Conflicts: unresolved / resolved | Count by status |
| Hypotheses: active / supported / ruled_out | Count by status |
| Timeline gaps (high severity) | Count from timelines[].gaps where severity = "high" |
| Proof conclusions: by tier | Count proof_summaries by tier |

### 3b. Assess exhaustiveness level

Assign one of four levels — not assessable / preliminary / substantial
/ reasonably exhaustive — using the level definitions and the
five-dimension criteria in `references/project-exhaustiveness.md`. Base
it on log diversity (record types, repositories, time periods) and
whether nil results were documented.

### 3c. Assess conclusion readiness

For each hypothesis at "supported" status, check the four conditions
in `references/conclusion-readiness.md`. Report whether each
condition is met or what is missing. If all four are met, recommend
a proof conclusion form (statement, summary, or argument) based on the
signals described in that reference file.

### 4. Determine recommended next step

Apply this decision tree:

1. **Unresolved conflicts blocking questions?**
   → "Resolve conflict c_001 — it blocks questions q_003 and q_004."
   (conflict-resolution)

2. **Active plan with items status "planned"?**
   → If the plan is stale (see step 2 integrity check), recommend
   revising it first: "The plan predates recent findings. Review
   whether new evidence changes the approach." (research-plan)
   → Otherwise: "Continue executing the research plan — 3 of 5
   items remaining." (search-records or search-external-sites)

3. **Unlinked assertions exist?**
   → "Link the newly extracted assertions to persons."
   (person-evidence)

4. **Assertions linked but no timeline built/refreshed?**
   → "Build or refresh the timeline to identify gaps."
   (timeline)

5. **High-severity timeline gaps?**
   → "The timeline has a 48-year gap (1860-1908). Select a question
   to fill it." (question-selection)

6. **Hypothesis at "supported" with no proof conclusion?**
   Check conclusion readiness first (see 3c above). If ready:
   → "Hypothesis h_001 is supported — write the proof conclusion
   as a [statement/summary/argument]." (proof-conclusion)
   If not ready (e.g., exhaustiveness insufficient):
   → "Hypothesis h_001 is supported but research is not yet
   exhaustive — [specific gap]. Address this before writing a
   formal conclusion." (search-records or locality-guide)

7. **All plan items completed but exhaustive not declared?**
   → Check the five dimensions in `references/project-exhaustiveness.md`.
   If gaps exist: "All planned searches are complete, but
   [specific gap]. Consider expanding the plan." (research-plan)
   If no gaps: "Research appears reasonably exhaustive. Evaluate
   exhaustiveness formally." (research-exhaustiveness)

8. **Question at `exhaustive_declared` with no `proof_summaries`
   entry yet?**
   → "Question q_001 is exhaustively researched but has no proof
   conclusion. Write it as a [statement/summary/argument]."
   (proof-conclusion)

9. **All questions resolved?**
   → "All research questions are resolved. The project may be
   complete. Review the proof conclusions for appropriate
   confidence phrasing and completeness."

10. **Nothing obvious?**
   → "The project is active but no immediate next step is clear.
   You could: review the timeline for gaps, check if new questions
   are needed, or search additional repositories."

### 5. Present both summaries

Render both using the literal skeletons in
`references/output-formats.md` — the detailed GPS-state block and the
plain-language story. Present the user-friendly summary first, then the
detailed one. In the user-friendly summary, match confidence phrasing
to evidence strength (see `references/conclusion-readiness.md`) and
avoid GPS jargon — explain reliability plainly ("the census taker
recorded this at the time," not "this is primary information").

### 6. Note about the research log viewer

A separate research log viewer tool (outside this plugin) will
provide full navigation of the research log and person-data files
with filtering, sorting, and visualization capabilities. This
skill provides the summary view; the viewer provides the
interactive exploration.

## Important rules

- **Always produce both summaries**, user-friendly first, then the
  detailed one (which the user can expand or skip).
- **Never modify project files.** This skill is read-only — it reports
  state but doesn't change it.
- **Surface warnings prominently.** Broken foreign keys and other
  integrity issues belong at the top, not buried.
- **Recognize completed projects.** When all questions are resolved AND
  proof conclusions are written, status reporting is about what *is*,
  not what's next. Don't propose follow-up searches, re-examination, or
  skill invocations — replace the next-step section with a brief
  completion confirmation naming the final proof tier. A closed
  project's report should read as a satisfying summary, not a to-do
  list.
- **Don't assume the user remembers the last session.** Cowork
  conversations start fresh; this skill provides the cross-session
  continuity via the project files.
- **Evaluate exhaustiveness honestly.** Don't claim research is
  exhaustive just because all planned items are complete — the plan
  itself may have been too narrow. Cross-reference the log against what
  records actually exist for the locality and period (see
  `references/project-exhaustiveness.md`).
- **Distinguish clues from conclusions.** Information from compiled
  genealogies, family trees, or user-contributed databases is a lead to
  verify, not an established fact.
- **Identify what would change the conclusion.** When presenting a
  hypothesis as "supported," note what evidence — if found — would
  strengthen, weaken, or overturn it, so the user sees what's at stake
  in the remaining research.

## Re-invocation behavior

**Writes:** nothing. This skill reads `research.json` and
`tree.gedcomx.json` and renders a summary in-session — it does not
modify either file.

**On repeat invocation:** safe to run as often as needed. Each call is a
fresh read.

**Do not duplicate:** N/A — no writes.
