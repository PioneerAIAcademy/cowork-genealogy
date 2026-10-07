# External Links Search Tool — Implementation Spec

## Overview

An MCP tool that returns FamilySearch-curated genealogy resource URLs
for a place and optional year range. Given a FamilySearch place ID and an
optional `[startYear, endYear]` window, it fetches every collection FS knows
about for that place, filters to those whose own date range overlaps
the requested window (when years are given), and returns the resource URLs
(plus their human-readable link text).

This wraps the **public** `/external/collections/search` endpoint —
no OAuth required. It complements the existing `collections_search` tool
(authenticated, surfaces FS's own collections) and the in-flight
`record_search` tool (authenticated, surfaces individual person records).
Where those two scope inward (record collections inside FS, persons
inside collections), `external_links_search` scopes outward — pointing the
user at the third-party genealogy resources FS curates on its wiki.

### Composition with sibling tools

A near-term workflow this tool participates in:

```
place_search({ query })  → standardPlace name, place data
        ↓
external_links_search({ standardPlace, startYear?, endYear? })
        → curated third-party URLs covering that place + optional year window
```

The `place_search` tool (sibling in this server) is the upstream source
of standard place names. `external_links_search` resolves the `standardPlace`
name to a place ID internally; the caller passes the name, not an ID.
**The LLM should pass the `standardPlace` name from `place_search`, not a
guessed place ID.**

### Why no `recordType` filter

An earlier draft of this spec proposed a `recordType` enum input.
A direct curl with `recordType=Census` showed the parameter is **not
honored**: the response included Marriages, Military, Civil
Registration, and undated wiki links regardless. The field was
dropped from the schema rather than papered over with client-side
filtering. The contract is "URLs whose date range overlaps the
window," not "URLs of a specific record category."

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `standardPlace` | string | Yes | Standard place name (the `standardPlace` field from `place_search`, e.g. `"France"`). Resolved to a FamilySearch place ID internally. |
| `startYear` | number (integer, 1500–2100) | No | Earliest year of interest (inclusive). When omitted, the lower bound widens to −infinity. |
| `endYear` | number (integer, 1500–2100) | No | Latest year of interest (inclusive). When omitted, the upper bound widens to +infinity. Must be `>= startYear` when both are given. |

Validation:

- `standardPlace` must be a non-empty string; the tool resolves it to a place ID via `resolveStandardPlaceToPlaceId` and throws a discriminated error: `Could not resolve "<name>" ...` when unresolvable, or a candidate-naming error when ambiguous (see Error Handling).
- `startYear` and `endYear` are optional integers in `[1500, 2100]`.
- When both years are provided, `endYear >= startYear` is enforced
  inside the handler — the JSON Schema reports the range constraints,
  and the handler throws a model-actionable error before any network
  call if the order is inverted.
- When BOTH years are omitted, the tool returns all dated resources
  PLUS undated wiki/website resources for the place. A single provided
  bound is a half-open filter (the missing bound widens to ±infinity).

Examples:

```json
{ "standardPlace": "France", "startYear": 1880, "endYear": 1950 }
```

```json
{ "standardPlace": "France" }
```

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Echo of the input: `{ standardPlace, startYear?, endYear? }`. Only includes the years that were actually provided. |
| `totalForPlace` | number | Distinct curated resources for the fetch (after dedupe, below), **before** the date filter. The only non-derivable count. |
| `unloggedSearches` | string \| undefined | Present **only** when this project holds staged search responses with no `research.json` log entry. Advisory; serialized before `results`. Contract and rationale: `record-search-tool-spec-v2.md`. |
| `nilSearchNeedsLog` | string \| undefined | Present **only** when `projectPath` was supplied and the **pre-filter** link set was empty. Keyed on the pre-filter set deliberately: `results` below is host-filtered and capped, so a `host:` search whose links all sit on other hosts returns an empty `results` with a non-null `staged` — claiming a nil there would order a negative finding for a place that has records. |
| `results` | `{ url, linkText }[]` | URLs FS curates for this place, deduplicated, year-filtered when years are given, host-filtered when `host` is given, and capped at 200. |
| `inlineCapped` | `true` \| undefined | Present when the 200 cap cut `results`. The stored list and the staged sidecar hold the full set. |
| `stored` | `{ file, places }` \| undefined | Present when `projectPath` names a project: `external-collections.json` and the places whose entries this fetch wrote. See "Stored list". |
| `collectionsError` | string \| undefined | Why the stored list was not written — a write failure, or a `projectPath` that is not a project folder. The search itself succeeded. |

Each `results[]` item:

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Direct URL to the curated resource (Ancestry, MyHeritage, FindMyPast, archives, wiki page, etc.). |
| `linkText` | string | Human-readable link text from the FS wiki. May be empty for malformed entries. |

Example:

```json
{
  "query": { "standardPlace": "France", "startYear": 1880, "endYear": 1950 },
  "totalForPlace": 138,
  "results": [
    {
      "url": "https://www.findmypast.com/search/results?...",
      "linkText": "Passenger Lists Leaving UK, 1890-1960"
    },
    {
      "url": "https://www.myheritage.com/research/collection-14009/...",
      "linkText": "France, Censuses of Hérault, 1836-1936"
    }
  ]
}
```

`totalForPlace` is the single pre-filter count (intentionally named
differently from `volume_search`'s post-filter `totalResults`). It is
reported so the LLM can distinguish "place has no data" (`totalForPlace:
0`) from "place has data but nothing in this window" (`results: [],
totalForPlace: 12` reads as "resources exist here, just not in your
years"). The matched count is simply `results.length` — there is no
separate field for it, and there is no `totalResults` field.

**Dedupe.** FS returns the same collection many times, once per category,
with link text, cost and years that disagree between copies and in a different
order on every call (2026-10-07: 84 of Pennsylvania's 350 distinct URLs come
back as several disagreeing rows). The tool collapses them to one row per
(link `place`, collection key):

- **Key.** An Ancestry `/search/collections/<id>` (with or without a trailing
  slash) or `?dbid=<id>` URL keys on `ancestry:<id>`; a MyHeritage
  `collection-<id>` URL keys on the URL without its query string (tracking
  parameters); any other URL keys on itself.
- **Merge, order-independent.** Candidates are sorted by their whole field tuple
  (url, link text, cost, content type, years, record type), compared by code
  unit. Link text, cost and content type come from the first. `record_types` is
  every candidate's type, sorted. Years: when any candidate is undated the merged
  row is undated; otherwise it spans the hull of every candidate's range (a
  one-sided candidate counts as that single year). Either way the year filter
  includes the merged row whenever it would have included one of its copies. A
  URL whose query scopes the site's search to the place (`?arrival=_pennsylvania-usa_41`)
  is kept over one without; tracking and id parameters (`utm_*`, `tr_*`, `s`,
  `h`, `dbid`, `fbclid`, `gclid`, `ref`) do not count as scoping.
- **Order.** Stored rows sort by place, then key. The inline copy puts the most
  specific place first (more comma segments), stable over that order, so a
  county's own rows lead and the 200 cap falls on the end of its state's list;
  `inlineCapped` says when it cut.

---

## Tool Schema

```typescript
{
  name: "external_links_search",
  description:
    "Return FamilySearch-curated third-party genealogy resource URLs for a place and optional year range. " +
    "Use when the user wants links to external record collections (Ancestry, MyHeritage, FindMyPast, " +
    "national archives, etc.) covering a specific place by standard place name and (optionally) time period. " +
    "When years are given, returns every collection whose date range overlaps [startYear, endYear], plus " +
    "undated wiki/website resources. When years are omitted, returns all resources for that place. " +
    "Pass the standard place name (the `standardPlace` field from place_search).",
  inputSchema: {
    type: "object",
    required: ["standardPlace"],
    properties: {
      standardPlace: {
        type: "string",
        description:
          "The standard place name (the `standardPlace` field from place_search, e.g. 'France'). " +
          "The tool resolves it to a FamilySearch place ID internally."
      },
      startYear: {
        type: "integer",
        minimum: 1500,
        maximum: 2100,
        description: "Optional. Earliest year of interest (inclusive). When omitted, the lower bound widens to -infinity."
      },
      endYear: {
        type: "integer",
        minimum: 1500,
        maximum: 2100,
        description: "Optional. Latest year of interest (inclusive). When omitted, the upper bound widens to +infinity. Must be >= startYear when both are given."
      }
    }
  }
}
```

---

## Authentication

This tool **does not require authentication**. The endpoint is public,
unlike the sibling `collections_search` and `record_search` tools which call
`getValidToken(principal)`. Do not add auth to this tool's handler.

---

## FamilySearch API Reference

**Endpoint (no auth required):**

```
GET https://www.familysearch.org/service/search/hr/external/collections/search
    ?q.placeId=<placeId>
    &offset=<offset>
    &count=<count>
```

**Headers:**

| Header | Value | Why |
|--------|-------|-----|
| `User-Agent` | Chrome browser UA (same constant `collections.ts` uses) | FS's WAF (Imperva/Incapsula) blocks the simple identifying UA on this endpoint with a 403 — confirmed via curl. The endpoint sits behind the same WAF rules as `/v2/collections`, so the same UA pattern works. |
| `Accept` | `application/json` | Without this, FS may return HTML. |

The `USER_AGENT` constant is duplicated between `collections.ts` and
`external-links-search.ts` for now. Both tools share the same WAF-bypass need;
when a third tool follows the same pattern (or any other shared FS
constant emerges), factor into a shared module.

**One request, never paging.** The tool asks for `offset=0&count=1000`.
`count=1000` returns a place's whole list (measured 2026-10-07: Pennsylvania
510/510, Schuylkill 512/512, Venango 510/510, England 753/753; New York 795/795
earlier); `count=1001` is HTTP 400. Offset paging is wrong here, not merely slow:
the endpoint's order changes on every call, so pages repeat and skip rows (six
paged fetches of Venango's 510 gave 337–365 distinct rows).

**A partial list is an error, never an answer**, and nothing is stored:

| Response | Result |
|----------|--------|
| no numeric `totalResults` | error: completeness cannot be told |
| `totalResults` > 1000 | error naming a smaller scope — a state or county, not a whole country (the United States has 1,998) |
| `totalResults` > rows returned | error: the list is partial |

A place with no curated links answers `{"totalResults": 0, "collections": []}`,
which is a complete, empty list.

**Response shape (observed via curl):**

```json
{
  "count": 100,
  "offset": 0,
  "totalResults": 221,
  "collections": [
    {
      "url": "https://...",
      "linkText": "...",
      "place": "France",
      "startYear": "1866",   // string; may be ""
      "endYear": "1866",     // string; may be ""
      "record_type": "Census",
      "recordTypeId": "3",
      "cost": "free|paid",
      "content_type": "index & images",
      "source_url": "https://www.familysearch.org/en/wiki/..."
    }
  ]
}
```

The implementation reads `url`, `linkText`, `place`, `startYear`, `endYear`,
`record_type`, `cost` and `content_type`; it drops `recordTypeId` and
`source_url`.

---

## Stored list (`external-collections.json`)

**Decided (lead, 2026-10-05 and 2026-10-06):** with `projectPath`, the tool keeps
every link it fetched in one host-written file at the project root, beside
`research.json`, so later steps read real collection ids instead of recalling
them.

```json
{ "places": { "<place>": { "rows": [ { "key", "url", "link_text", "record_types",
  "place", "cost", "content_type", "start_year", "end_year" } ] } } }
```

- **Keyed by each link's own `place`.** A county lookup returns its state's whole
  list plus the county's own links, so the rows are split by `place`: the state
  entry is written once however many of its counties are fetched, and the county
  entry holds only its own rows. The queried place always gets an entry, `rows:
  []` when no row carries it, so "fetched, nothing specific to this place" differs
  from "never fetched". The queried place is the caller's `standardPlace` as
  given; a bare `"England"` therefore gets an empty entry beside the 753 rows
  tagged `England, United Kingdom`, and `research_query({place: "England"})`
  reaches none of them — pass `place_search`'s full name.
- **The full list, always.** Every row, every year, every host: `startYear`,
  `endYear` and `host` narrow only the inline copy.
- **Same bytes for the same data.** Places and rows are sorted, nothing is
  time-stamped, and the dedupe above is order-independent, so fetching a place
  again rewrites an identical file (on the file store; a jsonb store keeps values,
  not bytes). It is pretty-printed through `ProjectStore.writeJson`, because a
  researcher reads it.
- **Host-written only.** Written by `src/utils/external-collections-store.ts`
  under `withProjectLock`, only when `classifyProjectPath` says the folder is a
  project — never created elsewhere; a `projectPath` that is not a project is
  reported as `collectionsError`, not skipped silently. A raw model write is
  denied by the plugin hook and its two copies (`PROTECTED_PROJECT_FILES`). A
  write failure never fails the search; it is reported as `collectionsError`. A
  stored file that is not valid JSON, or not this shape, is rebuilt from the
  fetch; any other read failure fails the write, so it cannot wipe the other
  places' lists.
- **Read back** by `research_query({section: "external_collections", place,
  recordType})` and as per-place counts in `project_context`'s
  `externalCollections`.
- **Not validated.** It is API data, not a `research.json` section: no schema,
  validator, `ownership.json` or `packages/schema` entry.

**Rejected alternatives.** A `research.json` section: the hosted viewer re-sends
the whole of `research.json` on every write, and the lists are about 136–211 KB
per state. A hidden `results/.collections/<slug>.json`, and one file per place:
the researcher should see the list, and per-link `place` keys already dedupe
overlapping fetches inside one file.

---

## Overlap Logic

A collection is included in `results[]` if its date range overlaps the
user's `[startYear, endYear]` window. When the user omits a bound, that
side of the window widens to ±infinity (a missing `startYear` → −infinity,
a missing `endYear` → +infinity). When BOTH years are omitted, every
dated resource passes the filter, and undated resources are included as
always.

**Year parsing:** API year fields are strings (`"1866"`, `""`). Empty
strings parse as `null`.

**Cases (per collection, given the effective window):**

| Collection state | Decision |
|---|---|
| Both years null (undated wiki/website link) | Include ALWAYS, regardless of the year filter — permissive default. |
| One year null | Treat the missing side as equal to the present one (e.g. `[1900, null]` → `[1900, 1900]`). |
| Both years present | Include if `cStart <= userEnd AND cEnd >= userStart` (with `userStart`/`userEnd` widened to ±infinity for any omitted bound). |

The permissive empty-year default was an explicit product decision —
undated FS wiki resources ("France Genealogy Resources List") are
still useful and excluding them would silently drop ~70% of results
for some places.

`endYear < startYear` at input (when both are provided) is rejected by
the handler before any network call.

---

## Error Handling

All thrown errors are written as **instructions to the LLM**, per the
project convention:

| Condition | Handler behavior |
|-----------|------------------|
| `startYear`/`endYear` provided but non-numeric | Throw: `"startYear and endYear must be numeric when provided. Re-read the tool's input schema and retry with corrected arguments."` |
| `endYear < startYear` (both provided) | Throw: `"endYear must be greater than or equal to startYear. Re-read the tool's input schema and retry with corrected arguments."` |
| `standardPlace` resolves to NOTHING | Throw: `"Could not resolve \"<name>\" to a FamilySearch place. Use place_search to get a standard place name first."` |
| `standardPlace` resolves to SEVERAL distinct places | Throw, naming them: `"\"<name>\" matches more than one place: <candidate>; <candidate>. Pass one of these exactly as listed, including the parenthesised type, as standardPlace, or call place_search to see the full list."` Each candidate is `fullName (type)`, one per distinct placeId, capped at 8. The parenthesised `(Type)` suffix is the disambiguation grammar: passing `"Baltimore, Maryland, United States (Independent City)"` resolves to the city's placeId. |
| HTTP 403 | Throw: `"FamilySearch rejected the request (403 Forbidden). This usually means a User-Agent block — check that the MCP server is running an unmodified build."` |
| HTTP 429 | Retried by `fetchWithRetry` (up to 3 attempts, 10s budget). If still 429 after exhaustion, throw: `"FamilySearch rate limit reached and did not clear within the retry budget. Wait 60 seconds and retry once. If it persists, surface this to the user."` |
| Other non-2xx | Throw: `"FamilySearch external-links API error: ${status} ${statusText}."` |
| Invalid JSON in response | Throw: `"FamilySearch returned a response that was not valid JSON. Retry once; if it persists, surface this to the user."` |
| Empty page mid-pagination | Stop the internal loop. Return what we have. |
| Zero matches after filter | Return `results: []` (with the place's `totalForPlace`). Not an error. |

---

## Files

### `packages/engine/mcp-server/src/types/external-links-search.ts`

Internal API response types (`FSPlaceExternalCollection`, `FSPlaceExternalResponse`)
and output types (`PlaceExternalLink`, `ExternalLinksSearchResult`), plus the
input type `ExternalLinksSearchInput`.

### `packages/engine/mcp-server/src/tools/external-links-search.ts`

- `externalLinksSearchToolSchema` — MCP tool schema (hand-rolled JSON Schema,
  matching the existing tools' style).
- `externalLinksSearchTool(input)` — main handler: validate, fetch once, refuse a
  partial list, dedupe, store, filter by overlap, map to `{ url, linkText }`.
- `fetchAll(placeId)` — the one HTTP call (`offset=0&count=1000`) with
  model-actionable error mapping.

### `packages/engine/mcp-server/src/utils/external-collections-store.ts`

`collectionKey`, `dedupeCollections`, `readExternalCollections`,
`recordExternalCollections` — the stored list (see "Stored list").
- Internal helpers: `parseYear`, `includeCollection` (the overlap rule), `includeRow`.

### `packages/engine/mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools,
CallTool).

### `packages/engine/mcp-server/tests/tools/external-links-search.test.ts`

Vitest cases covering the happy path, the one-request fetch, the partial-list
and oversize errors, the inline cap, error modes and handler-level guards. All use
a stubbed global `fetch` — no real network. `tests/tools/external-links-search-store.test.ts`
covers the dedupe and the stored list on a real temp project: byte-identical
re-fetch, county/state split, one state copy across counties, the `research_query`
section and `project_context` counts.

### `packages/engine/mcp-server/dev/try-external-links-search.ts`

One-shot smoke script that invokes `externalLinksSearchTool()` against the live
API. Bypasses the MCP harness for fast debugging. Modeled on
`try-collections.ts`.

---

## Testing

### `tests/tools/external-links-search.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns matching collections with url + linkText only | Happy path + field stripping |
| 2 | Includes collections with empty start/end years | Permissive empty-year inclusion (always) |
| 3 | Fetches the whole list in ONE request (offset=0, count=1000) — never pages | One request; inline cap 200 + `inlineCapped` |
| 4 | Refuses a response with no totalResults / a partial list / a place over 1,000 | The three completeness errors; nothing stored (`external-links-search-store.test.ts`) |
| 5 | Returns empty results cleanly for a place that resolves but has no collections | Empty-data path (`results: []`, `totalForPlace: 0`) |
| 6 | Throws an instructional error on 403 | Rate-limit / WAF error wording |
| 7 | Throws an instructional error on 429 | Rate-limit error wording |
| 8 | Throws a retry-once error on generic 5xx | Transient-error wording |
| 9 | Throws an instructional error on malformed JSON | Parse-failure handling |
| 10 | Rejects endYear < startYear without hitting the network | Handler-level guard + no fetch |
| 11 | Returns all resources when both years are omitted | Optional-years path; `query` omits years; `totalForPlace` set |
| 12 | Rejects empty standardPlace without hitting the network | Handler-level guard + no fetch |
| 13 | No negative-log note when the host filter emptied `results` but links were staged | The note keys on the pre-filter set, not on `results` |
| 14 | Negative-log note when the place itself has no links at all | Genuine nil for that place and year window |
| 15 | Carries `unloggedSearches`, ordered before `results` | Staged-backlog note + key order |

### Smoke-test script

```bash
cd packages/engine/mcp-server
npx tsx dev/try-external-links-search.ts "France" 1880 1950   # France, populated
npx tsx dev/try-external-links-search.ts "France" 1700 1750   # France, sparse
npx tsx dev/try-external-links-search.ts "France"             # France, no years (all resources)
```

---

## Verification

### Automated

```bash
cd packages/engine/mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)

```bash
cd packages/engine/mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

- Call `external_links_search({ standardPlace: "France", startYear: 1880, endYear: 1950 })` → 125 deduplicated results plus `totalForPlace: 138` (measured 2026-10-07; the API's raw `totalResults` is larger, since it repeats links).
- Call with `startYear: 1700, endYear: 1750` → far fewer results (proves the filter works); `totalForPlace` unchanged.
- Call with `external_links_search({ standardPlace: "France" })` (no years) → all resources for the place; `query` echoes only `{ standardPlace: "France" }`.
- Call with `startYear: 1950, endYear: 1880` → handler error mentioning `endYear must be greater than or equal to startYear`.
- Call with `standardPlace: "Nowhere"` → resolution error mentioning `Could not resolve "Nowhere"`.

### Manual Layer 2 (Claude Code)

- "Find FamilySearch resources for France between 1880 and 1950." — Claude should call `external_links_search` with `standardPlace: "France"` and those years and present the URLs.

---

## Out of scope

- Place ID lookup (handled by the `place_search` tool).
- OAuth (this endpoint is public).
- Deduplication of repeated URLs (FS-side data quality issue; flagged
  as future product decision).
- `recordType` filtering (FS endpoint does not honor the param).
