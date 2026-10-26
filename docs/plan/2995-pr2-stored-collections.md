# Plan: #2995 PR 2 — skills, agents and eval read the stored collections list

**Status:** planned (not built). Delete this file when PR 2 merges.

PR 1 (#3253, merged 2026-10-09) made `external_links_search` fetch the whole list,
dedupe it, and store it in `external-collections.json`, with read paths in
`research_query({section: "external_collections"})` and `project_context.externalCollections`.
Nothing reads the stored list yet. PR 2 makes the four callers use it, removes staging
from the tool, adds `plan_item.collection_url`, and rewrites the eval side. PR 3 (viewer
Collections view) is out of scope.

Line numbers are from main `08df2a026` and will drift.

## 1. Engine: remove staging from `external_links_search`

- `src/tools/external-links-search.ts`: delete the `results-staging` imports, the
  `unloggedStaged` read and `unloggedSearches` note, `nilSearchNeedsLog`, the
  `stageSearchResults` block (`staged`/`stagingError`), and the staging wording in the
  tool description and the `host` / `projectPath` param descriptions. `projectPath` now
  only means "store the full list".
- `src/types/external-links-search.ts`: drop `unloggedSearches`, `nilSearchNeedsLog`,
  `staged`, `stagingError`; reword the `inlineCapped` comment.
- `src/utils/results-staging.ts`: remove `external_links_search` from
  `STAGING_SEARCH_TOOLS` (so also from `STAGING_CAPABLE_TOOLS`). Change
  `unloggedStagedSearches` (~:468) to skip any envelope whose tool is a string not in
  `STAGING_SEARCH_TOOLS` (keep the `typeof === "string"` guard so a malformed tool is
  still counted as today), so a legacy pre-upgrade staged `external_links_search` file
  does not show up in `record_search`'s nudge for 24h with no way to pair it.
  Reword the `PERSONA_BEARING_PRODUCERS` comment (:64).
- `research-log-append.ts` outcome rule (~:1240-1261, `external_links_search` with
  `resultsExamined > 0` forced positive): **keep**. Old projects and ad-hoc entries can
  still log the tool; the rule does not depend on staging. Say so in the PR body.
- Comments naming it as a staging producer: `record-search.ts:~1070`,
  `fulltext-search.ts:~278`, `validator.ts:~2248`, `research-append.ts:~4735`,
  `same-person.ts:~425`, `tests/tools/no-project.test.ts:~367`,
  `tests/tools/research-append.test.ts:~5801`. Reword to "legacy sidecars from before
  #2995 stay readable" where the sentence is still about readability.
- Tests: `tests/tools/external-links-search.test.ts` — delete the staging mock and the
  staging cases in "staging, host filter, and inline cap" (:429-605); keep and re-home
  the host-filter and cap cases without staging assertions; add a case asserting the
  response has no `staged` / `unloggedSearches` / `nilSearchNeedsLog` key with
  `projectPath`. `tests/utils/results-staging.test.ts:~281` "does not pair across
  tools": swap the `external_links_search` entry for `fulltext_search` so it still
  tests what its name says; add a test that a legacy staged `external_links_search`
  envelope is not counted by `unloggedStagedSearches`.
- Mirror: `eval/harness/harness/mock_mcp.py` `STAGING_SEARCH_TOOLS` (:391) drops it;
  the staging/nil branches and comments at ~:444, :476, :1043-1071, :1121-1165 lose
  their `external_links_search` arms. `test_mock_mcp.py`'s equality pin stays green.
- Docs: `search-result-staging-spec.md` (:42-46, :55, :85-92, :253, :303),
  `docs/architecture.md` (~:1401-1415), `research-log-editor-spec.md` (:642, :722,
  :733), `external-links-search-tool-spec.md` (output table :87-91, testing rows
  #13-15; also fix the stale input table and schema block to show `host`/`projectPath`),
  `research-query-tool-spec.md:~274`, `research-append-tool-spec.md:~551`,
  `research-schema-spec.md:~730`, `docs/specs/schemas/ownership.json` `log` row note
  (:267, both clauses).

## 2. Schema: optional `plan_item.collection_url`

Template: PR #3087 (`skip_reason`).
- `docs/specs/schemas/research.schema.json` and `packages/schema/schemas/research.schema.json`
  (byte-identical): `"collection_url": { "type": "string" }` in `plan_item`.
- `validator.ts` `RESEARCH_SHAPES.plan_item` allow-list (~:564), plus a type check
  (string) in the plan-item loop (~:920-962).
- `packages/schema/src/index.ts` `PlanItem`: `collection_url?: string`.
- `research-schema-spec.md` plan-items table (~:604-618): new row.
- `field-render-drift.test.ts`: render it in `packages/viewer-ui/src/components/sections/PlansSection.tsx`
  as a clickable link (the alternative, a `NOT_RENDERED` exemption, hides the one field
  a researcher would click).
- `research-append-examples.ts` `EXAMPLES.plan_items`: an external item carrying
  `collection_url` (checked against the schema by `research-append-examples.test.ts`).

### Writer precondition (ADR-0011: decidable from the project documents)

Applies on BOTH routes: `plan_items` append/update, and inline `items[]` on a `plans`
append/update (the `itemsTouchedThisOp` loop, research-append.ts ~:3782-3812, where the
skip rule already runs for the same reason). A malformed `external-collections.json`
(`readExternalCollections` throws) is caught and refused with a message naming the file.
Register the rule: `guardrail-enforcement-spec.md` precondition register (~:924) + error
table; `ownership.json` `plan_items` row `enforceableAt: ["tool"]` with a note.

`research_append` refuses a `plan_items` append or update whose `collection_url` is not
the `url` of some row in `external-collections.json` (any place). Error names the field
and says to read `research_query({section: "external_collections", place, recordType})`
and copy a row's `url`, or omit the field for a site-wide search. Absent file → every
non-empty `collection_url` is refused. Empty string is refused too (omit instead).
- Site: `research-append.ts`, beside `planItemSkipInvariants` (~:2214-2283 / call
  ~:3844), reading the file through `readExternalCollections`
  (`external-collections-store.ts`).
- `research-append-tool-spec.md` §5 invariant row and error row.
- Tests in `tests/tools/research-append.test.ts`: refused when not stored, refused
  with no file, refused on a malformed file, refused on an inline `plans` item,
  accepted when stored (append and update), an update that does not name
  `collection_url` is not re-checked. Each shown failing first.

This is what makes the acceptance "research-plan writes a `collection_url` that is in
the stored list" hold for every caller, not just the one the prompt reaches.

## 3. Callers

### research-plan (`skills/research-plan/SKILL.md`; still a skill)
- `allowed-tools`: keep `external_links_search`; add bare `research_query`,
  `project_context`.
- Replace the `external_links_search` call in Step (b) (~:180-195) with: read
  `project_context.externalCollections` for the place; for each external-repository
  item, `research_query({section: "external_collections", place, recordType})` using a
  record-type term from `byRecordType`, and copy the chosen row's `url` into the item's
  `collection_url`. A place absent from `externalCollections` (never fetched — e.g. a
  project from before PR 2) → call `external_links_search({standardPlace, startYear,
  endYear, projectPath})` once with the plan's year window (the inline copy stays small
  in the main thread; the tool stores the full list regardless), then read as above. Never call it for a place that
  is present. **Deviation from the issue's literal "delete the call when a project
  exists"**: deleting it leaves every pre-PR-2 project and every place locality-guide
  did not survey with no list, so research-plan would plan site-wide searches only.
  Fetch-when-absent keeps the intent (read the stored list, don't re-fetch). PR body.
- Fix the **Places** line (:28) and the tools table row (:55).
- Net: the SKILL.md must end shorter than it started (memory: reduce SKILL.md text).
- `test_allowed_tools.py:~364` pin stays (tool still allowed).
- `docs/specs/research-plan-skill-spec.md:~34` tool list: add `research_query`,
  `project_context`; describe fetch-when-absent.
- `eval/tests/unit/research-plan/locality-survey-first-plan.json:35` judge_context
  wording re-checked against the new flow.
- New tag-gated validator in `test_research_plan.py`: on a test tagged
  `collection-url`, at least one new non-FamilySearch plan item carries
  `collection_url`, and every `collection_url` is a stored row url in
  `after_state["files"]["external-collections.json"]`. New research-plan test
  (scenario seeded, Ancestry-relevant question) carrying that tag.

### search-external-sites (`agents/search-external-sites.md`)
- Step 2 "Resolve the place and fetch curated links" (~:278-320), curated-collection
  URLs only: the plan item's `collection_url` is `baseUrl`; no plan item or no
  `collection_url` → `project_context.externalCollections`: place present →
  `research_query({section: "external_collections", place, recordType})` and keep rows
  for the target host; place absent → `external_links_search({standardPlace, host,
  projectPath})` (stores it) then the same read; no matching row → site-wide.
  Delete the agent-side dedupe / `matched` / `totalForPlace` reading (the tool
  dedupes). **Unchanged:** non-curated `baseUrl` sources — Archion/Matricula parish
  page from the delegation or `localities`, a caller-supplied URL, and
  `digital_newspaper_archive` (no site-wide template; `baseUrl` required).
- Triage "No row matches" (~:88): drop `external_links_search` from the list.
- Step 4 "First, persist the curated-links fetch" (~:457-480): delete.
- `tools:`: keep `external_links_search` (fetch-when-absent, as research-plan);
  add nothing (it already holds `research_query`/`project_context`). Deviation from the
  issue's "fetches only when there is no project" (that case cannot occur: `projectPath`
  is required) — recorded in the PR body.
- New search-external-sites test on `mid-research-flynn-collections` whose delegation
  names a `planned` Ancestry `planItemId` carrying `collection_url`, plus a validator
  asserting `build_external_search_url`'s `baseUrl` equals that `collection_url` and
  no `external_links_search` call was made.
- Its "Working with places" block (~:1019, :1030) is a `places-guidance` copy: leave it
  (lead ruling 2026-10-06). Check
  `skill-guidance.test.ts` stays green.
- Delete the pointer to the V2 links entry (issue: SKILL.md ~398-402; find in the agent).

### locality-guide (`agents/locality-guide.md`)
- Survey call (:120): pass `projectPath`, drop `startYear`/`endYear`.
- Rewrite the paragraph at :132: the tool dedupes and stores the full list; inline is
  capped at 200 (`inlineCapped`); when capped, or to list one record type, read
  `research_query({section: "external_collections", place, recordType})`. Drop
  "collapse duplicate URLs" and the in-window `totalForPlace` reading.
- `tools:`: add `research_query` under all three spellings.
- It already knows `projectPath` (:159). Standalone Q&A with no project: omit
  `projectPath` (a non-project path returns `collectionsError`).

### gps-mentor (`agents/gps-mentor.md`, `docs/specs/gps-mentor-agent-spec.md`)
- `tools:`: remove `external_links_search` (three spellings).
- Checks 2 (FAN) and 4 (repository diversity) (~:471-490) and the tool-guidance entry
  (~:727): read `project_context.externalCollections` (place absent = never fetched →
  report that as a finding, suggested_skill locality-guide) and
  `research_query({section: "external_collections", place, recordType})` to name sites.
  `research_query` alone cannot tell never-fetched from empty (spec §2.4).
- Spec: lines ~165, :337-345, :988-989.
- `tests/packaging/agent-tool-names.test.ts` snapshot: gps-mentor loses
  `external_links_search`, locality-guide gains `research_query`.

## 4. Eval harness

### Mock (`mock_mcp.py`)
`external_links_search` stays fixture-backed (the compiled tool calls the network), with
a **real side effect** like `same_person`/`person_read` (~:991-1010): when the call
passes `projectPath`, run the compiled `dedupeCollections` + `recordExternalCollections`
over the fixture's never-served `stored_rows` key (raw API rows `{url, linkText,
record_type, place, ...}`), falling back to `response.results` mapped to `{url,
linkText}` when absent (`dedupeCollections` falls back to the queried place). The served
`response` never carries `record_type`/`place` (production inline rows are
`{url, linkText}`). The mock adds `stored: {file, places}` exactly as production does
when the workspace is a project. Response drops staging fields. Check
`mcp-fixture-shape.test.ts` accepts the new top-level key (add it if it pins keys). Unit test in `test_mock_mcp.py`: a fixture call with
`projectPath` leaves an `external-collections.json` that `research_query` reads back.

### Fixtures
Add `stored_rows` (raw rows with `record_type`, `place`) to every fixture whose test
can now read by record type after a fetch-when-absent: at least `schuylkill`,
`schuylkill-1870-census`, `pa-census`, `mixed-sites`, `massachusetts`, `pennsylvania`,
`any`, and the research-plan ones (spain, sweden, denmark, kentucky, blount, texas,
feliciana, rowan-county). `zero-results`/`baiersbronn` stay empty. Record types use
FamilySearch's own strings (e.g. "Census", "Probate"). Delete
orphans `kongsberg`, `trysil` only if `git grep` confirms nothing loads them.

### Scenarios
`eval/harness/harness/workspace.py` (:104-107): add `"external-collections.json"` to
the staging tuple.

- Do **not** edit `mid-research-flynn` (21 suites, 114 tests) or `flynn-census-exhausted`
  (4 suites). New variants:
  - `mid-research-flynn-collections`: `mid-research-flynn` + a seeded
    `external-collections.json` + one `planned` Ancestry plan item carrying a stored
    `collection_url`. Used only by the new acceptance-#9 search-external-sites test.
- With fetch-when-absent, existing research-plan / search-external-sites scenarios need
  no seed: the mock's side effect writes the file on the first fetch. Seeds only where a
  test must start with a stored list (the new collection-url tests, and
  `flynn-census-nil` per the issue).
- `flynn-census-nil` (search-records only): seed it (issue step 5).
- Generate every seeded file with the compiled store (a dev script under
  `eval/harness/scripts/` or a one-off `node --eval`), never by hand, so it matches the
  tool's bytes.

### Validators
- `test_search_external_sites.py` #2521 provenance (:926-1132): replace the prose scan
  with: an Ancestry id (`/search/collections/<id>` or `?dbid=<id>`) is backed when
  `ancestry:<id>` is a stored row key in `after_state["files"]["external-collections.json"]`
  (`json.loads`; absent → "no list" → unbacked). Delete `_collection_id_is_backed`'s
  prose predicate, `_ID_FIELD_NAMES`, `_CTX_*`, `_TRACE_SECTIONS`, `_mentions_collection`,
  stale docstring figures. Keep tier 2 (reporting-only). Export a small
  `backed_ancestry_ids(collections_doc)` helper for §9.1's script.
- Unit tests (`test_search_external_sites_validator.py` :397-668): replace the prose
  cases with: `/collections/<id>` backed, `?dbid=<id>` backed (fails on main: dbid
  skip), unbacked id fires, no file → fires, malformed file → handled. Show each red
  first.
- V2 (:696-730): delete the `external_links_search` loop and docstring half; keep the
  `external_site` half, `_new_external_entries`, `_plan_items`; delete
  `test_v2_fires_when_a_links_entry_carries_external_site`; adjust the two other
  `_links_entry` tests.
- `test_no_external_search_or_log_on_routeaway_negative` (:445-487): drop the
  `external_links_search` half (`build_external_search_url` already there).
- `test_search_records.py:484` live-callee: assert `build_external_search_url`;
  update `test_handoffs.py:119` (feeds the old tool) and
  `search-records/live-callee-external-sites-escalation.json` description +
  judge_context (:42, :44).
- `test_research_plan.py` `_TRACEABLE_ID_TOOLS` (:586): add `research_query` so a
  rationale's collection id grounds against the stored rows it read; keep
  `external_links_search` for old logs.
- `validators_lib.py:330` capture-pending guard: keep (legacy entries).
- Rubric `search-external-sites/rubric.md` Tool selection (:40-48) and the
  `judge_context` of `findmypast-irish-birth.json`, `mixed-sites-filter-dedupe.json`:
  rewrite for "plan item's `collection_url` as `baseUrl`, else site-wide".

- `eval/harness/e2e/advisory_report.py:100` `SEARCH_TOOLS`: drop
  `external_links_search` (no longer carries the staging notes; its fetches are not
  log-owed searches).

### Other docs
- `docs/skill-dataflow.md` rows 3, 4, 5b.
- `research-log-append.ts:~1618` `tool` param description example.

### e2e
- `eval/harness/e2e/result.py`: `external_collection_keys: dict[str, list[str]]`
  (place → sorted `ancestry:<id>` keys), default `{}`.
- `eval/harness/e2e/orchestrator.py` ~:3595: read `workspace/external-collections.json`
  (absent/malformed → `{}`) and pass it in. Unit test.
- `build-external-search-url-tool-spec.md` §9.1: script uses the new predicate over
  `external_collection_keys`; corpus figures re-measured (the issue says 12 of 34 log
  entries — re-measure, don't copy); withdraw the staged-sidecar sentence (:935-939).
  `corpus-figures.test.ts` guards this text — new figures carry the measured-at stamp.

## 5. Site list accounting

`git grep -l external_links_search -- eval packages docs ':!eval/runlogs'` (115 files):
each hit is changed or listed as unaffected in the PR body. Known unaffected:
`places-guidance.md` copies (ruling), `historical-context.md`, `tree-edit.md`,
`manifest.json`, `place-resolver.ts`, `server.ts`, `tool-result.ts`, deep-dive and
findings docs (historical), `ResearchLogSection.test.tsx` (label only).

## 6. Verification

Free: `make engine-test`, `make harness-test`, `make test-js`, `make typecheck`,
`make server-test`, `make test-all`. Every new test/lint shown red first.

Paid (ask the user before running; ~$8-12 and ~1 h each, plus a genealogist annotation):
the suites `check_runlogs.py` gates on the final diff — expected locality-guide,
research-plan, search-external-sites, gps-mentor (and every skill whose SKILL.md
names `@plugin:gps-mentor`), search-records. Run `check_runlogs.py` on the diff to get
the exact list before asking.

By hand only (PR body): `research_query` grant binds for locality-guide in Cowork.

## Acceptance (each fails on main)
1. `external_links_search` with `projectPath` returns no `staged`/`unloggedSearches`/
   `nilSearchNeedsLog` (engine test).
2. A legacy staged `external_links_search` file is not counted as unlogged (engine test).
3. `research_append` refuses a `collection_url` not in the stored list, accepts one
   that is (engine test).
4. gps-mentor holds no `external_links_search`; locality-guide holds `research_query`
   under three spellings (`agent-tool-names.test.ts`).
5. A `?dbid=<id>` URL whose `ancestry:<id>` is stored is backed; an unstored id fires
   (validator unit tests).
6. A mock `external_links_search` fixture call with `projectPath` writes a file
   `research_query` reads back (`test_mock_mcp.py`).
7. e2e result carries `external_collection_keys` (unit test).
8. `research_append` refuses an inline `plans` item with an unstored
   `collection_url` (engine test).
9. New search-external-sites test (planned item with `collection_url`): validator
   asserts `baseUrl == collection_url` and no `external_links_search` call.
10. New research-plan test tagged `collection-url`: validator asserts a non-FamilySearch
   item carries a stored `collection_url`.
11. Paid runs of the gated suites pass those validators.
