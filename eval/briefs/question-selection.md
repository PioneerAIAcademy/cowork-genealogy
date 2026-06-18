# Deep-Dive Brief — `question-selection`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Genealogical-judgment-heavy, fixture-light. The day is spent reasoning about *which* question wins under the 7-level priority ladder and the "finish what's open" override — not authoring fixtures. One `validate_research_schema` call; no MCP fixtures.
**Files:** SKILL.md (228 lines) · references ×3 (262 lines) · tests ×4 · rubric ✓ (27 lines).

## What this skill does
GPS Step 1 (Reasonably Exhaustive Research). Reads all sections of `research.json` plus `tree.gedcomx.json` and selects the *next* research question, **writing one new `q_` entry** (or updating an existing question's `status`) — at most one per invocation. It applies a 7-priority ladder (`unresolved_conflict` > `hypothesis_test` > `timeline_gap` > `objective_decomposition` > pedigree gaps > `fan_pivot` > `new_evidence`), sets `depends_on`/`unblocks` links, and leaves the new question's `exhaustive_declaration` unstarted. Two key invariants: **finish-what's-open** (do not add a question while any open question has `in_progress` plan items — unless a `blocks_question_ids` conflict overrides), and **never declare exhaustiveness here**. It calls `validate_research_schema` after writing.

## Where everything lives
- `plugin/skills/question-selection/SKILL.md`
- `plugin/skills/question-selection/references/pedigree-analysis.md` (125 lines — gap detection)
- `plugin/skills/question-selection/references/question-formulation.md` (123 lines — three question criteria)
- `plugin/skills/question-selection/references/validation-protocol.md` (14 lines)
- `eval/tests/unit/question-selection/` — `next-question-after-census.json`, `first-question-from-objective.json`, `prioritize-blocked-question.json`, `negative-search-request.json`, `rubric.md`
- Scenarios used: `mid-research-flynn`, `empty-project-just-created`, `flynn-multi-conflict`

## Current tests (4)
| id | covers | type |
|----|--------|------|
| ut_question_selection_001 | "What next?" with an in-flight plan → recommend finishing it, add NO new question (finish-what's-open path) | positive |
| ut_question_selection_002 | Empty question list → derive the FIRST question from the objective (`objective_decomposition`) | positive |
| ut_question_selection_003 | Multi-conflict project → select a question addressing an unresolved conflict (conflict-driven) | positive |
| ut_question_selection_004 | "Find a 1860 census record for Patrick Flynn" → routes to `search-records` | negative |

> Coverage shape: good selection-*basis* variety (objective-decomposition, conflict-driven, finish-in-progress). But the headline **FAN-pivot trigger** (`fan_pivot` — direct evidence exhausted, pivot to associates/neighbors) named prominently in the description has **no test**. Of four named neighbors, only `search-records` has a negative.

## Gaps — new tests to add
**Positive (priority levels not yet exercised):**
- **FAN-pivot selection** (`fan_pivot`, Priority 6) — a scenario where all planned direct searches are complete and unresolved; the skill must produce an associates/neighbors question (e.g. "Who witnessed Thomas Flynn's land deeds?"). The description's flagship case, currently untested.
- **Timeline-gap selection** (`timeline_gap`, Priority 3) — a high-severity census/vital-year gap that outranks a pending decomposition.
- **Dependency links** — a project with prior questions where the new question must populate `depends_on`/`unblocks` correctly (directly exercises the rubric's Dependency-awareness dimension).
- **Unsound-premise guard** — premise rests on an unsourced online tree; the first question should *verify the premise* rather than build on it.

**Negative (boundaries from the description):**
- → `research-plan`: "I want to find Thomas Flynn's probate record — what records should I search and in what order?" (user has the question, wants the plan).
- → `research-exhaustiveness`: "Have we searched enough on the parentage question — can we declare it done?"
- → `project-status`: "Give me a summary of where this project stands."
- → `search-records` / `search-external-sites`: **already covered** by ut_004 (search-records). An external-sites variant ("search Ancestry for…") would round it out.

## ⚠️ Known issues
- None blocking. The three easiest-to-confuse neighbors (`research-plan`, `research-exhaustiveness`, `project-status`) are all untested boundaries — adding those negatives is the highest-value polish, since the description's whole "Do NOT use" clause exists to fence them off.

## Fixture work
Fixtures are **light/none** — `validate_research_schema` is the only allowed tool and it isn't mocked via the MCP fixture corpus. All four new tests are scenario-only: the FAN-pivot and timeline-gap cases need a scenario with completed-and-unresolved plan items / a high-severity timeline gap (extend an existing Flynn scenario or add a stub), and the dependency-links and unsound-premise cases likewise pre-load the relevant `research.json` state. No `eval/fixtures/mcp/` work.

## Definition of done
Add the FAN-pivot + timeline-gap + dependency-links + unsound-premise positives → add the `research-plan` / `research-exhaustiveness` / `project-status` negatives (search already covered) → confirm the rubric's three dimensions are exercised → full harness pass + CRUD review + PR.
