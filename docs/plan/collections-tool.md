# Collections Tool Implementation Plan

## Summary

Build the `collections` MCP tool that returns FamilySearch record collections
for a list of place IDs, with record and person counts included. Uses the
lower-level search API which requires authentication.

## API Endpoint

**Get all collections with counts (auth required):**
```
GET https://www.familysearch.org/service/search/hr/v2/collections
Authorization: Bearer <access_token>
```

**Query parameters:**
- `count` — max results to return (e.g. `5000` for all collections)
- `offset` — pagination offset
- `countryId` — filter by place ID (server-side)
- `collectionsWithRecordsFromLocation` — set to `true` when filtering by place
- `facets` — set to `OFF` to disable facet aggregation

Returns all collections the authenticated user has access to, including:
- Collection name, ID, date range
- Place ID chain (e.g., `"1-33"` = United States -> Alabama)
- Record count, person count, image count
- Access restrictions (some collections require church membership or FS Center access)

## Key Details from Team Discussion

- The **platform API** (`/platform/records/collections`) is public but does NOT
  include counts — you must call each collection individually to get counts.
- The **lower-level API** (`/service/search/hr/v2/collections`) requires auth
  but returns all collections with counts in a single call.
- The team decided to use the lower-level API to avoid N+1 calls.
- FamilySearch is inconsistent with place IDs between the two APIs:
  the lower-level API uses a placeId chain (e.g., `"1-33"`), while the platform
  API detail endpoint uses placeRepId (e.g., `389592`).
- Some collections have access restrictions — the lower-level API respects
  these based on the user's session.

## Filtering

Filter server-side by matching requested place IDs against the placeId chain
in each collection's spatial coverage. A collection matches if any of its
place IDs appear in the requested list.

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

## Response Type

```typescript
interface Collection {
  id: string;
  title: string;
  dateRange: string;
  placeIds: number[];
  recordCount: number;
  personCount: number;
  imageCount: number;
  url: string;
}

interface CollectionsResult {
  placeIds: number[];
  matchingCollections: number;
  collections: Collection[];
}
```

## Files to Create/Modify

1. `mcp-server/src/types/collection.ts` — Type definitions
2. `mcp-server/src/tools/collections.ts` — Tool implementation
3. `mcp-server/src/index.ts` — Register tool

## Implementation Steps

1. Create type definitions
2. Implement `fetchAllCollections(token)` — calls lower-level API with auth
3. Implement `filterByPlaceIds(collections, placeIds)` — matches placeId chains
4. Implement `collectionsTool()` handler:
   - Call `getValidToken()`; return login prompt if not authenticated
   - Fetch all collections (consider caching — the full list changes infrequently)
   - Filter by requested place IDs
   - Format and return results
5. Register in index.ts
6. Build and test with place IDs: 33 (Alabama), 325 (England), 1927021 (Russia)

## Caching Consideration

The full collection list (~5000 entries) changes infrequently. Consider caching
the response for a configurable TTL (e.g., 1 hour) to avoid re-fetching on
every call.

## Test Commands

```bash
# Requires a valid access token
curl -H "Authorization: Bearer $FS_ACCESS_TOKEN" \
  "https://www.familysearch.org/service/search/hr/v2/collections?count=5000"

# Filter by country (lower-level API supports this natively)
curl -H "Authorization: Bearer $FS_ACCESS_TOKEN" \
  "https://www.familysearch.org/service/search/hr/v2/collections?count=5000&collectionsWithRecordsFromLocation=true&countryId=1927159"
```
