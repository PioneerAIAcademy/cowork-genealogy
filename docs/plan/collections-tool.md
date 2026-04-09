# Collections Tool Implementation Plan

## Summary

Build the `collections` MCP tool that returns FamilySearch record collections
for a geographic area, with optional record counts.

## API Endpoints

**List all collections (no auth required):**
```
GET https://api.familysearch.org/platform/records/collections
Accept: application/json
```

Returns `sourceDescriptions[]` array. Each item has:
- `id` — e.g., `sd_c_1661470`
- `titles[0].value` — e.g., "Alabama, Births and Christenings, 1881-1930"
- `coverage[0].spatial.original` — e.g., "Alabama, United States"
- `coverage[0].temporal.original` — e.g., "1881/1930"
- `coverage[0].recordType` — e.g., `http://gedcomx.org/Birth`
- `about` — URL to collection detail

**Get single collection with counts (no auth required):**
```
GET https://api.familysearch.org/platform/records/collections/{id}
Accept: application/json
```

Returns `collections[0].content[]` array with:
- `resourceType: "http://gedcomx.org/Record"` — use this for record count
- `count` — the actual count (e.g., 105739)

## Filtering

Filter client-side by matching area string against `coverage[0].spatial.original`
(case-insensitive substring match).

## Implementation Approach

1. Fetch `/platform/records/collections` → get all collections
2. Filter by area (client-side)
3. If `includeCounts: true`, fetch each matching collection's detail endpoint
4. Return aggregated results

## Tool Schema

```typescript
{
  name: "collections",
  description: "List FamilySearch record collections for a geographic area",
  inputSchema: {
    type: "object",
    properties: {
      area: {
        type: "string",
        description: "Geographic area (e.g., 'Alabama', 'England', 'Korea')"
      },
      includeCounts: {
        type: "boolean",
        description: "Fetch record counts (slower, requires additional API calls)",
        default: false
      }
    },
    required: ["area"]
  }
}
```

## Response Type

```typescript
interface Collection {
  id: string;
  title: string;
  location: string;
  dateRange: string;
  recordType: string;
  recordCount?: number;  // Only if includeCounts=true
  url: string;
}

interface CollectionsResult {
  area: string;
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
2. Implement `fetchAllCollections()` — calls list endpoint
3. Implement `fetchCollectionDetails(id)` — calls single collection endpoint
4. Implement `collectionsTool()` handler:
   - Fetch all collections
   - Filter by area (case-insensitive match on `coverage[0].spatial.original`)
   - If `includeCounts`, fetch details for each match (parallelize with `Promise.all()`)
   - Format and return results
5. Register in index.ts
6. Build and test with: "Alabama", "Korea", "England"

## Performance Consideration

When `includeCounts: true` and many collections match, parallelize fetches
with `Promise.all()` to minimize latency.

## Test Commands

```bash
# List endpoint
curl -H "Accept: application/json" \
  https://api.familysearch.org/platform/records/collections

# Single collection with counts
curl -H "Accept: application/json" \
  https://api.familysearch.org/platform/records/collections/1661470
```
