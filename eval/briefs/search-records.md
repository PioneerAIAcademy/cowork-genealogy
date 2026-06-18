# Deep-Dive Brief — `search-records`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Both, but fixture mechanics dominate — every positive test drives `record_search`/`record_read`/`source_attachments` against canned responses, so the day is mostly authoring and reusing MCP fixtures. Genealogical input is the match-scoring triage and the honest negative-result logging.
**Files:** SKILL.md (424 lines) · references ×8 (836 lines) · tests ×7 · rubric ✓ (27 lines).

## What this skill does
GPS Step 1 execution against FamilySearch historical records. It reads the research plan, routes each plan item to the correct MCP search tool by record type, runs `record_search`, triages results via match scoring (promising / needs-review / not-relevant), and **logs every search — including nil results — to `research.json#log[]`** to prove exhaustiveness. Positive searches write a result sidecar (`results/<log_id>.json`); a **NIL search writes NO sidecar** (the headline invariant pair). It calls `record_read` to fetch a full record after a promising index hit, uses `source_attachments` to check whether a result is already attached to a tree person, and passes promising records to `record-extraction`. It does not analyze/extract, plan, or search non-FamilySearch sites. Tools: `record_search`, `record_read`, `same_person`, `source_attachments`.

## Where everything lives
- `plugin/skills/search-records/SKILL.md` (424 lines)
- `references/` — `collection-quirks.md` (83), `data-collection-standards.md` (156), `name-search-mechanics.md` (120), `place-date-mechanics.md` (122), `research-log-protocol.md` (117), `research-log-standards.md` (112), `search-strategy-levers.md` (112), `validation-protocol.md` (14)
- `eval/tests/unit/search-records/` — `execute-census-search.json`, `negative-no-match-results.json`, `negative-extract-request.json`, `fetch-full-record-via-record-read.json`, `write-result-sidecar.json`, `nil-search-no-sidecar.json`, `attachment-triage.json`, `rubric.md`
- Scenarios used: `flynn-record-matching`, `mid-research-flynn`

## Current tests (7)
| id | covers | type | tools/fixtures |
|----|--------|------|----------------|
| ut_…_001 | Execute planned 1850 census search; don't mark pli_001 complete just because it ran | positive | record_search / record-search-1850-census-flynn |
| ut_…_002 | Honest negative-result logging when no matches found | positive | record_search / record-search-1850-census-flynn |
| ut_…_003 | Record handed in for extraction → routes to `record-extraction` | negative | — |
| ut_…_006 | Fetch full record via `record_read` after a census match | positive | record_read / record-read-68Q9-K34P (+ census) |
| ut_…_010 | Write result sidecar for a positive search | positive | record_search / record-search-1850-census-flynn |
| ut_…_011 | NIL search writes no sidecar (spelling-variant sweep) | positive | record_search / flynn + flinn + flyn no-results |
| ut_…_012 | Check attachment status during triage via `source_attachments` | positive | source_attachments / record-attachments-flynn-census |

> Coverage is best-in-batch on mechanics: sidecar write/no-write, the nil spelling-variant sweep, attachment triage, and the `record_read` follow-up are all exercised with existing fixtures. The gaps are in *judgment* (match-scoring triage) and *boundaries* (only one of three named neighbors has a negative).

## Gaps — new tests to add
**Positive (judgment, not mechanics):**
- **Match-scoring triage** — a `record_search` returning a near-match (right name + county, age 3 years off) that must be flagged needs-review, not silently dropped. This is the **Result triage** rubric dimension and `same_person` (in allowed-tools, **no fixture today**) is the natural tool — needs a `same_person` fixture.
- **Search-strategy levers** — a plan item where name variants / date-range widening / jurisdiction is the point (Irish-origin name → Anglicization variants per `name-search-mechanics.md`); exercises the **Search strategy** dimension.
- **Collection-quirk routing** — a record type whose quirk (per `collection-quirks.md`) forces a non-obvious tool/parameter choice.

**Negative (boundaries from the description):**
- → `record-extraction`: "Here's a record I found — analyze the details." (already ut_003)
- → `search-external-sites`: "Search Ancestry / Newspapers.com for the Flynns." — a major, explicitly-named boundary with **NO negative test**; route AWAY when the target is a commercial site.
- → `research-plan`: "What should I search for next to find Patrick's parents?" (planning, not execution — untested.)

## ⚠️ Known issues
- **`same_person` is in `allowed-tools` but has no fixture** — flagged warn-only by `check_tool_coverage.py`. The match-scoring triage path (the skill's core judgment) can't be unit-tested until a fixture exists.
- **The search-external-sites boundary is untested** despite being the loudest "Do NOT use" in the description (five named commercial sites). A casing/routing slip here is exactly the failure a negative test would catch.

## Fixture work — the dominant cost
Reusable today: `record-search-1850-census-flynn`, the three no-results spelling variants (`record-search-flynn/flinn/flyn-no-results`), `record-read-68Q9-K34P`, and `record-attachments-flynn-census`. **Net-new needed:** a `same_person` fixture (for the triage test — the one allowed-tool with zero coverage) and a `record-search-*-near-match` fixture returning an age-off candidate to drive the needs-review path. The search-external-sites negative needs no fixture (it should route away before any tool call).

## Definition of done
Add a `same_person` fixture + the near-match triage positive → add the search-strategy-levers and collection-quirk positives → add the search-external-sites and research-plan negatives → polish rubric/SKILL if triage wording is thin → full harness pass + CRUD review + PR. (Scope to what fixtures allow — log anything deferred.)
