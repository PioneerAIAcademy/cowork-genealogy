# Deep-Dive Brief — `locality-guide`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Demands both deep records knowledge **and** the heaviest test mechanics in the batch — it calls ≈11 MCP tools, so fixture authoring dominates the day. Plan for substantial work on both fronts.
**Files:** SKILL.md (203 lines) · references ×4 (508 lines) · tests ×3 · rubric ✓.

## What this skill does
Produces a structured locality research guide for a place + time period: when the jurisdiction formed, what boundary changes occurred, which record types exist and when, what's indexed online vs browse-only vs microfilm vs physical-only, which repositories hold them, and known record losses. It's the prerequisite to `research-plan`. It does **not** search records, write `research.json`, or give historical context beyond explaining which records exist. Tools: `place_search`, `collections_search`, `external_links_search`, `place_population`, `wikipedia_search`, `wiki_search`, `wiki_read`, and `wiki_place_page` (4 sections: home / getting_started / online_records / research_tips).

## Where everything lives
- `plugin/skills/locality-guide/SKILL.md`
- `references/output-format.md` (139), `locality-survey-methodology.md` (122), `locality-broad-context.md` (124), `reference-source-types.md` (123)
- `eval/tests/unit/locality-guide/` — `schuylkill-county-records.json`, `different-jurisdiction-ireland.json`, `negative-search-wikipedia.json`, `rubric.md`

## Current tests (3)
| id | covers | type | tools/fixtures |
|----|--------|------|----------------|
| ut_…_001 | Schuylkill County PA, 1840s–60s; pre-1906 vital-records caveat | positive | place_search/collections/external_links + wikipedia (7 fixtures, all exist) |
| ut_…_002 | 1840s rural Ireland — different jurisdiction shape (no civil reg.) | positive | **no fixtures declared** |
| ut_…_003 | "Look up on Wikipedia and save the summary" → `search-wikipedia` | negative | 1 fixture |

## Gaps — new tests to add
**Positive:**
- **German county, 19th c.** (e.g. Württemberg) — exercises **`wiki_place_page`** (currently *never* tested across its sections), kirchenbuch before 1876 civil registration, records in German.
- **Over-broad request → ask to narrow** — "What records exist in Pennsylvania?" (state, no county) should trigger the narrow-down decision rule.
- **Mid-period boundary change** — a county carved from a parent county, so earlier records sit at the parent courthouse.
- **Known courthouse fire / destroyed records** — exercises the "Records NOT online" / "Known losses" output sections + substitute-sources path.
- **Sub-county input → county-level guide** — user asks about a town (Pottsville); guide at county level but note town repositories.
- **`external_links_search` edge** — `totalForPlace>0` but `results` empty (FS curates outside the time window) — explicit SKILL.md branch, untested.

**Negative (boundaries):**
- → `search-records`: "Search FamilySearch for John Murphy's birth record in County Cork."
- → `historical-context`: "Why did so many Irish settle in Schuylkill in the 1840s, and what naming patterns did they bring?"
- → `search-records`/`search-external-sites`: "Here's my plan — now search Ancestry and FindMyPast for the Dolans."

## ⚠️ Known issues
- **Tool-selection logic underspecified.** SKILL.md Step 3 lists the wiki-family tools in one block with no heuristic for `wiki_place_page` (needs a `standardPlace` + `section`, returns a curated page) vs `wiki_search`+`wiki_read` (keyword). This is the skill's main complexity — clarify it.
- **Ireland test (ut_002) runs fixture-free** — latent reliability risk; add at least a minimal Ireland fixture set.
- **`collections_search` scope is now automatic** — it derives the US/Canada/Mexico state (or country) from the `standardPlace` and returns it as `scope`, so the old "query by *state* name, not county" gotcha no longer applies; pass the full standardPlace.
- **Write-behavior inconsistency** — re-invocation section implies writing a `.md` file; "Important rules" only says it doesn't touch research.json. Clarify.

## Fixture work — the dominant cost
Reusable today: `place_search` (9 fixtures incl. Ireland variants), `collections_search` (2 PA) + `collection_read` (1), `wiki_search` (6, intl variety), `wikipedia_search` (6). **Zero fixtures exist** for `wiki_read`, `wiki_place_page` (any section), and `place_population`. A single well-exercised German-county test needs ~6–8 net-new fixtures (a `wiki_place_page` fixture per section — home / getting_started / online_records / research_tips — per jurisdiction, plus a `wiki_read` per article). **Budget most of the day for fixtures**, and treat a minimal Ireland fixture set for ut_002 as a precondition.

## Definition of done
Clarify the wiki-tool-selection logic in SKILL.md → backfill Ireland fixtures for ut_002 → build the first `wiki_place_page` fixture set (its 4 sections) for one new jurisdiction + its positive test → add the narrow-down + boundary-change negatives/positives → full harness pass + CRUD review + PR. (Scope to what fixtures allow — log anything deferred.)
