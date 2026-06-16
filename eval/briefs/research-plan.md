# Deep-Dive Brief — `research-plan`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** **Fixture-heavy — the day is fixture authoring, not judgment.** This is the only fixture-significant skill in the batch: 9 allowed tools, the locality-survey backbone, and **five of those nine tools have no fixture anywhere in this skill's corpus**. Genealogical judgment (record-type selection, sequencing, jurisdiction) matters, but the gating cost is building deterministic MCP responses for the survey calls.
**Files:** SKILL.md (360 lines) · references ×5 (432 lines) · tests ×4 · rubric ✓ (27 lines).

## What this skill does
GPS Step 1 (planning phase), aligned with BCG Standards 9–18. For a specific question, it **writes a sequenced research plan to `research.json`** (`pl_`/`pli_` entries) — which record sets to search, in what order, from which repositories, with `fallback_for` chains. It surveys what records actually exist before planning, via up to nine MCP tools (`wiki_search`, `place_search`, `place_search_all`, `collections_search`, `place_population`, `external_links_search`, `volume_search`, `wiki_place_page`), then validates with `validate_research_schema`. Key invariants: it **reviews-vs-creates** (confirm/extend an existing plan rather than spawning a parallel one), it knows **when NOT to plan** (exhaustiveness already declared, or the user wants `question-selection`), and persisted places use the `standard_place` name while ID resolution stays in the survey calls.

## Where everything lives
- `plugin/skills/research-plan/SKILL.md`
- references: `locality-survey-guide.md` (79), `places-guidance.md` (81), `planning-standards.md` (196 — BCG 9–18), `record-type-guide.md` (62), `validation-protocol.md` (14)
- `eval/tests/unit/research-plan/` — `plan-for-parentage-question.json`, `new-plan-after-census-exhausted.json`, `handle-negative-probate-result.json`, `negative-question-selection.json`, `rubric.md`
- Scenarios used: `mid-research-flynn`, `flynn-census-exhausted`, `flynn-resolved`

## Current tests (4)
| id | covers | type | fixtures |
|----|--------|------|----------|
| ut_research_plan_001 | Review existing plan; confirm `pli_006` (probate) is next; no new plan, status unchanged | positive | place-search-schuylkill-county, collections-search-schuylkill, collections-search-pennsylvania, place-search-pennsylvania, external-links-search-schuylkill |
| ut_research_plan_002 | Propose a NEW plan after first plan complete; new items get `planned` status | positive | **none declared** |
| ut_research_plan_003 | Don't re-plan when exhaustive search is already declared | negative-ish boundary | none |
| ut_research_plan_004 | "What research question should I work on next?" → routes to `question-selection` | negative | none |

> Coverage shape (fixture-starved): only `place_search` / `collections_search` / `external_links_search` are ever fixtured — all in ut_001. **Five of nine allowed tools — `wiki_search`, `place_search_all`, `place_population`, `volume_search`, `wiki_place_page` — have NO fixture in this corpus and are never exercised**, despite being the locality-survey backbone. Worse, **ut_002 (propose a new plan) declares no fixtures**, so its survey calls hit the mock with no match and the plan it produces is non-deterministic.

## Gaps — new tests to add
**Positive (survey-grounded plans + the lightly-tested logic):**
- **Fix ut_002's missing fixtures first** — author the survey fixtures (`collections_search`, `place_search`, `external_links_search`, and the new-place-period calls it makes) so the "propose a new plan" case is deterministic. This is a correction, not a new test, but it gates everything.
- **Locality-survey-driven plan** — a question whose plan must lean on `wiki_search` (record availability) + `volume_search` (browse-only films) + `wiki_place_page` research_tips; exercises the four currently-unfixtured survey tools and the record-type-guide reference.
- **Fallback/repository sequencing** — a plan where the primary repository is likely to yield nothing and the item needs an explicit `fallback_for` chain (directly targets the Sequencing-logic rubric dimension, currently lightly tested).
- **FAN-pivot planning** — plan a Family/Associates/Neighbors line (witnesses, neighbors in census) rather than direct records; the planning analogue of question-selection's FAN trigger, untested.
- **Jurisdiction/boundary case** — a target period where county/state boundaries differ from modern; tests the Jurisdiction-accuracy rubric dimension and needs `place_search` boundary-history fixtures.

**Negative (boundaries from the description):**
- → `question-selection`: "What research question should I work on next?" — **already covered** by ut_004.
- → `search-records` / `search-external-sites`: "Go search the 1880 census for Patrick Flynn now." (execute, don't plan).
- → `record-extraction`: "Pull the facts out of this death certificate I just found."

## ⚠️ Known issues
- **ut_002 declares no `mcp_fixtures`** while the skill performs a locality survey → unmatched-tool-call behavior and a non-deterministic plan. Per `unit-test-spec.md` §15, missing-args calls return `fixture_not_found` and the run flaps. Author its survey fixtures before relying on this test.
- **`check_tool_coverage.py` (warn-only CI)** will flag this skill: five `allowed-tools` (`wiki_search`, `place_search_all`, `place_population`, `volume_search`, `wiki_place_page`) have no fixture in the corpus. Closing that warning is real fixture work.

## Fixture work
**This skill's day is fixture authoring.** Reusable today: `place-search-schuylkill-county`, `place-search-pennsylvania`, `collections-search-schuylkill`, `collections-search-pennsylvania`, `external-links-search-schuylkill` (all consumed by ut_001), plus `volume-search-edensor` and the existing `wiki-search-*` fixtures in `eval/fixtures/mcp/` that can seed Flynn-area variants. **Net-new needed:** fixtures for `place_search_all`, `place_population`, and `wiki_place_page` (none exist for any skill), Schuylkill/Pennsylvania-scoped `wiki_search` and `volume_search` responses, and the full survey set for ut_002. Each new fixture needs a `tool`/`args`-predicate/`response` triple whose `args` predicate matches the survey call the skill emits. This is the bulk of the effort — far more than the judgment in the rubric dimensions.

## Definition of done
Author ut_002's missing survey fixtures → add the locality-survey, fallback-sequencing, FAN-pivot, and jurisdiction positives with their net-new `place_search_all` / `place_population` / `wiki_place_page` / `wiki_search` / `volume_search` fixtures → add the search and record-extraction negatives (question-selection already covered) → clear the `check_tool_coverage` warning → full harness pass + CRUD review + PR.
