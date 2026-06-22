# Shorten: question-selection

**Bucket:** A (dead-mechanics removal) — but with a real selection-judgment core
**Primary owner:** both (developer strips id-alloc / post-validate / re-invocation
boilerplate; **genealogist signs off on the priority ladder and FAN-pivot judgment**)
**Current size:** 262 lines → **Target:** ~150–165 lines (~38% reduction)
**Tool migration:** **done** — calls `research_append` (`op:"append"` to create,
`op:"update"` to supersede). No post-write `validate_research_schema`.
**Still needed as a skill?** **Yes** — the priority ladder, the "finish what's
open" gate, and the FAN-pivot judgment are graded by validators *and* the rubric;
the tool only does clerical id-allocation.

## TL;DR
The tool now assigns the `q_NNN` id, stamps `created`, validates-before-persist,
and makes deletion structurally impossible (supersede via `status`). Cut the
verbose `research_append({...})` JSON blocks, the "supply without an id" / "tool
assigns the next id" narration, the post-write "no separate validation step"
paragraph, and the entire "Re-invocation behavior" section (its one real point —
supersede-not-delete — belongs in Rules as one line). **Do not touch** the
priority table, Step 1a (finish-what's-open), the FAN-pivot judgment, or the
unstarted-`exhaustive_declaration` rule — each backs a tag-gated validator.

## Why this skill is shortenable
`research_append` owns every clerical step the prose narrates: it allocates the
`q_` id, stamps `created`, runs full-project validation before writing, writes
atomically, and on `op:"update"` preserves the id (never deletes). The lines that
say "supply the entry without an `id` — the tool assigns the next `q_NNN`," "the
tool validates the whole project before writing," and "there is no separate
validation step" all describe guarantees the tool gives for free.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_question_selection.py`
  + universal):
  - `test_questions_no_deletions` — questions are cumulative; never removed
    (supersede via `status`). *(Tool enforces; don't re-derive, don't break the rule.)*
  - Tag-gated `selection_basis` checks — `objective_decomposition`,
    `unresolved_conflict`, `fan_pivot`, `timeline_gap` must each be set correctly
    for their tagged scenario.
  - `test_question_selection_no_new_question` — when in-progress plan items block
    new questions, **add no `q_`**.
  - `test_depends_on_nonempty` / `test_first_question_depends_on_empty` —
    dependency arrays populated correctly (or empty for a first question).
  - `test_new_question_exhaustive_declaration_unstarted` —
    `declared:false`, `log_entry_ids:[]`, `stop_criteria:null` at creation.
  - Universal: ownership table (writes only `questions`); FK integrity on
    `depends_on` / `unblocks` / `resolution_assertion_ids`.
- **Rubric dims** (`eval/tests/unit/question-selection/rubric.md`):
  1. *Prioritization logic* — selected `selection_basis` = highest-priority
     signal present; rationale explains why it beats the other candidates.
  2. *Question specificity* — concrete, single-fact, answerable.
  3. *Dependency awareness* — `depends_on` / `unblocks` populated when relevant,
     both explicitly `[]` when not.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** route to `search-records`
  (`negative-search-request`), `research-plan`, `research-exhaustiveness`,
  `project-status`, `search-external-sites` — i.e. "WHICH question" not "HOW to
  search," "is it done," "summarize," or "fetch a record."
- **Key test files:** `first-question-from-objective`,
  `prioritize-blocked-question`, `next-question-after-census`,
  `ut_question_selection_005`–`012`, and the five `negative-*` near-misses.

## CUT — safe to remove
- **[136–159] the full `research_append({...})` create block** — the schema
  documents `section` / `op` / `entry`. Keep at most a 2-line inline mention:
  "append the entry to `questions` via `research_append` (`op:"append"`); omit
  `id`." The example entry's field list (rationale, priority, depends_on…) is
  schema dup.
- **[133–135, 160–163] "supply the entry without an `id` — the tool assigns the
  next `q_NNN` and stamps `created`" + "the tool validates the whole project
  before writing… do not retry blindly"** — id-allocation and
  validate-before-persist are tool guarantees; state the `{ ok:false }` →
  surface-and-fix behavior **once**, briefly.
- **[184–186] Step 5's "`research_append` already validated… so there is no
  separate validation step"** — the post-write-validate removal is the whole
  point of the migration; don't re-explain its absence. Keep only the "present:
  what/why/depends/unblocks + suggest research-plan" bullets.
- **[232–261] "Re-invocation behavior"** — boilerplate ("Writes: … On repeat
  invocation … Do not duplicate") plus a second `research_append({...})` update
  block. Its one load-bearing point (supersede via `op:"update"` status, never a
  duplicate `q_`) becomes a single Rules line.

## KEEP — load-bearing judgment (do NOT cut)
- **§1a "Finish what's already open"** (incl. the blocking-conflict exception) —
  backs `test_question_selection_no_new_question` and the *Prioritization logic*
  dim. The exception (a blocking unresolved conflict overrides the in-progress
  gate) is genuinely subtle judgment; keep it (tighten prose).
- **§2 priority table + the three "detail" notes** (Priority 3 high-severity-only,
  Priority 4 single-fact decomposition, Priority 6 FAN-pivot threshold +
  exhaustive_declaration signal) — backs all four tag-gated `selection_basis`
  validators and the *Prioritization logic* rubric dim. **This table is why the
  skill exists.**
- **§3 question formulation + "verify the starting point" / unsound-premise rule**
  — backs *Question specificity* and the `unsound-premise` test.
- **Dependency-link guidance** (`depends_on` / `unblocks` semantics, incl.
  "include even if already resolved" and the empty-arrays case) — backs the two
  `depends_on` validators and the *Dependency awareness* dim.
- **The unstarted-`exhaustive_declaration` rule** (declared:false, empty
  log_entry_ids, null stop_criteria at creation) — backs
  `test_new_question_exhaustive_declaration_unstarted`. Can be one sentence;
  drop the literal object.
- **The supersede-not-delete rule** — state once (Rules): "Never delete a
  question; to retire one, `research_append` `op:"update"` its `status` to
  `superseded`/`answered` — the id is preserved."
- **"Don't declare exhaustiveness here" routing line** — boundary against
  research-exhaustiveness (negative test).

## TIGHTEN — keep the point, cut the words
- The supersede-not-delete rule appears in **three** places (Step note, Rules,
  Re-invocation). State it **once**.
- The FAN-pivot caution ("not after one nil result") is in both Priority 6 detail
  and Rules — keep it once, in the priority table.
- Edge cases (215–230) largely repeat the priority ladder and the
  exhaustiveness handoff — collapse to 2–3 lines (fresh project → Priority 4;
  all blocked → resolve the root blocker; plan complete → recommend
  research-exhaustiveness).

## Suggested target structure (~155 lines)
1. Frontmatter + Narration + reference-load line (keep both refs).
2. §1 read project state (tighten the bullet list).
3. §1a finish-what's-open + blocking-conflict exception (tighten prose).
4. §2 priority table + the three detail notes (keep nearly intact).
5. §3 formulate + verify-starting-point (keep).
6. §4 write: 2-line "append via `research_append`, omit `id`" + dependency-link
   guidance + the one-sentence unstarted-declaration rule + one-line
   `{ ok:false }` handling.
7. §5 present (3 bullets).
8. Rules (dedup; fold in supersede-not-delete and "don't declare here").
9. Edge cases (collapsed to 2–3 lines).

## Verify
```
cd eval/harness && uv run python run_tests.py --skill question-selection
```
Watch the four tag-gated `selection_basis` validators, the no-new-question and
depends_on validators, and the unstarted-declaration validator. Confirm all five
negative near-misses still route away (search-records / research-plan /
research-exhaustiveness / project-status / search-external-sites) and the three
rubric dims pass.

## Owner notes
**Developer** safely cuts the JSON blocks, the id-alloc / validate-before-persist
narration, the post-write-validate paragraph, and the Re-invocation section.
**Genealogist** owns the priority table, §1a (incl. the conflict exception), and
the FAN-pivot threshold — these are craft and they back the tag-gated validators
and the *Prioritization logic* dim; a mechanical pass must not flatten them.

*Rubric-review item (do NOT act on here):* the rubric is clean — no post-write
validate language. Nothing to flag.
