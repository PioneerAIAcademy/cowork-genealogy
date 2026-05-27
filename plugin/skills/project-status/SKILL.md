---
name: project-status
model: claude-sonnet-4-6
description: Reads the current state of a genealogy research project and
  produces two summaries — a detailed GPS-state summary for experienced
  genealogists and a user-friendly narrative for casual users. Detects
  broken foreign keys, reports the recommended next step, and serves as
  the "resume project" skill when returning to existing work. Use when the
  user says "where are we?", "summarize progress",
  "status", "tell me the story", "what have we found?", when the user
  opens an existing project folder, or resumes a project that already
  has research progress. Do NOT use when no research.json exists in
  the folder (use init-project instead), when the user wants to start
  a new project (use init-project), when the user wants to choose or
  formulate the next research question (use question-selection), or when
  the user wants to execute a specific research step (use the appropriate
  skill directly).
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

This skill produces two outputs:

### 1. Detailed summary (for experienced genealogists)

Shows the GPS state of the project:
- Research objective
- Question status (open, in_progress, exhaustive_declared, resolved)
- GPS element progress per question (which of the 5 elements are met)
- Plan progress (active plans, completed/remaining items)
- Log statistics (total searches, positive/negative outcomes)
- Log diversity (record types searched, repositories consulted)
- Assertion count and classification breakdown
- Conflict status (unresolved, resolved)
- Hypothesis status (active, supported, ruled_out)
- Timeline gaps (high-severity)
- Exhaustiveness level (not assessable / preliminary / substantial / reasonably exhaustive)
- Conclusion readiness and recommended proof vehicle type
- Proof conclusions written and their tiers

### 2. User-friendly summary (for casual users)

Tells the story of the research so far:
- Who we're researching and why
- What we've found (in plain language)
- What the evidence says (conversational, not GPS jargon)
- What we're not sure about
- What the recommended next step is

Example: "We're looking for Patrick Flynn's parents. We've found
strong evidence that his father was Thomas Flynn — Patrick appears
in Thomas's household in 1850 and 1860, and his death certificate
names Thomas as his father. The main gap is that we haven't found
records between 1860 and 1908. Our next step should be searching
for Patrick in the 1870 census."

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

Assign one of four levels based on the criteria in
`references/project-exhaustiveness.md`:

- **Not yet assessable**: Fewer than 3 searches, or plan < 25% executed
- **Preliminary**: Some searching done but major record types or
  time periods unexplored
- **Substantial**: Most planned searches complete, multiple record
  types consulted, but gaps remain
- **Reasonably exhaustive**: All planned searches complete, multiple
  record types and repositories consulted, nil results documented,
  no obvious avenues left unexplored

Base the assessment on log diversity (record types, repositories,
time periods) and whether nil results were documented.

### 3c. Assess conclusion readiness

For each hypothesis at "supported" status, check the four conditions
in `references/conclusion-readiness.md`. Report whether each
condition is met or what is missing. If all four are met, recommend
a proof vehicle (statement, summary, or argument) based on the
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

**Format for the detailed summary:**

```
PROJECT STATUS: Identify the parents of Patrick Flynn (KWCJ-RN4)
Status: active | Created: 2026-05-01 | Updated: 2026-05-04

QUESTIONS (2)
  q_001  Who were Patrick's parents?           in_progress
         GPS: [x] search  [x] citations  [x] analysis  [x] conflicts  [ ] conclusion
  q_002  Where was Patrick in 1850 census?     resolved ✓
         GPS: [x] search  [x] citations  [x] analysis  [x] conflicts  [x] conclusion

PLANS
  pl_002  For q_001: 3 items, 2 completed, 1 in_progress

RESEARCH LOG
  5 searches performed (3 positive, 1 negative, 1 partial)
  Record types: census (3), vital records (1), cemetery (1)
  Repositories: FamilySearch, Ancestry, FindAGrave

EXHAUSTIVENESS: Substantial
  Searched: census, vital records, cemetery records
  Not yet searched: church records, land/probate, newspapers

EVIDENCE
  13 assertions | 4 sources
  Classification: 2 primary, 4 secondary, 7 indeterminate
  Person links: 5 confident, 1 probable, 0 speculative

CONFLICTS
  c_001  Birthplace (Ireland vs. Pennsylvania)  resolved ✓

HYPOTHESES
  h_001  Father = Thomas Flynn, Schuylkill Co.  supported
         Conclusion readiness: ready → proof summary recommended
  h_002  Father = Thomas Flynn, Luzerne Co.     ruled_out

TIMELINE GAPS
  1860–1908 (HIGH) — Missing: marriage, 1870-1900 censuses

PROOF CONCLUSIONS
  ps_001  q_001 parentage  tier: probable  vehicle: summary

WARNINGS: None

RECOMMENDED NEXT STEP:
  The timeline has a high-severity gap (1860-1908). Select a
  research question to investigate Patrick's life during this
  period. → question-selection
```

**Format for the user-friendly summary:**

Use confidence phrasing that matches the evidence strength (see
`references/conclusion-readiness.md`). Avoid GPS jargon like
"primary source" or "indirect evidence" — instead explain
reliability in plain language (e.g., "the census taker recorded
this at the time" rather than "this is primary information").

```
Here's where we stand on Patrick Flynn's research:

We're trying to identify Patrick's parents. The strongest
evidence points to Thomas Flynn of Schuylkill County as his
father — three different records support this:

• The 1850 census shows 5-year-old Patrick in Thomas's household
• The 1860 census explicitly lists Patrick as Thomas's "son"
• Patrick's 1908 death certificate names Thomas as his father

We resolved one conflict: the death certificate says Patrick was
born in Pennsylvania, but the census records say Ireland. We
concluded Ireland is correct because the census informants were
closer to the event than the death certificate's informant
(Patrick's son-in-law, reporting 63 years after the birth).

What's still missing: We have nothing on Patrick between 1860 and
his death in 1908 — no marriage record, no 1870/1880/1900 census
appearances. This is a big gap. We also haven't checked church
records, land records, or probate — any of these could provide
additional confirmation or new leads.

Our conclusion so far: Patrick was PROBABLY Thomas Flynn's son.
To upgrade this to PROVED, we need the 1870-1900 census records
and ideally Thomas Flynn's will or probate records.

Recommended next step: Search for Patrick in the 1870 census
for Schuylkill County, Pennsylvania.
```

### 6. Note about the research log viewer

A separate research log viewer tool (outside this plugin) will
provide full navigation of the research log and person-data files
with filtering, sorting, and visualization capabilities. This
skill provides the summary view; the viewer provides the
interactive exploration.

## Important rules

- **Always produce both summaries.** The detailed summary is for
  the GPS-aware user; the user-friendly summary is for everyone.
  Present the user-friendly one first, then the detailed one
  (which the user can expand or skip).
- **Never modify project files.** This skill is read-only. It
  reports state but doesn't change it.
- **Surface warnings prominently.** Broken foreign keys and other
  integrity issues should be visible at the top, not buried.
- **Be specific about next steps.** Don't just say "continue
  researching." Name the specific skill, the specific action, and
  ideally the specific record type or repository. Vague
  recommendations violate the GPS principle that research should
  be systematic and planned.
- **Recognize completed projects.** When all research questions
  are resolved AND proof conclusions have been written, status
  reporting is about what *is*, not what's next. Do not propose
  follow-up searches, re-examination of existing conclusions, or
  skill invocations. Replace the next-step section with a brief
  completion confirmation naming the final proof tier. A closed
  project's status report should read as a satisfying summary,
  not a to-do list.
- **Don't assume the user remembers the last session.** Cowork
  conversations start fresh. This skill provides the continuity
  between sessions via the project files.
- **Evaluate exhaustiveness honestly.** Do not claim research is
  exhaustive simply because all planned items are complete — the
  plan itself may have been too narrow. Cross-reference the log
  against what records actually exist for the locality and period.
- **Match confidence language to evidence.** In the user-friendly
  summary, use definitive phrasing ("proves," "establishes") only
  when the GPS is fully met. Use conditional phrasing ("strongly
  suggests," "highly probable") when evidence is good but gaps
  remain. Use tentative phrasing ("some evidence," "working
  hypothesis") when support is limited.
- **Distinguish clues from conclusions.** Information found in
  compiled genealogies, family trees, or user-contributed databases
  should be flagged as leads to verify, not as established facts.
- **Identify what would change the conclusion.** When presenting a
  hypothesis as "supported," note what evidence — if found — would
  strengthen, weaken, or overturn it. This helps the user
  understand what is at stake in the remaining research.
