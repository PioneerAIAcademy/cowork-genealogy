# Deep-Dive Brief — `init-project`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Both. The day is mostly rubric work — the 11-line rubric grades only one dimension (stub quality) for a skill that does five things — plus one missing `place_search` fixture. There is also one **outstanding feature change**: wiring a "what do you already have?" holdings survey that writes the new `known_holdings` section (its schema has already landed; only the SKILL.md + tests remain — see the dedicated section below). Genealogical judgment is light (it's GPS Steps 1–2, the preliminary survey); MCP mechanics are real but well-fixtured for the tree/search paths.
**Files:** SKILL.md (469 lines) · references ×4 (346 lines) · tests ×4 · rubric ✓ (11 lines — unusually thin).

## What this skill does
GPS Steps 1–2 (define the problem + survey known information). Initializes a **new** project: writes `research.json` (the GPS audit trail) and `tree.gedcomx.json` (the simplified-GedcomX deliverable) seeded from a FamilySearch person. Three entry paths: from a person ID (`person_read`), from objective text only (local stub, no tool call), or by name when the user has no ID (`person_search` → user picks → `person_read`). It also runs a two-question researcher-profile interview (experience level + subscriptions) and writes `researcher_profile` with derived `narration_guidance`, calls `place_search` to standardize any place it enters by hand, and `validate_research_schema` at the end. **Key invariant: it refuses if a `research.json` already exists** — single-line decline, no tool calls, routes to project-status/question-selection. Imported tree data is sourced to `S1` at `quality: 1` (questionable), never silently "corrected."

The survey is today **FamilySearch-only**: it reads the collaborative tree but never inventories the researcher's *own* holdings — documents, prior research, GEDCOMs, living-relative knowledge. Closing that gap (the `known_holdings` survey) is the one feature change folded into this brief.

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

## Feature change — known-holdings survey

**Why.** `init-project` owns GPS Step 2 (*survey known information*) but the survey is FamilySearch-only. The researcher's own holdings — the family Bible, certificates in a drawer, a prior GEDCOM, courthouse-trip notes, living-relative memory — are never deliberately collected. Consequences: we may re-search FamilySearch for a death date the user already holds; prior research stays invisible to `question-selection` / `research-plan`; oral leads (the cheapest, most perishable source) never surface. This is a content gap in one skill, not a missing skill — gathering has nowhere to persist except the two files `init-project` already creates, so it stays here rather than splitting out.

**Landed precondition — the `known_holdings` schema.** Already in place across the four required sites; the SKILL just has to write conforming entries:
- `docs/specs/research-schema-spec.md` §5.1.2 (entry table) + §2 enums (`holding_type`, `holding_confidence`) + §3 ID prefix (`kh_`) + ownership row.
- `docs/specs/schemas/research.schema.json` `$defs/known_holding` (optional top-level array) and `enums.schema.json` enums.
- `packages/schema/` — mirrored `KnownHolding` TS type + `known_holdings?` on `ResearchData`, and the same `research.schema.json` / `enums.schema.json` additions (the viewer/web/server copy).
- `packages/engine/mcp-server/src/validation/validator.ts` — structural + enum checks, `kh_` prefix, and a cross-file `relates_to_person_ids` person check.

Entry shape: `id` (`kh_`), `holding_type` (`document`, `prior_research`, `oral_knowledge`, `gedcom`, `photo`, `artifact`, `other`), `description`, `relevant_facts` (nullable), `relates_to_person_ids` (string[]), `confidence` (`confident` | `unsure`), `promoted` (bool, false at survey time), `created`.

**SKILL.md edits (additive and small — do not restructure the interview or the steps):**
1. **Step 1 / interview** — add a short, **skippable** holdings survey (same spirit and single-turn fallback as the existing two-question profile interview at lines 69–138): ask what documents, prior research, GEDCOMs, and living-relative knowledge the researcher already has, and what they're confident vs. unsure about. In single-turn eval mode with no follow-up, skip and note the user can add holdings later — mirror the profile interview's `intermediate`/`none` fallback exactly.
2. **Step 4 (write research.json)** — write one `known_holdings` entry per reported item: pick `holding_type`, copy the researcher's words into `description`, set `confidence`, set `promoted: false` and `created` to today, and fill `relates_to_person_ids` with the local `I` IDs when the item clearly concerns a person already in the tree.
3. **Step 6 (pedigree analysis)** — cross holdings against the tree: facts the user holds but the tree lacks → already-in-hand, don't re-search; user-vs-tree disagreements → flag as conflicts (the existing tone rule at lines 225–226 covers this); oral leads → surface in the summary. Add a holdings line to the "Present to the user" block.
4. **Frontmatter** — no `allowed-tools` change (the survey is user-reported, needs no new tool); update the `description` only if new trigger phrasing is wanted (optional).

`references/research-process-init.md` (131) should document the holdings survey as part of the Step 2 preliminary survey. `templates/research.json` is already updated with the empty `known_holdings: []`.

**Tests for this change:**
- **`holdings-survey-from-tree.json`** (new positive) — user gives a FamilySearch ID *and* volunteers holdings ("I have her death certificate and my aunt's typed family history"); reuse `person-read-flynn`. `judge_context` should require ≥2 `known_holdings` entries with sensible `holding_type` + `confidence`, `promoted: false`, and ≥1 `relates_to_person_ids` link to the subject. Headline test for the new behavior. **Single-turn skip risk:** eval runs are single-turn, so the survey is usually skipped by the fallback — the holdings **must** be in the first user message or the new code never fires.
- **Extend `from-objective-only.json`** (ut_init_project_002) — the Hennessy prompt already states oral family knowledge ("Sarah's mother's maiden name was Mary Donovan"); update its `judge_context` to credit recording that as an `oral_knowledge` holding rather than dropping it.
- **Negative:** this change moves no skill boundary — add none for it.

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
- **Template omits `evaluations`.** `templates/research.json` does not include the schema-required `evaluations: []` (pre-existing) — fix it as part of the seed-document cleanup.
- **Known-holdings survey not yet written** — the `known_holdings` schema has landed but the SKILL.md never gathers or writes it (see "Feature change" above). Without the survey, the rubric and tests for it can't grade anything.

## Fixture work
The tree and search paths are fully fixtured (`person-read-flynn`, `person-search-flynn`). Net-new: a `place-search-*` fixture for the hand-entered-place test (or reuse an existing `place-search-boston`-style fixture if one is added). The interview test and the known-holdings survey test need **no** MCP fixture — only user-message content (holdings are user-reported, not tool-returned); the survey test reuses `person-read-flynn`. `validate_research_schema` already has a fixture.

## Definition of done
Wire the known-holdings survey into Step 1/interview + Step 4 write + Step 6 cross-check (additive, single-turn fallback) → expand the rubric to grade tree shape + section seeding + interview normalization + place standardization + holdings capture → add the `place_search` fixture and its positive → add `holdings-survey-from-tree.json` and extend the Hennessy test's `judge_context` → add the no-relatives positive + the init-flavored refuse negative → seed-document cleanup (`evaluations: []`) → full harness pass + CRUD review + PR.
