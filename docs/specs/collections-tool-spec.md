# Collections Tool — Implementation Spec

## Overview

An MCP tool that returns FamilySearch record collections for a place,
with record, person, and image counts. Requires authentication (OAuth tokens
obtained via the `login` tool). Uses the lower-level FamilySearch search API
to get all collections with counts in a single call.

The primary input is a `query` parameter (place name string) that filters
collections by title. A secondary `placeIds` parameter is available for
filtering by internal collection place IDs.

### Place ID mismatch (design note)

The FamilySearch Places API (`/platform/places/`) and the Collections API
(`/service/search/hr/v2/collections`) use **different place ID systems**.
Alabama is 351 in the Places API but 33 in the Collections API. These IDs
are not interchangeable.

The `query` parameter was added to work around this — Claude passes the
place name (e.g., `"Alabama"`) directly to the collections tool and filters
by collection title. The `places` tool is still useful for disambiguation
(e.g., which "Madison"?) but its IDs are not passed to `collections`.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | No* | Place name to search for in collection titles (e.g., `"Alabama"`, `"England"`) |
| `placeIds` | number[] | No* | Internal FamilySearch collection place IDs (NOT from the `places` tool) |

*At least one of `query` or `placeIds` must be provided.

`query` is the recommended parameter for the LLM workflow. `placeIds` is
for advanced use when internal collection IDs are already known.

Example (recommended):
```json
{ "query": "Alabama" }
```

Example (advanced):
```json
{ "placeIds": [33] }
```

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `query` | string? | The query string (present when query was used) |
| `placeIds` | number[]? | The place IDs (present when placeIds was used) |
| `matchingCollections` | number | Total count of matching collections |
| `collections` | Collection[] | The matching collection objects |

Each `Collection` object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | FamilySearch collection identifier |
| `title` | string | Human-readable collection name |
| `dateRange` | string | Time period the collection covers (e.g., `"1809-1950"`) |
| `placeIds` | number[] | Internal place IDs from the collection's spatial coverage |
| `recordCount` | number | Number of records in the collection |
| `personCount` | number | Number of persons in the collection |
| `imageCount` | number | Number of images in the collection |
| `url` | string | Link to the collection on FamilySearch |

Example:
```json
{
  "query": "Alabama",
  "matchingCollections": 29,
  "collections": [
    {
      "id": "1743384",
      "title": "Alabama County Marriages, 1711-1992",
      "dateRange": "1711-1992",
      "placeIds": [33],
      "recordCount": 6049744,
      "personCount": 22361103,
      "imageCount": 1231203,
      "url": "https://www.familysearch.org/search/collection/1743384"
    }
  ]
}
```

---

## Tool Schema

```typescript
{
  name: "collections",
  description: "List FamilySearch record collections for a place, with record counts. Pass a place name as query (e.g., \"Alabama\") to search collection titles. Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Place name to search for in collection titles (e.g., \"Alabama\", \"England\"). This is the recommended parameter — use the places tool first to disambiguate if needed."
      },
      placeIds: {
        type: "array",
        items: { type: "number" },
        description: "Internal FamilySearch collection place IDs. These are NOT the same as place IDs from the places tool. Only use if you know the internal IDs."
      }
    }
  }
}
```

---

## Authentication

This tool requires a valid FamilySearch access token. It must call
`getValidToken()` from `src/auth/refresh.ts` — the single entry point for
all authenticated tools. Do not re-implement token plumbing.

If the user is not authenticated, `getValidToken()` throws an LLM-instruction
error directing the user to call the `login` tool. The tool handler should let
this error propagate (same try/catch pattern as other tools in `index.ts`).

---

## FamilySearch API Reference

**Endpoint (auth required):**
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

- The lower-level API (`/service/search/hr/v2/collections`) was chosen over
  the platform API (`/platform/records/collections`) because the platform API
  does not include counts — it would require N+1 calls.
- Place IDs in `searchMetadata.placeIds` are internal to the collections
  system and do NOT match the Places API IDs.
- Some collections have access restrictions (church membership, FamilySearch
  Center access). The API respects these based on the user's session.

---

## Filtering Logic

**Query mode (recommended):** Case-insensitive substring match against
collection titles. `"Alabama"` matches any collection whose title contains
"Alabama" (e.g., `"Alabama, County Marriages, 1711-1992"`).

**PlaceIds mode:** Filter collections where any of the requested place IDs
appear in the collection's `searchMetadata[0].placeIds` array.

When `query` is provided, it takes precedence over `placeIds`.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Neither `query` nor `placeIds` provided | Throw error with usage instructions |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error ("Call the login tool to authenticate.") |
| API returns non-OK status | Throw error: `"FamilySearch collections API error: {status}"` |
| API returns empty/malformed response | Return `{ matchingCollections: 0, collections: [] }` |

---

## Caching

The full collection list (~3400 entries) changes infrequently. Cache the
API response for 1 hour to avoid re-fetching on every call. The cache is
keyed on the access token (different users may see different collections
due to access restrictions).

---

## Files

### `mcp-server/src/types/collection.ts`

API response types (`FSCollectionEntry`, `FSCollectionsResponse`, etc.)
and output types (`Collection`, `CollectionsResult`).

### `mcp-server/src/tools/collections.ts`

- `collectionsToolSchema` — MCP tool schema
- `collectionsTool(input)` — main function (authenticates, fetches, filters, maps)
- `fetchAllCollections(token)` — cached API call with auth + User-Agent
- `filterByQuery(entries, query)` — case-insensitive title matching
- `filterByPlaceIds(entries, placeIds)` — internal placeId matching
- `clearCollectionsCache()` — for testing

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Testing

### `tests/tools/collections.test.ts` (13 cases)

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns collections matching a place name query | Query happy path |
| 2 | Query matching is case-insensitive | Case handling |
| 3 | Returns empty array when query matches no titles | Query zero-match |
| 4 | Query matches anywhere in the title | Substring matching |
| 5 | Returns collections matching a single place ID | PlaceIds happy path |
| 6 | Returns collections matching multiple place IDs | Union filtering |
| 7 | Returns empty array when no place IDs match | PlaceIds zero-match |
| 8 | Filters correctly against placeIds in searchMetadata | PlaceIds logic |
| 9 | Throws auth error when not authenticated | Auth propagation |
| 10 | Throws on non-OK API response | HTTP error handling |
| 11 | Handles malformed API response gracefully | Empty/null response |
| 12 | Throws when neither query nor placeIds provided | Input validation |
| 13 | Maps API response fields to Collection shape | Field mapping |

### Smoke-test script

```bash
cd mcp-server
npx tsx scripts/try-collections.ts Alabama        # Search by place name
npx tsx scripts/try-collections.ts England         # Another place
npx tsx scripts/try-collections.ts --ids 33        # Internal place ID
npx tsx scripts/try-collections.ts --ids 33,325    # Multiple internal IDs
```

---

## Verification

### Automated
```bash
cd mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)
```bash
npx @modelcontextprotocol/inspector node build/index.js
```
- Call `collections({ query: "Alabama" })` — returns 29 Alabama collections
- Call `collections({ query: "England" })` — returns England collections
- Call `collections({ query: "xyznonexistent" })` — returns empty list
- Call `collections` without logging in first — returns auth error message

### Manual Layer 2 (Claude Code)
- "What FamilySearch collections cover Alabama?" — Claude should call
  `collections` with query `"Alabama"` and present the results
