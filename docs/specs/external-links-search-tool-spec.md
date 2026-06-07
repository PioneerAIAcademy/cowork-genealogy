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

- `standardPlace` must be a non-empty string; the tool resolves it to a place ID via `standardPlaceToPlaceId` and throws `Could not resolve "<name>" ...` when it cannot (unresolvable or ambiguous).
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
| `totalForPlace` | number | Total curated resources FS knows about for the resolved place, **before** the date filter. The only non-derivable count. |
| `results` | `{ url, linkText }[]` | URLs FS curates for this place, year-filtered when years are given. **`results.length` IS the matched count** — there is no separate count field. |

Each `results[]` item:

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Direct URL to the curated resource (Ancestry, MyHeritage, FindMyPast, archives, wiki page, etc.). |
| `linkText` | string | Human-readable link text from the FS wiki. May be empty for malformed entries. |

Example:

```json
{
  "query": { "standardPlace": "France", "startYear": 1880, "endYear": 1950 },
  "totalForPlace": 221,
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

Pass-through behavior: the output preserves whatever order FS returned
and does **not** deduplicate. FS itself returns the same URL multiple
times across categories (e.g. "Search Your French Ancestors" appears
~11 times for France). Whether to dedupe is a future product decision;
default is to preserve API truth.

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
`getValidToken()`. Do not add auth to this tool's handler.

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

**Pagination (observed via curl, not documented):**

| Field | Behavior |
|-------|----------|
| `count` query param | Page size; `count=100` is honored. |
| `offset` query param | Returns the next slice. |
| `totalResults` response field | Total available items for this placeId (the FS API's own field name; surfaced to the caller as `totalForPlace`). |

The tool is **not paginated at the caller boundary**: there is no
`pageToken`/`nextPageToken` in the input or output. Internally the
handler loops fetching pages (using `offset`/`count`) until the place's
full set is retrieved, then returns the complete client-filtered set in
one response. For typical places this is 1–5 internal calls.

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

The implementation only reads `url`, `linkText`, `place`, `startYear`,
`endYear`. The other fields are ignored to keep the output minimal.

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
| HTTP 403 / 429 | Throw: `"FamilySearch rejected the request (status N). This usually means rate limiting or a User-Agent block. Wait 60 seconds and retry once. If it persists, surface this to the user."` |
| Other non-2xx | Throw: `"FamilySearch returned N. Treat this as a transient error and retry once before giving up."` |
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
- `externalLinksSearchTool(input)` — main handler: validate, fetch all pages,
  filter by overlap, map to `{ url, linkText }`.
- `fetchPage(placeId, offset)` — one HTTP call with model-actionable
  error mapping.
- Internal helpers: `parseYear`, `overlapsRange`.

### `packages/engine/mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools,
CallTool).

### `packages/engine/mcp-server/tests/tools/external-links-search.test.ts`

12 vitest cases covering happy path, multi-page fetching, error modes, and
handler-level guards. All use a stubbed global `fetch` — no real
network.

### `packages/engine/mcp-server/dev/try-external-links-search.ts`

One-shot smoke script that invokes `externalLinksSearchTool()` against the live
API. Bypasses the MCP harness for fast debugging. Modeled on
`try-collections.ts`.

---

## Testing

### `tests/tools/external-links-search.test.ts` (12 cases)

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns matching collections with url + linkText only | Happy path + field stripping |
| 2 | Includes collections with empty start/end years | Permissive empty-year inclusion (always) |
| 3 | Fetches every page until totalForPlace is exhausted | Multi-page internal fetch loop |
| 4 | Stops looping when an empty page is returned | Defensive bail on bad API state |
| 5 | Returns empty results cleanly for a place that resolves but has no collections | Empty-data path (`results: []`, `totalForPlace: 0`) |
| 6 | Throws an instructional error on 403 | Rate-limit / WAF error wording |
| 7 | Throws an instructional error on 429 | Rate-limit error wording |
| 8 | Throws a retry-once error on generic 5xx | Transient-error wording |
| 9 | Throws an instructional error on malformed JSON | Parse-failure handling |
| 10 | Rejects endYear < startYear without hitting the network | Handler-level guard + no fetch |
| 11 | Returns all resources when both years are omitted | Optional-years path; `query` omits years; `totalForPlace` set |
| 12 | Rejects empty standardPlace without hitting the network | Handler-level guard + no fetch |

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

- Call `external_links_search({ standardPlace: "France", startYear: 1880, endYear: 1950 })` → `~178` results plus `totalForPlace: 221`.
- Call with `startYear: 1700, endYear: 1750` → far fewer results (proves the filter works); `totalForPlace` unchanged at `221`.
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
