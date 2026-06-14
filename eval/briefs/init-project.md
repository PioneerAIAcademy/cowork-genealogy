# Deep-Dive Brief — `init-project`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Both. The day is mostly rubric work — the 11-line rubric grades only one dimension (stub quality) for a skill that does five things — plus one missing `place_search` fixture. Genealogical judgment is light (it's GPS Steps 1–2, the preliminary survey); MCP mechanics are real but well-fixtured for the tree/search paths.
**Files:** SKILL.md (469 lines) · references ×4 (346 lines) · tests ×4 · rubric ✓ (11 lines — unusually thin).

## What this skill does
GPS Steps 1–2 (define the problem + survey known information). Initializes a **new** project: writes `research.json` (the GPS audit trail) and `tree.gedcomx.json` (the simplified-GedcomX deliverable) seeded from a FamilySearch person. Three entry paths: from a person ID (`person_read`), from objective text only (local stub, no tool call), or by name when the user has no ID (`person_search` → user picks → `person_read`). It also runs a two-question researcher-profile interview (experience level + subscriptions) and writes `researcher_profile` with derived `narration_guidance`, calls `place_search` to standardize any place it enters by hand, and `validate_research_schema` at the end. **Key invariant: it refuses if a `research.json` already exists** — single-line decline, no tool calls, routes to project-status/question-selection. Imported tree data is sourced to `S1` at `quality: 1` (questionable), never silently "corrected."

## Where everything lives
- `plugin/skills/init-project/SKILL.md`
- `references/places-guidance.md` (81 — place standardization), `research-process-init.md` (131 — GPS Steps 1–2 detail), `simplified-gedcomx-summary.md` (120 — the tree.gedcomx.json shape), `validation-protocol.md` (14 — post-write validation)
- `templates/research.json` — the seed document
- `eval/tests/unit/init-project/` — `new-project-from-tree.json`, `from-objective-only.json`, `negative-add-question.json`, `new-project-from-search.json`, `rubric.md`
- Scenarios: positives start from an **empty** folder (no scenario); the negative uses `mid-research-flynn`. Fixtures: `person-read-flynn`, `person-search-flynn`.

## Current tests (4)
| id | covers | type | fixtures |
|----|--------|------|----------|
| ut_init_project_001 | Init from a FS person ID + full objective; stub person + empty sections seeded | positive | person-read-flynn |
| ut_init_project_002 | Init from objective text only, no tree ID (minimal stub, e.g. Sarah Hennessy) | positive | — |
| ut_init_project_003 | "Add a question" on an existing project → must NOT init; route to question-selection | negative | — |
| ut_init_project_004 | Init by searching the tree when no ID given (search → read → init in one turn) | positive | person-search-flynn, person-read-flynn |

> **Coverage shape is healthy on paths, thin on dimensions.** All three init entry paths are covered and the sole named neighbor (project-status) is already exercised as the negative — so negatives are nearly complete. The work concentrates on the rubric, not new positives.

## Gaps — new tests to add
**Positive:**
- **Hand-entered place standardization via `place_search`** — `place_search` is in `allowed-tools` but has **no fixture and no test**; an objective with a place the stub must standardize (e.g. "born in Boston") should force a `place_search` call and a populated `standard_place`. This is the one untested tool.
- **researcher_profile interview** — no test asserts the two-question interview maps answers to `experience_level` + normalized `subscriptions` + verbatim `narration_guidance`; add a multi-turn test (or assert the single-turn `intermediate`/`none` default path explicitly).
- **Person with no relatives** — `person_read` returns an isolated person; confirm the project still initializes and the isolation is flagged (FAN guidance).

**Negative (boundaries from the description):**
- → `project-status`: "Start research" / "where are we?" on a folder that **already** has a `research.json` — the only neighbor named, currently covered only by the "add a question" phrasing (ut_003). Add a second variant where the user says "start research" so the refuse-if-exists invariant is tested against init-flavored wording, not just question-flavored.

## ⚠️ Known issues
- **Rubric grades one dimension for a five-job skill.** The 11-line rubric covers only stub-person quality. Missing: correct empty-section seeding, the simplified-GedcomX shape of `tree.gedcomx.json` (S1 source at `quality: 1`, local `I` IDs), the researcher_profile interview/normalization, and place standardization.
- **`place_search` declared but unfixtured** — flagged warn-only by `check_tool_coverage.py`; no test ever drives it.
- **Refuse-if-exists tested once, one phrasing** — one negative covers the invariant; init-flavored wording ("start research") on an existing project is untested.

## Fixture work
The tree and search paths are fully fixtured (`person-read-flynn`, `person-search-flynn`). Net-new: a `place-search-*` fixture for the hand-entered-place test (or reuse an existing `place-search-boston`-style fixture if one is added). The interview test needs no MCP fixture — only multi-turn user answers. `validate_research_schema` already has a fixture.

## Definition of done
Expand the rubric to grade tree shape + section seeding + interview normalization + place standardization → add the `place_search` fixture and its positive → add the no-relatives positive + the init-flavored refuse negative → full harness pass + CRUD review + PR.
