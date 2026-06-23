# Shorten: project-status

**Bucket:** B (craft compression) — read-only recommender, no new tool to lean on
**Primary owner:** genealogist (developer assists with structure)
**Current size:** 379 lines → **Target:** ~260–280 lines (~28% reduction)
**Tool migration:** **n/a** — no new tool. project-status is read-only; it isn't
in `docs/specs/skill-rewrites-for-persistence-tools-spec.md` §4 and calls **no**
research MCP tools at all (the validator allows only `validate_research_schema`).
**Still needed as a skill?** **Yes** — it's the "resume an existing project" /
"where are we?" entry point and the v1 stand-in for an orchestrator (per
`docs/specs/skill-architecture-spec.md` §2 "Why there is no orchestrator skill
in v1"). The next-step recommendation is its reason to exist.

## TL;DR
Bucket-B, so the win is smaller and craft-gated — there's no tool whose
mechanics you can delete. The cuts are **redundancy and boilerplate**: the
"Important rules" section largely re-states rules already stated in the Steps;
the two long worked-example transcripts (detailed + user-friendly) can each
shrink to a short skeleton; "Re-invocation behavior" is boilerplate. **Keep**
the next-step decision tree (Actionability), the read-only rule (validator), the
both-summaries requirement (Completeness), and the completed-project handling
(graded by `completed-project-summary`).

## Why this skill is shortenable
The file states each load-bearing rule two or three times. "Never modify project
files," "be specific about next steps," "produce both summaries," and "recognize
completed projects" all appear once in the Steps and again, expanded, under
"Important rules." The statistics table (Step 3) and the GPS-element checklist
(Two summaries) partly restate each other. And two full sample reports (~90
lines combined) demonstrate format that a short skeleton conveys just as well —
the judge grades the *content* (counts, statuses, next step), not whether the
skill reproduced a 40-line ASCII box. None of the duplication changes the
transcript the judge sees.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_project_status.py`
  + universal):
  - `test_no_mcp_tools_called` — must call **no** MCP tool except
    `validate_research_schema`. (Keep "read-only.")
  - `test_research_json_unmodified` / `test_tree_gedcomx_unmodified` — both files
    byte-identical before/after on positive tests. (Keep "never modify project
    files.")
  - Universal `test_ownership_table` — project-status is **absent** from the
    ownership table, so any research.json write fails. Reinforces read-only.
- **Rubric dims** (`eval/tests/unit/project-status/rubric.md`):
  1. *Completeness of summary* — touches **every** GPS element present, names
     empty sections explicitly.
  2. *Accuracy* — counts/statuses/next-step match `research.json` exactly.
  3. *Actionability* — a **specific** next step with reasoning that references
     real state, not "continue research."
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary test:** `negative-proof-writing.json`
  (`ut_project_status_004`) — "write the proof statement" must route to
  **proof-conclusion**, not return a status-shaped summary. Makes the
  status-vs-proof boundary load-bearing.
- **Key test files:** `mid-project-summary.json` (exact counts: 2 q / 2 plans /
  5 log / 4 sources / 13 assertions / 6 person_evidence / 1 conflict / 1 hyp /
  1 timeline / 1 ps@probable; next step = finish pli_006 probate),
  `blocked-by-conflicts.json` (name c_001 + c_002 as blockers of q_001;
  distinguish fact- vs identity-conflict), `completed-project-summary.json`
  (report `completed` + `proved`, treat the negative probate as exhaustive-story
  not a gap, **propose no new research**), `negative-proof-writing.json`.

## CUT — safe to remove
- **[370–379] "Re-invocation behavior"** — boilerplate ("Writes: nothing");
  the read-only rule is already in Important rules and the validator enforces it.
  **(~10 lines)**
- **[230–277] the detailed-summary ASCII sample report** — ~48 lines of format
  demonstration. Collapse to a ~12-line skeleton showing the section headers and
  one example line each (QUESTIONS with a GPS-element checkbox row, RESEARCH LOG
  with counts, EVIDENCE counts, CONFLICTS, RECOMMENDED NEXT STEP). The judge
  grades the counts/statuses, not the box-drawing. **(~35 lines saved)**
- **[287–316] the user-friendly sample report** — ~30 lines of prose example.
  Keep the short Example already at lines 75–84 ("We're looking for Patrick
  Flynn's parents…") as the single model; cut the second full transcript or trim
  it to ~6 lines. **(~24 lines saved)**
- **[318–324] "Note about the research log viewer"** — out-of-scope aside about
  a tool outside this plugin; grades nothing. **(~7 lines)**

## KEEP — load-bearing judgment (do NOT cut)
- **Step 4 next-step decision tree (167–225)** — this *is* the Actionability dim
  and the skill's whole purpose. Keep all ten branches; they map to specific
  recommendations the rubric rewards (and the `mid-project` / `blocked` tests
  exercise the conflict-blocker and active-plan branches). Tighten wording, not
  branches.
- **"Recognize completed projects" rule (341–348)** — graded directly by
  `completed-project-summary` ("propose no new research; the report reads as a
  summary, not a to-do list"). Keep.
- **Read-only rule (332–334, 372)** — validator + ownership-table floor. State
  **once**, keep it.
- **Both-summaries requirement (46–84, 328–331)** — Completeness dim ("user-
  friendly first, then detailed"). Keep the requirement; the examples can shrink
  (see CUT).
- **Broken-foreign-key detection (98–113)** — distinctive read-only value
  (project-status is the integrity checker); the description advertises it.
  Keep; tighten the warning-message example to one line.
- **Statistics to report (Step 3 table, 124–141)** — backs the Accuracy dim
  (exact counts). Keep the table; it's already compact.
- **Routing boundary** — the description's "Do NOT use … (use question-selection
  / init-project / proof-conclusion)" plus the `negative-proof-writing` behavior.
  Keep one line in the body reinforcing status-vs-proof-conclusion.

## TIGHTEN — keep the point, cut the words
- **"Important rules" (326–368)** restates Steps 4–5: be-specific-about-next-steps
  (= Step 4), produce-both-summaries (= Two summaries), never-modify (= Step 5
  read-only), recognize-completed (keep). Fold the duplicates into their Steps
  and keep "Important rules" to the genealogical-judgment ones that have no
  earlier home: *evaluate exhaustiveness honestly*, *match confidence language to
  evidence*, *distinguish clues from conclusions*, *identify what would change the
  conclusion*. Those are real craft (and feed the user-friendly Accuracy), not
  duplication.
- The exhaustiveness-level (3b) and conclusion-readiness (3c) subsections each
  re-summarize a `references/` doc they point at — keep the pointer + the
  4-level / 4-condition list as a one-liner each; don't re-explain the reference.

## Suggested target structure (~270 lines)
1. Frontmatter + Narration line.
2. 2-sentence purpose (read-only resume/where-are-we; the v1 next-step
   recommender) + one-line status-vs-proof-conclusion boundary.
3. GPS-foundation (5 elements) — keep, it's short.
4. Two summaries: the element checklist + the *one* short user-friendly example.
5. Steps 1–3 (read state, integrity incl. broken FKs + stale plans, statistics
   table, exhaustiveness/readiness one-liners).
6. **Step 4 next-step decision tree — kept whole.**
7. Step 5 present both summaries — one compact detailed skeleton, no second full
   transcript.
8. Trimmed "Important rules" (the genealogical-judgment ones + completed-project
   + read-only, stated once each).

## Verify
```
cd eval/harness && uv run python run_tests.py --skill project-status
```
Watch: all three rubric dims pass on `mid-project-summary` (exact counts +
specific pli_006 next step) and `blocked-by-conflicts` (names both conflicts as
blockers); `completed-project-summary` still proposes no new research; both
read-only validators and `test_no_mcp_tools_called` stay green; and
`negative-proof-writing` still routes to proof-conclusion.

## Owner notes
This is genealogist-led because the value is judgment, not mechanics — be candid
in review that the percentage cut is modest (it's bucket B: no tool to delete
prose for). The safe **developer** cuts are the two sample-report transcripts,
the log-viewer aside, and Re-invocation boilerplate. The **genealogist** owns the
decision tree, the exhaustiveness/confidence rules, and the completed-project
handling — don't let a mechanical pass flatten the next-step branches or the
honest-exhaustiveness rule, which are exactly what the Actionability and Accuracy
dims reward.
