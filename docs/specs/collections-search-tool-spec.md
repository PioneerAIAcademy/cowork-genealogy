# Collections Search Tool — Implementation Spec

## Overview

An MCP tool that lists FamilySearch record collections for a place.
Requires authentication (OAuth tokens obtained via the `login` tool).

Pass `standardPlace` (preferably the standardized place name from
`place_search`, e.g. `"Schuylkill, Pennsylvania, United States"`; a plain
place name also works). The tool derives the right collection scope (see
[Place → collection scope](#place--collection-scope)) and returns the
matching collections with record, person, and image counts.

This tool is list mode only. To get detailed information about a single
collection (the FamilySearch search API response with HTML converted to
markdown), use the separate `collection_read` tool
(spec: `docs/specs/collection-read-tool-spec.md`).

### Place ID mismatch (design note)

The FamilySearch Places API (`/platform/places/`) and the Collections
API (`/service/search/hr/v2/collections`) use **different place ID
systems**. Alabama is 351 in the Places API but 33 in the Collections
API. These IDs are not interchangeable.

The `standardPlace` input works around this — Claude passes the place
**name** (the `standardPlace` from `place_search`, e.g. `"Schuylkill,
Pennsylvania, United States"`), and the tool derives a title-match term
and filters by collection title. `place_search` IDs are never passed to
`collections_search`.

### Place → collection scope

FamilySearch organizes record collections at the **state/province level**
for the United States, Canada, and Mexico, and at the **country level**
everywhere else. The tool derives the title-match term from the
`standardPlace` accordingly (`standardPlaceToCollectionsQuery`):

| Country (last component) | Term used | Example input → term |
|--------------------------|-----------|----------------------|
| United States | the state (second-to-last component) | `"Schuylkill, Pennsylvania, United States"` → `"Pennsylvania"` |
| Canada / Mexico | `"Country, State"` | `"Toronto, Ontario, Canada"` → `"Canada, Ontario"` |
| any other country | the country (last component) | `"Paris, France"` → `"France"` |

A free-text query that isn't a standardPlace (no recognized country tail,
e.g. `"Census"`) passes through unchanged, so an arbitrary place query
still works — but a `standardPlace` is preferred. This conversion is
**internal**: the LLM always passes the full place; it never picks
"country vs state."

The derived scope is surfaced to the caller as the `scope` field in the
output — the "level served" signal (a county input is matched at, and
reported back as, the state level).

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `standardPlace` | string | Yes | The place to list collections for (preferably standardPlace from place_search). |
| `startYear` | integer | No | Earliest year of interest (inclusive). Omit for all periods. |
| `endYear` | integer | No | Latest year of interest (inclusive). Must be ≥ startYear. Omit for all periods. |

Examples:

```json
{ "standardPlace": "Schuylkill, Pennsylvania, United States" }
{ "standardPlace": "Birmingham, Jefferson, Alabama, United States", "startYear": 1850, "endYear": 1900 }
```

---

## Output

Output is an envelope of the form
`{ query, scope, totalForPlace, results }`:

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Echo of the input: `{ standardPlace, startYear?, endYear? }` |
| `scope` | string | The derived FamilySearch collection scope/jurisdiction the titles were matched at (the US/Canada/Mexico state, or the country elsewhere). This is the "level served" signal — a county input is matched at the state level. |
| `totalForPlace` | number | Count of collections matching the scope **before** the optional date filter is applied. Always present. Equals `results.length` when no years are passed. `results: [], totalForPlace: 8` reads as "8 collections cover this place, none in your window." |
| `results` | Collection[] | The matching collection objects (after the optional date filter). |

Each `Collection` object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | FamilySearch collection identifier |
| `title` | string | Human-readable collection name |
| `dateRange` | string | Time period the collection covers (e.g., `"1809-1950"`) |
| `recordCount` | number | Number of records in the collection |
| `personCount` | number | Number of persons in the collection |
| `imageCount` | number | Number of images in the collection |
| `url` | string | Link to the collection on FamilySearch |

Example:
```json
{
  "query": { "standardPlace": "Birmingham, Jefferson, Alabama, United States" },
  "scope": "Alabama",
  "totalForPlace": 29,
  "results": [
    {
      "id": "1743384",
      "title": "Alabama County Marriages, 1711-1992",
      "dateRange": "1711-1992",
      "recordCount": 6049744,
      "personCount": 22361103,
      "imageCount": 1231203,
      "url": "https://www.familysearch.org/search/collection/1743384"
    }
  ]
}
```

When `startYear`/`endYear` are supplied, `totalForPlace` still reflects
all collections matching the scope, while `results` contains only those
overlapping the requested year window:

```json
{
  "query": { "standardPlace": "Birmingham, Jefferson, Alabama, United States", "startYear": 1850, "endYear": 1900 },
  "scope": "Alabama",
  "totalForPlace": 29,
  "results": [ /* the subset of the 29 that overlap 1850–1900 */ ]
}
```

---

## Tool Schema

```typescript
{
  name: "collections_search",
  description:
    "List FamilySearch record collections for a place. Pass `standardPlace` " +
    "— preferably the standardized place name from place_search (e.g. " +
    "\"Schuylkill, Pennsylvania, United States\"); a plain place name also works. " +
    "FamilySearch organizes collections at the state/province level for the " +
    "United States, Canada, and Mexico, and at the country level everywhere else, " +
    "so results come back at that scope; the derived scope is returned in the " +
    "`scope` field (the tool derives it from the place). Optionally pass " +
    "`startYear`/`endYear` to filter the returned collections to those overlapping " +
    "that year window. For detailed information about a single collection, use the " +
    "collection_read tool. Requires authentication — call the login tool first if " +
    "not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      standardPlace: {
        type: "string",
        description: "The place to list collections for — preferably the `standardPlace` from place_search (e.g. \"Schuylkill, Pennsylvania, United States\"). The tool derives the right collection scope (the US state, \"Country, State\" for Canada/Mexico, or the country) and matches it against collection titles. A plain place name works too."
      },
      startYear: {
        type: "integer",
        description: "Earliest year of interest (inclusive). Omit for all periods. Filters the returned collections to those overlapping the year window."
      },
      endYear: {
        type: "integer",
        description: "Latest year of interest (inclusive). Must be ≥ startYear. Omit for all periods. Filters the returned collections to those overlapping the year window."
      }
    },
    required: ["standardPlace"]
  }
}
```

---

## Authentication

The tool requires a valid FamilySearch access token. It must call
`getValidToken()` from `src/auth/refresh.ts` — the single entry point
for all authenticated tools. Do not re-implement token plumbing.

If the user is not authenticated, `getValidToken()` throws an
LLM-instruction error directing the user to call the `login` tool. The
tool handler should let this error propagate.

---

## FamilySearch API Reference

### Endpoint

```
GET https://www.familysearch.org/service/search/hr/v2/collections
Authorization: Bearer <access_token>
User-Agent: <browser-like user agent string>
```

**Important:** The `User-Agent` header is required. FamilySearch's WAF
(Imperva/Incapsula) blocks requests without a browser-like user agent,
returning a 403 with `"This request was blocked by our security service"`.

**Query parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `count` | `5000` | Return all collections in a single call |
| `offset` | `0` | Pagination offset |
| `facets` | `OFF` | Disable facet aggregation |

**API response shape (GEDCOMX-wrapped):**

The response is NOT a flat array. Each entry is wrapped in GEDCOMX format:

```
response.entries[].content.gedcomx.collections[0]
```

Each collection object contains:
- `id` — collection identifier
- `title` — human-readable name (e.g., `"Alabama County Marriages, 1711-1992"`)
- `content[]` — array of counts by `resourceType` (`/Record`, `/Person`, `/DigitalArtifact`)
- `searchMetadata[0]` — contains `placeIds` (number array), `startYear`, `endYear`, `imageCount`, `recordCount`

**Key API details:**

- The lower-level API (`/service/search/hr/v2/collections`) was chosen
  over the platform API (`/platform/records/collections`) because the
  platform API does not include counts — it would require N+1 calls.
- Place IDs in `searchMetadata.placeIds` are internal to the collections
  system and do NOT match the Places API IDs.
- Some collections have access restrictions (church membership,
  FamilySearch Center access). The API respects these based on the
  user's session.

---

## Filtering Logic (list mode)

**Scope match:** Case-insensitive substring match against collection
titles. The derived scope term (`"Alabama"`) matches any collection
whose title contains it (e.g., `"Alabama, County Marriages,
1711-1992"`). The number of collections matching the scope is reported
as `totalForPlace`.

**Date filter (optional):** When `startYear`/`endYear` are supplied, the
scope-matched collections are further filtered to those whose year span
(from `dateRange`/`searchMetadata` `startYear`/`endYear`) overlaps the
requested window. A collection with no year span is always included.
`totalForPlace` is computed **before** this date filter; `results`
contains only the collections that pass it.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| `standardPlace` not provided | Throw error: `"collections_search requires a standardPlace (preferably the standardPlace from place_search)."` |
| `endYear` less than `startYear` (both given) | Throw error: `"endYear must be greater than or equal to startYear."` |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error ("User is not logged in to FamilySearch. Call the login tool to authenticate.") |
| API returns non-OK status | Throw error: `"FamilySearch collections API error: {status} {statusText}"` |
| API returns empty/malformed response | Return `{ query, scope, totalForPlace: 0, results: [] }` |

---

## Caching

The full collection list (~3400 entries) changes infrequently. Cache the
API response for 1 hour to avoid re-fetching on every call. The cache is
keyed on the access token (different users may see different collections
due to access restrictions).

---

## Files

### `packages/engine/mcp-server/src/types/collection.ts`

API response types (`FSCollectionEntry`, `FSCollectionsResponse`, etc.)
and output types (`Collection`, `CollectionsSearchResult`).

### `packages/engine/mcp-server/src/tools/collections-search.ts`

- `collectionsSearchToolSchema` — MCP tool schema
- `collectionsSearchTool(input)` — main function
- `standardPlaceToCollectionsQuery(value)` — derive the title-match term from a `standardPlace` (US → state, Canada/Mexico → `"Country, State"`, else → country; free text passes through)
- `fetchAllCollections(token)` — cached API call
- `filterByQuery(entries, query)` — case-insensitive title matching
- `clearCollectionsCache()` — for testing

### `packages/engine/mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

### `packages/engine/mcp-server/dev/try-collections-search.ts`

Smoke-test script for list mode.

---

## Testing

### `tests/tools/collections-search.test.ts`

**Integration tests:**

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns collections matching a place; echoes `query` and reports `scope` | List happy path |
| 2 | Converts a US standardPlace to its state before matching (reflected in `scope`) | Conversion wired into the tool |
| 3 | Matching is case-insensitive | Case handling |
| 4 | Returns empty `results` with `totalForPlace: 0` when nothing matches | Zero-match |
| 5 | Matches anywhere in the title | Substring matching |
| 6 | Throws auth error when not authenticated | Auth propagation |
| 7 | Throws on non-OK API response | HTTP error handling |
| 8 | Handles malformed API response gracefully (empty envelope) | Empty/null response |
| 9 | Throws when `standardPlace` is not provided | Input validation |
| 10 | Maps API response fields to Collection shape | Field mapping |
| 11 | `startYear`/`endYear` filter `results` but not `totalForPlace` | Date filter |
| 12 | Collection with no year span always survives the date filter | Date filter edge case |
| 13 | Throws when `endYear` < `startYear` | Input validation |

**`standardPlaceToCollectionsQuery` unit tests:** US → state (any nesting
depth); Canada/Mexico → `"Country, State"`; other countries → country;
free-text passes through; country-only US/Canada falls back to the country.

### Smoke

```bash
cd packages/engine/mcp-server
npx tsx dev/try-collections-search.ts Alabama
npx tsx dev/try-collections-search.ts England
```

---

## Verification

### Automated
```bash
cd packages/engine/mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)
```bash
npx @modelcontextprotocol/inspector node build/index.js
```

- `collections_search({ standardPlace: "Birmingham, Jefferson, Alabama, United States" })` — `scope` is `"Alabama"`, `totalForPlace` is 29, `results` has the 29 Alabama collections
- `collections_search({ standardPlace: "Birmingham, Jefferson, Alabama, United States", startYear: 1850, endYear: 1900 })` — `totalForPlace` still 29, `results` only those overlapping 1850–1900
- `collections_search({ standardPlace: "London, England, United Kingdom" })` — `scope` is `"United Kingdom"`, returns UK collections
- `collections_search({ standardPlace: "Nowhere" })` — `totalForPlace: 0`, empty `results`
- `collections_search` without logging in — returns auth error message

### Manual Layer 2 (Claude Code / Cowork)

- "What FamilySearch collections cover Alabama?" — Claude should call `collections_search` with the `standardPlace` for Alabama (e.g. from `place_search`) and present the `results`, noting the `scope` and `totalForPlace`.
- "What collections cover Alabama for the 1800s?" — Claude should call `collections_search` with `standardPlace` plus `startYear`/`endYear` and present the filtered `results`.

Layer 2 testing inside this dev repo is unreliable — Claude may find and
run a `dev/try-*.ts` script via Bash. Run Layer 2 in Cowork.

---

## Out of Scope

- Single-collection detail — now its own `collection_read` tool
  (spec: `docs/specs/collection-read-tool-spec.md`).
- Curating the collection shape beyond the documented `Collection`
  fields.
