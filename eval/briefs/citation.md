# Deep-Dive Brief — `citation`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** The substance is Evidence Explained craft (genealogical). Mechanics are light — one `validate_research_schema` call and a staged source entry; no MCP fixtures.
**Files:** SKILL.md (346 lines) · references ×2 (176 lines) · tests ×3 · rubric ✓ (27 lines).

## What this skill does
GPS Step 2. Refines the `citation` and `citation_detail` fields on source entries that **already exist** in `research.json` (created by `record-extraction` with rough working citations) up to Evidence Explained standards — populating all five Who/What/When/Where/Wherein elements, fixing common errors (repository named as creator, vague titles, missing locators/access dates), and regenerating the formatted citation string from source-type templates. **It never creates new source entries**, and it calls `validate_research_schema` after writing.

## Where everything lives
- `plugin/skills/citation/SKILL.md`
- `plugin/skills/citation/references/gps-citation-standards.md` (162 lines)
- `plugin/skills/citation/references/validation-protocol.md` (14 lines)
- `eval/tests/unit/citation/` — `citation-replication-test.json`, `negative-search-request.json`, `refine-census-citation.json`, `rubric.md`
- All tests use scenario `eval/fixtures/scenarios/mid-research-flynn/` (sources `src_001`–`src_004`, varying citation quality).

## Current tests (3)
| id | covers | type |
|----|--------|------|
| ut_citation_001 | Confirms an already-EE-compliant census citation (src_001) — review path, not fix path | positive |
| ut_citation_002 | Applies the replication test to a death certificate (src_004); does not over-specify | positive |
| ut_citation_003 | "Find corroborating records" → routes to `search-records` | negative |

## Gaps — new tests to add
**Positive (the *fix* path and most source types are untested):**
- **Fix a genuinely broken census citation** — target `src_002` (Ancestry derivative: `who="FamilySearch"`-style errors, missing `where_within`) and require full correction + regenerated string. This is the skill's core job and has no test.
- **Church register / baptismal citation** — template exists in SKILL.md, no test (parish as creator, no certificate number).
- **Probate / will citation** — distinct locator pattern (Will Book, page); scenario even has a probate plan item `pli_006`.
- **Derivative index vs. original** — name the transcriber-tier creator, "digital index" not "digital image".
- **Negative-search citation** — document a searched-but-empty result (scenario `log_003` is a MyHeritage nil result).
- **URL-only input** — expand a bare URL into a full citation / strip query strings.

**Negative (boundaries from the description):**
- → `search-records`: "Find all 1870 census records for Thomas Flynn in Schuylkill County."
- → `record-extraction`: "Extract the facts from this 1908 death certificate and add them."
- → `assertion-classification`: "Is the informant on src_004 primary or secondary for the father's name?"
- **Refuse new-source creation:** "Add a source for the 1870 census I just found" — must redirect, not create a `src_` entry.

## ⚠️ Known issues to fix first
- `references/validation-protocol.md` names tools by **stale slug** (`validate-schema`, `check-warnings`) instead of the real `validate_research_schema`.
- Rubric has **no "does not create new source entries" dimension** — the key architectural invariant is ungraded.
- SKILL.md's "four facets plus a fifth" prose doesn't align with the six-field `citation_detail` table (`when` is split) — minor but confusing.

## Fixture work
`mid-research-flynn` already supports the fix-path, derivative, and negative-search tests (it has `src_002` partial + a nil-result log). Church/probate/URL-only tests need either a new scenario with the relevant source stub pre-loaded, or a `null` scenario with source detail inline (cleaner to add a stub to a scenario). No MCP fixtures needed — only `validate_research_schema`.

## Definition of done
Fix the slug drift + rubric invariant → add the fix-path test + ≥2 new source-type tests + the negative-search test → add the 3 neighbor negatives + the new-source refusal → full harness pass + CRUD review + PR.
