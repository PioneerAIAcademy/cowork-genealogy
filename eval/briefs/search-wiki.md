# Deep-Dive Brief — `search-wiki`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Mostly mechanics — the work is fixtures, the template, and slug/citation rules. Genealogical input is light (which how-to queries matter and whether the saved guidance reads correctly).
**Files:** SKILL.md (73 lines) · template ×1 (7 lines) · tests ×5 · rubric ✗ (**missing**).

## What this skill does
Searches the **FamilySearch Research Wiki** (a genealogy-method reference) via the single `wiki_search` MCP tool, synthesizes the ranked result chunks into a short how-to guidance summary, and saves it as a cited markdown file in the working folder. It's the near-twin of `search-wikipedia` but targets the FS Wiki (record-type and country research guidance), not general Wikipedia. Triggers on how-to-research questions (find a record type; research a country/region; use an FS resource).

## Where everything lives
- `plugin/skills/search-wiki/SKILL.md`
- `plugin/skills/search-wiki/templates/wiki-search-summary.md` (7 lines; placeholders `{{topic}}`, `{{summary}}`, `{{sources}}`)
- `eval/tests/unit/search-wiki/` — `find-italian-birth-records.json`, `how-to-german-church-records.json`, `irish-immigration.json`, `negative-locality-guide.json`, `negative-wikipedia.json` — **no rubric.md**

## Current tests (5)
| id | covers | type |
|----|--------|------|
| ut_…_001 | Italian birth records, explicit "FS wiki" + how-to; multi-result synthesis → cited file | positive |
| ut_…_002 | Irish immigration; single-result response still produces a sourced file | positive |
| ut_…_003 | "How do I find German church records?" — implicit trigger (no "FS wiki" phrase) | positive |
| ut_…_004 | "Albert Einstein on Wikipedia" → `search-wikipedia` | negative |
| ut_…_005 | "What records exist for County Cork and where?" → `locality-guide` | negative |

## Gaps — new tests to add
**Positive:**
- **Untested record types** — census, death/vital, military, land/probate, immigration/naturalization (each hits a distinct FS-Wiki corpus chunk).
- **Country/region research-guide query** — a bare "research ancestors from Sweden/Norway" (a distinct activation path from record-type queries).
- **Slug normalization** — verify the lowercase / non-alphanumeric-run → single-hyphen / trim rule (e.g. "U.S. Census Records" → `us-census-records`). No positive test checks it.
- **No-result handling** — `wiki_search` returns `results: []` → tell the user, write no file (an entirely untested behavioral path).
- **Informal phrasing** — "check the FS wiki", "look on the FamilySearch wiki" (routing robustness).

**Negative (the tight cluster — see [README](README.md)):**
- → `historical-context`: "Tell me about Irish Famine migration and how boundary changes affected record-keeping." (**missing** — description names it but no test).
- → `search-wikipedia` (harder near-miss): "Look up parish records on Wikipedia and save the summary."
- → `locality-guide` (German variant near the church-records positive): "What records are available for Bavaria and where are they held?"

## ⚠️ Known issues
- **No `rubric.md`** — judge falls back to base dimensions only; no skill-specific grading like "sources cited", "slug matches topic", "no fabricated guidance". **Author one** (straightforward to add; model it on a sibling skill's rubric).
- **Thin/empty `judge_context`** on ut_002/003 — give the judge skill-specific cues.
- **Template citation format is unstructured** — the `{{sources}}` bullet format lives only in SKILL.md step 6; add a commented example in the template to reduce citation-style drift.
- **Template name divergence** — search-wikipedia uses `wiki-summary.md`; this uses `wiki-search-summary.md`. Cosmetic, but note for consistency.

## Fixture work
Three positive fixtures exist and are well-formed (3-result, 3-result, 1-result). Already-present-but-unused fixtures (`wiki-search-great-famine-emigration`, `-irish-catholic-records`, `-schuylkill-coal-mining`) can seed gap tests. Net-new: a `wiki-search-empty-results.json` (`results: []`) for the no-result test, plus one `wiki-search-<topic>.json` per new record type. The historical-context negative needs **no** fixture (model shouldn't call the tool).

## Definition of done
Author `rubric.md` → add ≥3 record-type positives + the slug + no-result tests → add the historical-context negative (and a harder wikipedia near-miss) → enrich `judge_context` + template citation example → full harness pass + CRUD review + PR.
