# Collections Tool — Implementation Spec

## Overview

An MCP tool that returns FamilySearch record collections for given place IDs,
with record, person, and image counts. Requires authentication (OAuth tokens
obtained via the `login` tool). Uses the lower-level FamilySearch search API
to get all collections with counts in a single call.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `placeIds` | number[] | Yes | FamilySearch place IDs to filter by (obtain from the `places` tool) |

Example:
```json
{ "placeIds": [33, 351] }
```

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `placeIds` | number[] | The place IDs that were requested |
| `matchingCollections` | number | Total count of matching collections |
| `collections` | Collection[] | The matching collection objects |

Each `Collection` object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | FamilySearch collection identifier |
| `title` | string | Human-readable collection name |
| `dateRange` | string | Time period the collection covers |
| `placeIds` | number[] | Place IDs from the collection's spatial coverage |
| `recordCount` | number | Number of records in the collection |
| `personCount` | number | Number of persons in the collection |
| `imageCount` | number | Number of images in the collection |
| `url` | string | Link to the collection on FamilySearch |

Example:
```json
{
  "placeIds": [33],
  "matchingCollections": 2,
  "collections": [
    {
      "id": "1234",
      "title": "Alabama, County Marriages, 1809-1950",
      "dateRange": "1809-1950",
      "placeIds": [1, 33],
      "recordCount": 524000,
      "personCount": 1048000,
      "imageCount": 120000,
      "url": "https://www.familysearch.org/search/collection/1234"
    }
  ]
}
```

---

## Tool Schema

```typescript
{
  name: "collections",
  description: "List FamilySearch record collections for given place IDs, with record counts. Use the places tool first to get place IDs.",
  inputSchema: {
    type: "object",
    properties: {
      placeIds: {
        type: "array",
        items: { type: "number" },
        description: "FamilySearch place IDs (e.g., [33, 351] for Alabama). Get these from the places tool."
      }
    },
    required: ["placeIds"]
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
```

**Query parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `count` | `5000` | Return all collections in a single call |
| `offset` | `0` | Pagination offset |
| `countryId` | place ID | Server-side filter by place (optional) |
| `collectionsWithRecordsFromLocation` | `true` | Required when filtering by place |
| `facets` | `OFF` | Disable facet aggregation |

**Key API details:**

- The lower-level API (`/service/search/hr/v2/collections`) was chosen over
  the platform API (`/platform/records/collections`) because the platform API
  does not include counts — it would require N+1 calls.
- The API returns a placeId chain (e.g., `"1-33"` = United States -> Alabama)
  per collection for spatial coverage. Filter by matching any requested place
  ID against this chain.
- Some collections have access restrictions (church membership, FamilySearch
  Center access). The API respects these based on the user's session.

---

## Filtering Logic

Filter collections by matching requested place IDs against the placeId chain
in each collection's spatial coverage. A collection matches if **any** of its
place IDs appear in the requested list.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error ("Call the login tool to authenticate.") |
| API returns non-OK status | Throw error: `"FamilySearch collections API error: {status}"` |
| API returns empty/malformed response | Return `{ placeIds, matchingCollections: 0, collections: [] }` |

---

## Caching

The full collection list (~5000 entries) changes infrequently. Cache the
API response for a configurable TTL (e.g., 1 hour) to avoid re-fetching on
every call. The cache is keyed on the access token (different users may see
different collections due to access restrictions).

---

## Files to Create

### 1. `mcp-server/src/types/collection.ts`

Define two types:

- `Collection` — shape of a single collection in the tool's output
- `CollectionsResult` — shape of what the tool returns

### 2. `mcp-server/src/tools/collections.ts`

Contains:

- `collectionsToolSchema` — MCP tool schema (name, description, inputSchema)
- `collectionsTool(input)` — async function that authenticates, fetches
  collections, filters by place IDs, and returns results

Internal helpers:

- `fetchAllCollections(token)` — calls the lower-level API with auth
- `filterByPlaceIds(collections, placeIds)` — matches placeId chains

---

## Files to Modify

### `mcp-server/src/index.ts`

Register the `collections` tool following the existing pattern:

| Change | Detail |
|--------|--------|
| Import | Add import for `collectionsTool` and `collectionsToolSchema` |
| ListTools | Add `collectionsToolSchema` to the tools array |
| CallTool | Add `if` block for `"collections"` (same try/catch pattern) |

---

## Patterns to Follow

Match the style of the existing tools (`places.ts`, `wikipedia.ts`):

- Export function + schema from the tool module
- Use `getValidToken()` for authentication (same as all future auth tools)
- Parse API response as JSON and map to output types
- Throw descriptive errors that help Claude understand what went wrong
- Errors as LLM instructions (per project conventions)
- Never `console.log` (stdio transport)

---

## Testing Plan

### `tests/tools/collections.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns collections matching a single place ID | Happy path with one place ID |
| 2 | Returns collections matching multiple place IDs | Union filtering across several IDs |
| 3 | Returns empty array when no collections match | Zero-match case |
| 4 | Throws auth error when not authenticated | `getValidToken()` propagation |
| 5 | Throws on non-OK API response | HTTP error handling |
| 6 | Handles malformed API response gracefully | Returns empty result |
| 7 | Filters correctly against placeId chains | Chain matching logic (e.g., `"1-33"` matches placeId 33) |
| 8 | Maps API response fields to Collection shape | Field mapping correctness |

**Mocks:** `fetch` (global stub), `getValidToken` from `src/auth/refresh.ts`

---

## Smoke-Test Script

Create `mcp-server/scripts/try-collections.ts` following the pattern of
`try-wikipedia.ts` and `try-places.ts`. Requires a valid access token
(load from `~/.familysearch-mcp/tokens.json`).

```bash
cd mcp-server && npx tsx scripts/try-collections.ts 33   # Alabama
cd mcp-server && npx tsx scripts/try-collections.ts 325  # England
```

---

## Verification

### Automated (mocked, no credentials)
```bash
cd mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector, with valid session)
```bash
npx @modelcontextprotocol/inspector node build/index.js
```
- Call `collections({ placeIds: [33] })` — returns Alabama collections
- Call `collections({ placeIds: [325] })` — returns England collections
- Call `collections({ placeIds: [999999] })` — returns empty list
- Call `collections` without logging in first — returns auth error message

### Manual Layer 2 (Claude Code)
- "What FamilySearch collections cover Alabama?" — Claude should call
  `places` for the ID, then `collections` with the result
