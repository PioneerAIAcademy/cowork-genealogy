# Deep-Dive Brief — `historical-context`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Substance is broad historical knowledge (genealogical). Mechanics are moderate — it calls 4 MCP tools, so new tests need fixtures (two existing tests have none yet).
**Files:** SKILL.md (208 lines) · references ×3 (537 lines) · tests ×4 · rubric ✓.

## What this skill does
Provides narrative historical background that helps interpret records and plan research — boundary/jurisdiction changes, naming conventions, migration patterns, record availability by era, meanings of historical terms, and events that affect records. It always ties the explanation to research-actionable consequences (specific record classes, migration corridors, search adjustments). Output is narrative to the user; it never writes files. Tools: `wiki_search`, `wiki_read`, `wikipedia_search`, `place_population`.

## Where everything lives
- `plugin/skills/historical-context/SKILL.md`
- `references/historical-broad-context.md` (185), `historical-terminology.md` (182), `boundary-and-calendar-changes.md` (170)
- `eval/tests/unit/historical-context/` — `irish-famine-migration.json`, `pennsylvania-coal-1850s.json`, `connect-context-to-research.json`, `negative-search-wikipedia.json`, `rubric.md`

## Current tests (4)
| id | covers | type | fixtures |
|----|--------|------|----------|
| ut_…_001 | Irish famine context for 1840s PA immigration | positive | 4 wiki_search (all exist) |
| ut_…_002 | PA anthracite coal-mining occupational context | positive | **none declared** |
| ut_…_003 | Context grounded in the `mid-research-flynn` scenario timeline | positive | none declared |
| ut_…_004 | "Look up X on Wikipedia and save it" → `search-wikipedia` | negative | none |

## Gaps — new tests to add
**Positive (all 3 positives are Pennsylvania/Flynn/Irish — zero diversity):**
- **Boundary change → apparent birthplace conflict** — "born Virginia" vs "born West Virginia" (WV split 1863). The boundary reference is heavily cited but has *no* test.
- **Patronymic naming** — Norwegian "Lars Eriksen" vs "Lars Pedersen"; explain -sen/-dóttir and the research implication (search by given name, not surname).
- **Record availability by era** — English ancestor born ~1820 in Dorset: civil registration began 1837, use parish registers before that (without becoming a full locality guide).
- **Legal-term meaning** — "relict", "appurtenances" in an 1832 will (direct terminology lookup).
- **Name anglicization / "Dutch = Deutsch"** — Schwartzbach vs Schwarzbach; enumerator phonetics.
- **Missing records explained by event** — SC deeds gap 1860–70 (Civil War courthouse loss).

**Negative (5 named neighbors, only 1 currently tested):**
- → `locality-guide`: "What records exist for Schuylkill County in the 1850s and where do I access them?"
- → `search-records`: "Search for Patrick Flynn's passenger arrival record (~1847)."
- → `translation`: "What do 'getauft' and 'Pate' mean — translate this German entry?"
- → `convert-dates`: "What is '14 February 1735/36' in modern terms?"
- → `conflict-resolution`: "Census says Ireland, death cert says PA — which is right, resolve it?"

## ⚠️ Known issues
- **Tests 002 & 003 declare no `mcp_fixtures`** — non-deterministic (real calls or `fixture_not_found`). Add fixtures.
- **`place_population` and `wiki_read` have zero fixtures anywhere** — both are in `allowed-tools` and instructed in SKILL.md but never exercised; the tool-coverage check flags them.
- **YAML frontmatter `description`** has a mid-sentence line break that some parsers will mangle.

## Fixture work
`wiki_search` and `wikipedia_search` have good existing fixtures to copy (Irish, German, Schuylkill, Great Famine). Net-new needed: topic-matched `wiki_search` fixtures for each gap (West Virginia boundary, patronymics, England civil registration, SC Civil War records, German anglicization), plus the **first-ever** `place_population` and `wiki_read` fixtures (no template exists — build from the standard fixture schema). Boundary-change and record-availability tests fixture most cleanly (predictable query terms); naming-convention tests have looser tool calls.

## Definition of done
Add fixtures to tests 002/003 → create first `place_population`/`wiki_read` fixtures → add ≥4 non-Flynn positive tests → add the 4 missing neighbor negatives → fix the frontmatter → full harness pass + CRUD review + PR.
