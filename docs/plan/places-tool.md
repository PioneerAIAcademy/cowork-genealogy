# Places Tool Implementation Plan

## Summary

Build the `places` MCP tool that returns FamilySearch place data enriched
with Wikipedia summaries.

## API Endpoints

**Search places by name (no auth required):**
```
GET https://api.familysearch.org/platform/places/search?q=name:{query}
Accept: application/x-gedcomx-atom+json
```

Returns `entries[]` array. Each entry has:
- `id` — place ID (e.g., "267")
- `score` — relevance score (e.g., 100.0)
- `content.gedcomx.places[0].display.name` — short name
- `content.gedcomx.places[0].display.fullName` — full name with hierarchy
- `content.gedcomx.places[0].display.type` — type (Country, City, Farm, etc.)
- `content.gedcomx.places[0].latitude/longitude` — coordinates
- `content.gedcomx.places[0].temporalDescription.formal` — date range
- `links.description.href` — URL to full details

**Get place by ID (no auth required):**
```
GET https://api.familysearch.org/platform/places/description/{id}
Accept: application/json
```

Returns `places[]` array (place + parent hierarchy). For `places[0]`:
- `id` — place ID (e.g., "267")
- `display.name` — short name (e.g., "England")
- `display.fullName` — full name with hierarchy (e.g., "England, United Kingdom")
- `display.type` — readable type (e.g., "Country", "City", "Parish")
- `latitude`, `longitude` — coordinates
- `temporalDescription.formal` — date range (e.g., "+1801/")
- `names[]` — names in multiple languages (48+ translations)
- `jurisdiction.resourceId` — parent place ID
- `links.children.href` — URL to child places

Note: `places[1]` and beyond contain parent places in the hierarchy.

**Wikipedia summary (no auth required):**
```
GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}
```

Returns:
- `title` — page title
- `description` — short description (e.g., "Country within the United Kingdom")
- `extract` — text summary paragraph
- `coordinates.lat/lon` — coordinates
- `thumbnail.source` — image URL

## Implementation Approach

1. Accept input: place name OR FamilySearch place ID
2. If input looks like an ID (numeric), fetch directly via description endpoint
3. If input is a name, search first, take top result
4. Fetch Wikipedia summary using the place name
5. Merge and return combined data

## Tool Schema

```typescript
{
  name: "places",
  description: "Get place information from FamilySearch and Wikipedia",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Place name (e.g., 'England') or FamilySearch place ID"
      }
    },
    required: ["query"]
  }
}
```

## Response Type

```typescript
interface PlaceResult {
  // FamilySearch data
  id: string;
  name: string;
  fullName: string;
  type: string;
  latitude?: number;
  longitude?: number;
  dateRange?: string;
  parentId?: string;

  // Wikipedia data (if available)
  wikipedia?: {
    title: string;
    description: string;
    extract: string;
    thumbnailUrl?: string;
  };

  // Links
  familysearchUrl: string;
  wikipediaUrl?: string;
}
```

## Files to Create/Modify

1. `mcp-server/src/types/place.ts` — Type definitions
2. `mcp-server/src/tools/places.ts` — Tool implementation
3. `mcp-server/src/index.ts` — Register tool

## Implementation Steps

1. Create type definitions for FamilySearch and Wikipedia responses
2. Implement `searchPlace(name)` — calls search endpoint, returns top result
3. Implement `getPlaceById(id)` — calls description endpoint
4. Implement `getWikipediaSummary(title)` — calls Wikipedia API
5. Implement `placesTool()` handler:
   - Detect if input is ID (numeric) or name
   - Fetch FamilySearch data
   - Fetch Wikipedia data (handle 404 gracefully)
   - Merge and return
6. Register in index.ts
7. Build and test

## Edge Cases

- Wikipedia may not have an article for the place → return FS data only
- Place name may have disambiguation → use `display.name` for Wikipedia search
- Multiple search results → return top result by score
- Historic places with date ranges → include `temporalDescription.formal` in response
- Response includes parent hierarchy → use `places[0]` for main data, extract `parentId` from `jurisdiction.resourceId`

## Test Commands

```bash
# Search for a place
curl -H "Accept: application/x-gedcomx-atom+json" \
  "https://api.familysearch.org/platform/places/search?q=name:England"

# Get place by ID
curl -H "Accept: application/json" \
  "https://api.familysearch.org/platform/places/description/267"

# Wikipedia summary
curl "https://en.wikipedia.org/api/rest_v1/page/summary/England"
```
