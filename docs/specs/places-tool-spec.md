# Places Tool — Implementation Spec

## Overview

An MCP tool that returns FamilySearch place data enriched with Wikipedia
summaries. No authentication required — uses the public FamilySearch places
endpoints.

The tool has two modes determined by the input:

| Input | Mode | What it does |
|-------|------|--------------|
| Place name (e.g., `"Ohio"`) | **Search** | Returns all matching places ranked by relevance |
| Numeric place ID (e.g., `"267"`) | **Lookup** | Returns the single place with full details + Wikipedia enrichment |

Search mode is for disambiguation — when the user says "Madison," the
tool returns all places named Madison so Claude can ask which one. Lookup
mode is for getting the full picture of a known place.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | A place name to search for, or a numeric FamilySearch place ID to look up directly |

The tool auto-detects the mode: if `query` is all digits, it's treated
as a place ID lookup; otherwise, it's a name search.

Examples:

```json
{ "query": "England" }
```

```json
{ "query": "267" }
```

---

## Output

The tool returns `{ results: PlaceResult[] }`.

Each `PlaceResult`:

| Field | Type | Description |
|-------|------|-------------|
| `placeId` | string | FamilySearch place identifier |
| `name` | string | Short place name (e.g., `"England"`) |
| `fullName` | string | Full jurisdictional name (e.g., `"England, United Kingdom"`) |
| `type` | string | Place type (e.g., `"Country"`, `"State"`, `"County"`) |
| `latitude` | number? | Geographic latitude |
| `longitude` | number? | Geographic longitude |
| `dateRange` | string? | Temporal description in ISO formal notation (e.g., `"+1801/"`) |
| `parentPlaceId` | string? | Parent jurisdiction's place ID (lookup mode only) |
| `score` | number? | Relevance score (search mode only) |
| `wikipedia` | WikipediaData? | Wikipedia enrichment (lookup mode only) |
| `familysearchUrl` | string | Link to the place on FamilySearch |
| `wikipediaUrl` | string? | Link to the Wikipedia article (when enrichment succeeds) |

`WikipediaData`:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Wikipedia article title |
| `description` | string | Short article description |
| `extract` | string | Article summary (1–2 paragraphs) |
| `thumbnailUrl` | string? | URL of the article's thumbnail image |

### Search mode example

```json
{
  "results": [
    {
      "placeId": "267",
      "name": "England",
      "fullName": "England, United Kingdom",
      "type": "Country",
      "latitude": 52.0,
      "longitude": -1.0,
      "dateRange": "+1801/",
      "score": 100.0,
      "familysearchUrl": "https://www.familysearch.org/search/catalog/place/267"
    },
    {
      "placeId": "12345",
      "name": "New England",
      "fullName": "New England, United States",
      "type": "Region",
      "latitude": 43.0,
      "longitude": -71.0,
      "score": 64.0,
      "familysearchUrl": "https://www.familysearch.org/search/catalog/place/12345"
    }
  ]
}
```

### Lookup mode example

```json
{
  "results": [
    {
      "placeId": "267",
      "name": "England",
      "fullName": "England, United Kingdom",
      "type": "Country",
      "latitude": 52.0,
      "longitude": -1.0,
      "dateRange": "+1801/",
      "parentPlaceId": "10",
      "wikipedia": {
        "title": "England",
        "description": "Country within the United Kingdom",
        "extract": "England is a country that is part of the United Kingdom. It shares land borders with Wales and Scotland.",
        "thumbnailUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/england.png"
      },
      "familysearchUrl": "https://www.familysearch.org/search/catalog/place/267",
      "wikipediaUrl": "https://en.wikipedia.org/wiki/England"
    }
  ]
}
```

---

## Tool Schema

```typescript
{
  name: "places",
  description:
    "Look up place information for genealogy research. " +
    "Pass a place name (e.g., 'Ohio', 'Madison') to get all matching places " +
    "ranked by relevance — useful for disambiguating among places that share " +
    "a name. Pass a numeric FamilySearch place ID to get the full details for " +
    "that single place, enriched with a Wikipedia summary.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A place name to search for (returns all matches), or a numeric " +
          "FamilySearch place ID (returns one enriched result)."
      }
    },
    required: ["query"]
  }
}
```

---

## Authentication

None. Both FamilySearch places endpoints and the Wikipedia API are public.

---

## FamilySearch API Reference

### Endpoint: Place search

```
GET https://api.familysearch.org/platform/places/search?q=name:{query}
Accept: application/x-gedcomx-atom+json
```

No authentication or User-Agent header required.

**Response shape (GEDCOMX Atom):**

```
response.entries[]
  .id                                    -> string, place ID
  .score                                 -> number, relevance score
  .content.gedcomx.places[0]
    .display.name                        -> string, short name
    .display.fullName                    -> string, full jurisdictional name
    .display.type                        -> string, place type
    .latitude                            -> number (optional)
    .longitude                           -> number (optional)
    .temporalDescription.formal          -> string (optional), ISO date range
```

Returns multiple matches ranked by relevance. The query uses
FamilySearch's built-in fuzzy matching — `"England"` also returns
`"New England"`, `"England, Arkansas"`, etc.

### Endpoint: Place description (by ID)

```
GET https://api.familysearch.org/platform/places/description/{id}
Accept: application/json
```

**Response shape:**

```
response.places[0]
  .id                                    -> string, place ID
  .display.name                          -> string
  .display.fullName                      -> string
  .display.type                          -> string
  .latitude                              -> number (optional)
  .longitude                             -> number (optional)
  .temporalDescription.formal            -> string (optional)
  .jurisdiction.resourceId               -> string, parent place ID
```

Returns a single place with additional fields not available in search
results: `jurisdiction.resourceId` (the parent place) and `names[]`
(multilingual name variants).

---

## Wikipedia API Reference

### Endpoint: Page summary

```
GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}
Accept: application/json
```

Used for enrichment in lookup mode only. The place's `name` field is
passed directly as the Wikipedia title.

**Response shape (relevant fields):**

```
response.title                           -> string
response.description                     -> string (optional)
response.extract                         -> string, summary text
response.thumbnail.source                -> string, thumbnail URL
response.content_urls.desktop.page       -> string, article URL
```

Wikipedia enrichment is **optional** — if the API returns a non-OK
status or throws, the tool returns the place data without Wikipedia
fields. This is graceful degradation, not an error.

---

## Mode detection

The tool detects mode by checking whether `query` is all digits:

```typescript
function isNumericId(query: string): boolean {
  return /^\d+$/.test(query.trim());
}
```

- All digits → **lookup mode** (calls place description endpoint + Wikipedia)
- Otherwise → **search mode** (calls place search endpoint, no Wikipedia)

Wikipedia enrichment is only performed in lookup mode because search
mode may return many results and enriching each one would be slow and
wasteful.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Search returns no results (empty body or empty entries) | Return `{ results: [] }` |
| Lookup returns 404 (invalid place ID) | Throw: `"Place not found: {id}"` |
| FamilySearch API returns other non-OK status | Throw: `"FamilySearch API error: {status} {statusText}"` |
| Wikipedia API fails (any status or network error) | Return place data without Wikipedia fields (graceful degradation) |

---

## Files

### `mcp-server/src/types/place.ts`

API response types (`FSPlaceSearchEntry`, `FSPlaceSearchResponse`,
`FSPlace`, `FSPlaceDescriptionResponse`, `WikipediaSummaryResponse`)
and output types (`WikipediaData`, `PlaceResult`, `PlacesToolResponse`).

### `mcp-server/src/tools/places.ts`

- `placesToolSchema` — MCP tool schema
- `placesTool(input)` — main entry point (detects mode, routes accordingly)
- `searchPlace(name)` — calls the search endpoint, returns array of results
- `getPlaceById(id)` — calls the description endpoint, returns single result or null
- `getWikipediaSummary(title)` — calls Wikipedia, returns enrichment or null
- `isNumericId(query)` — mode detection
- `toPlaceResult(placeData, wikiData)` — maps internal types to output shape

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Testing

### `tests/tools/places.test.ts` (10 cases)

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns all matching entries with scores preserved | Search happy path |
| 2 | Returns empty array when no results (empty entries) | Search zero-match |
| 3 | Returns empty array when response body is empty | Empty body handling |
| 4 | Throws on FamilySearch API network failure | HTTP error propagation |
| 5 | Returns place data for valid ID | Lookup happy path |
| 6 | Returns null for invalid ID (404) | Lookup 404 handling |
| 7 | Throws on server error for ID lookup | HTTP error propagation |
| 8 | Returns Wikipedia summary data | Wikipedia enrichment |
| 9 | Returns null when Wikipedia article not found | Wikipedia 404 |
| 10 | Returns null on Wikipedia API errors | Wikipedia graceful degradation |

**Integration tests (via `placesTool`):**

| # | Test case | What it verifies |
|---|-----------|------------------|
| 11 | Name search returns all matches without Wikipedia | Search mode routing |
| 12 | Numeric ID returns single result with Wikipedia | Lookup mode routing |
| 13 | Numeric ID returns result without Wikipedia when Wikipedia fails | Graceful degradation |
| 14 | Name search with no matches returns empty results | Zero-match end-to-end |
| 15 | Numeric ID not found throws error | Lookup 404 end-to-end |
| 16 | FamilySearch API failure throws error | Error propagation |

### Smoke-test script

```bash
cd mcp-server
npx tsx dev/try-places.ts Ohio            # Search by name
npx tsx dev/try-places.ts 267             # Lookup by place ID (England)
npx tsx dev/try-places.ts Madison         # Disambiguation (multiple matches)
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

- Call `places({ query: "Ohio" })` — returns Ohio and similar matches with scores
- Call `places({ query: "267" })` — returns England with Wikipedia enrichment
- Call `places({ query: "Madison" })` — returns multiple Madisons for disambiguation
- Call `places({ query: "9999999" })` — returns "Place not found" error

### Manual Layer 2 (Claude Code)

- "Tell me about Ohio for genealogy research" — Claude should call
  `places` with query `"Ohio"` and present the results
- "What FamilySearch place is ID 267?" — Claude should call `places`
  with query `"267"` and present the enriched result
