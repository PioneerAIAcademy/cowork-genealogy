# External Links Tool — Implementation Spec

## Overview

An MCP tool that returns FamilySearch-curated genealogy resource URLs
for a place and year range. Given a FamilySearch place ID and a
`[startYear, endYear]` window, it fetches every collection FS knows
about for that place, filters to those whose own date range overlaps
the requested window, and returns the resource URLs (plus their
human-readable link text).

This wraps the **public** `/external/collections/search` endpoint —
no OAuth required. It complements the existing `collections` tool
(authenticated, surfaces FS's own collections) and the in-flight
`search` tool (authenticated, surfaces individual person records).
Where those two scope inward (record collections inside FS, persons
inside collections), `external_links` scopes outward — pointing the
user at the third-party genealogy resources FS curates on its wiki.

### Composition with sibling tools

A near-term workflow this tool participates in:

```
places({ query: "France" })  → placeId, place name, etc.
        ↓
external_links({ placeId, startYear, endYear })
        → curated third-party URLs covering that place + year window
```

The `places` tool (sibling in this server) is the upstream source of
place IDs. `external_links` does not resolve place names to IDs; the
place ID must come from the caller. **The LLM should not guess place
IDs.**

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
| `placeId` | string | Yes | FamilySearch place ID (numeric string), e.g. `"1927089"` for France. Sourced from the `places` tool. |
| `startYear` | number (integer, 1500–2100) | Yes | Earliest year of interest (inclusive). |
| `endYear` | number (integer, 1500–2100) | Yes | Latest year of interest (inclusive). Must be `>= startYear`. |

Validation:

- `placeId` must be a non-empty string.
- `startYear` and `endYear` must be integers in `[1500, 2100]`.
- `endYear >= startYear` is enforced inside the handler — the JSON
  Schema reports the range constraints, and the handler throws a
  model-actionable error before any network call if the order is
  inverted.

Example:

```json
{ "placeId": "1927089", "startYear": 1880, "endYear": 1950 }
```

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `place` | string \| null | Place name resolved by FS (e.g. `"France"`). `null` if no collections were returned. |
| `totalResults` | number | Raw total reported by the FS API for this `placeId` (before overlap filter). |
| `matchedCount` | number | Number of items in `results[]` after overlap filter. |
| `results` | `{ url, linkText }[]` | URLs FS curates for this place that overlap the requested year range. |

Each `results[]` item:

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Direct URL to the curated resource (Ancestry, MyHeritage, FindMyPast, archives, wiki page, etc.). |
| `linkText` | string | Human-readable link text from the FS wiki. May be empty for malformed entries. |

Example:

```json
{
  "place": "France",
  "totalResults": 221,
  "matchedCount": 178,
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

`totalResults` and `matchedCount` are both reported on purpose: the
difference lets the LLM distinguish "place has no data" from "place
has data but nothing in this window."

Pass-through behavior: the output preserves whatever order FS returned
and does **not** deduplicate. FS itself returns the same URL multiple
times across categories (e.g. "Search Your French Ancestors" appears
~11 times for France). Whether to dedupe is a future product decision;
default is to preserve API truth.

---

## Tool Schema

```typescript
{
  name: "external_links",
  description:
    "Return FamilySearch-curated third-party genealogy resource URLs for a place and year range. " +
    "Use when the user wants links to external record collections (Ancestry, MyHeritage, FindMyPast, " +
    "national archives, etc.) covering a specific place by FamilySearch place ID and time period. " +
    "Returns every collection whose date range overlaps [startYear, endYear], plus undated wiki/website " +
    "resources for that place. Requires a place ID — do not guess; obtain it from the places tool " +
    "or the user.",
  inputSchema: {
    type: "object",
    required: ["placeId", "startYear", "endYear"],
    properties: {
      placeId: {
        type: "string",
        description:
          "FamilySearch place ID (numeric string), e.g. '1927089' for France. " +
          "Get this from the places tool, not by guessing."
      },
      startYear: {
        type: "integer",
        minimum: 1500,
        maximum: 2100,
        description: "Earliest year of interest (inclusive)."
      },
      endYear: {
        type: "integer",
        minimum: 1500,
        maximum: 2100,
        description: "Latest year of interest (inclusive). Must be >= startYear."
      }
    }
  }
}
```

---

## Authentication

This tool **does not require authentication**. The endpoint is public,
unlike the sibling `collections` and `search` tools which call
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
`external-links.ts` for now. Both tools share the same WAF-bypass need;
when a third tool follows the same pattern (or any other shared FS
constant emerges), factor into a shared module.

**Pagination (observed via curl, not documented):**

| Field | Behavior |
|-------|----------|
| `count` query param | Page size; `count=100` is honored. |
| `offset` query param | Returns the next slice. |
| `totalResults` response field | Total available items for this placeId. |

For typical places this is 1–5 calls. The implementation caps the
loop at `MAX_PAGES = 50` (5,000 results) as a safety against an API
that misreports `totalResults`.

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
user's `[startYear, endYear]`.

**Year parsing:** API year fields are strings (`"1866"`, `""`). Empty
strings parse as `null`.

**Cases:**

| Collection state | Decision |
|---|---|
| Both years null (undated wiki/website link) | Include — permissive default. |
| One year null | Treat the missing side as equal to the present one (e.g. `[1900, null]` → `[1900, 1900]`). |
| Both years present | Include if `cStart <= userEnd AND cEnd >= userStart`. |

The permissive empty-year default was an explicit product decision —
undated FS wiki resources ("France Genealogy Resources List") are
still useful and excluding them would silently drop ~70% of results
for some places.

`endYear < startYear` at input is rejected by the handler before any
network call.

---

## Error Handling

All thrown errors are written as **instructions to the LLM**, per the
project convention:

| Condition | Handler behavior |
|-----------|------------------|
| `endYear < startYear` | Throw: `"endYear must be greater than or equal to startYear. Re-read the tool's input schema and retry with corrected arguments."` |
| HTTP 403 / 429 | Throw: `"FamilySearch rejected the request (status N). This usually means rate limiting or a User-Agent block. Wait 60 seconds and retry once. If it persists, surface this to the user."` |
| Other non-2xx | Throw: `"FamilySearch returned N. Treat this as a transient error and retry once before giving up."` |
| Invalid JSON in response | Throw: `"FamilySearch returned a response that was not valid JSON. Retry once; if it persists, surface this to the user."` |
| Pagination cap reached | Log warning to stderr (`[external_links] pagination cap reached`). Return what we have. Do not throw. |
| Empty page mid-pagination | Stop the loop. Return what we have. |
| Zero matches after filter | Return `matchedCount: 0` and `results: []`. Not an error. |

---

## Files

### `mcp-server/src/types/external-links.ts`

Internal API response types (`FSExternalCollection`, `FSExternalResponse`)
and output types (`ExternalLink`, `ExternalLinksResult`).

### `mcp-server/src/tools/external-links.ts`

- `externalLinksToolSchema` — MCP tool schema (hand-rolled JSON Schema,
  matching the existing tools' style).
- `externalLinksTool(input)` — main handler: validate, paginate, filter
  by overlap, map to `{ url, linkText }`.
- `fetchPage(placeId, offset)` — one HTTP call with model-actionable
  error mapping.
- Internal helpers: `parseYear`, `overlapsRange`.

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools,
CallTool).

### `mcp-server/tests/tools/external-links.test.ts`

12 vitest cases covering happy path, pagination, error modes, and
handler-level guards. All use a stubbed global `fetch` — no real
network.

### `mcp-server/dev/try-external-links.ts`

One-shot smoke script that invokes `externalLinksTool()` against the live
API. Bypasses the MCP harness for fast debugging. Modeled on
`try-collections.ts`.

---

## Testing

### `tests/tools/external-links.test.ts` (12 cases)

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns matching collections with url + linkText only | Happy path + field stripping |
| 2 | Includes collections with empty start/end years | Permissive empty-year inclusion |
| 3 | Fetches every page until totalResults is exhausted | Multi-page pagination loop |
| 4 | Stops looping when an empty page is returned | Defensive bail on bad API state |
| 5 | Returns empty results cleanly for unknown placeId | Empty-data path |
| 6 | Throws an instructional error on 403 | Rate-limit / WAF error wording |
| 7 | Throws an instructional error on 429 | Rate-limit error wording |
| 8 | Throws a retry-once error on generic 5xx | Transient-error wording |
| 9 | Throws an instructional error on malformed JSON | Parse-failure handling |
| 10 | Rejects endYear < startYear without hitting the network | Handler-level guard + no fetch |
| 11 | Accepts endYear === startYear (single-year query) | Boundary case |
| 12 | Rejects empty placeId without hitting the network | Handler-level guard + no fetch |

### Smoke-test script

```bash
cd mcp-server
npx tsx dev/try-external-links.ts 1927089 1880 1950   # France, populated
npx tsx dev/try-external-links.ts 1927089 1700 1750   # France, sparse
npx tsx dev/try-external-links.ts 1927164 1880 1950   # Canada
```

---

## Verification

### Automated

```bash
cd mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

- Call `external_links({ placeId: "1927089", startYear: 1880, endYear: 1950 })` → `~178` results, `totalResults: 221`.
- Call with `startYear: 1700, endYear: 1750` → far fewer matches (proves the filter works).
- Call with `startYear: 1950, endYear: 1880` → handler error mentioning `endYear must be greater than or equal to startYear`.
- Call with `placeId: "999999999"` → `place: null`, `totalResults: 0`, `matchedCount: 0`, `results: []`.

### Manual Layer 2 (Claude Code)

- "Find FamilySearch resources for placeId 1927089 between 1880 and 1950." — Claude should call `external_links` with those inputs and present the URLs.

---

## Out of scope

- Place ID lookup (handled by the `places` tool).
- OAuth (this endpoint is public).
- Deduplication of repeated URLs (FS-side data quality issue; flagged
  as future product decision).
- `recordType` filtering (FS endpoint does not honor the param).
