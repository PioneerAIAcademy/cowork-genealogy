# Deep-Dive Brief — `search-external-sites`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Leans toward mechanics — most of the skill is URL construction, capture workflow, and research-log writing (largest SKILL.md in the batch). Genealogical input is mainly which sites/searches make sense.
**Files:** SKILL.md (519 lines) · references ×5 (428 lines) · tests ×3 · rubric ✓.

## What this skill does
GPS Step 1 execution for commercial sites with no public API (Ancestry, MyHeritage, FindMyPast, FindAGrave, Newspapers.com). It calls `place_search` → `place_external_links` to get FS-curated collection URLs, builds a pre-filled clickable search URL (curated base or site-wide template), instructs the user to click/scroll/save-as-PDF/upload, triages the captured results by match quality before handing records to `record-extraction`, and **logs every search to `research.json#log[]`** — including nil results as `outcome:"negative"` — to prove exhaustiveness.

## Where everything lives
- `plugin/skills/search-external-sites/SKILL.md` (519 lines)
- `references/` — `evaluating-compiled-sources.md` (104), `repository-types.md` (72), `research-log-protocol.md` (117), `search-strategy-external.md` (121), `validation-protocol.md` (14)
- `eval/tests/unit/search-external-sites/` — `ancestry-census-search.json`, `myheritage-url-generation.json`, `negative-familysearch-search.json`, `rubric.md`
- Scenario `mid-research-flynn`; fixtures `place-search-schuylkill-*` (×3) + `place-external-links-schuylkill` (Ancestry-only, 2 URLs)

## Current tests (3)
| id | covers | site | type |
|----|--------|------|------|
| ut_…_001 | Pre-filled Ancestry URL for 1870 census + capture instructions | Ancestry | positive |
| ut_…_002 | MyHeritage-specific URL structure (birth_place=Ireland) | MyHeritage | positive |
| ut_…_003 | "Search FamilySearch for Flynn" → routes to `search-records` | — | negative |

## Gaps — new tests to add
**Positive (3 of 5 sites + the core logging invariant untested):**
- **FindMyPast** URL — strong UK/Ireland fit for the Flynn research; exercises the fallback-template path (no FMP curated URL in fixtures).
- **FindAGrave** URL — always generated (free) + compiled-source nine-criteria evaluation.
- **Newspapers.com** URL — different query structure (`+`-joined name, `dr_year`, `dr_place`) + Boolean syntax.
- **Nil-result logging** — capture PDF shows zero matches → writes `outcome:"negative"` correctly.
- **Log-at-generation-time** — `research.json#log[]` updated with `capture_received:false` the moment the URL is generated (the skill's most critical invariant).
- **Subscription-aware selection** — `researcher_profile.subscriptions` ordering + login-wall warning (no scenario sets this today).

**Negative (boundaries):**
- → `search-records`: "Search FamilySearch for Flynn in the 1880 census." (already ut_003)
- → `research-plan`: "What external sites should I search next to find Patrick's parents?" (planning, not execution)
- → `record-extraction`: "Here's the Ancestry result PDF — extract the details." (record in hand, no search)

## ⚠️ Known issues
- **Rubric has no "log entry" dimension** despite logging being the headline invariant — the harness can't penalize a URL generated without the `research.json` write.
- **Redundant log guidance** — Step 4 and Step 7 both describe the log write with overlapping rules; reads as two authorities. Consolidate.
- **Filter/dedupe untested** — `place_external_links` returns a mixed-site, duplicate-heavy list the skill must host-filter and dedupe; the only fixture returns 2 clean Ancestry URLs, so this is never exercised.
- **Cross-dir reference** — SKILL.md points at `docs/gps/external-sites.md`, which isn't in the project folder the skill can read inside the VM.

## Fixture work
Reusable: 4 `place-search-schuylkill-*` (all param-name variants) + Irish `place-search` fixtures already exist (good for an FMP/UK test). Net-new needed: a `place-external-links-zero-results` fixture (forces the fallback-template path for any site) and a `place-external-links-mixed-sites` fixture (tests host-filter + dedupe). A scenario setting `researcher_profile.subscriptions` is needed for the subscription test.

## Definition of done
Add a "log entry" rubric dimension + consolidate Steps 4/7 → add the zero-results and mixed-sites fixtures → add ≥3 site-specific positive tests + the nil-logging + log-at-generation tests → add the `research-plan` and `record-extraction` negatives → full harness pass + CRUD review + PR.
