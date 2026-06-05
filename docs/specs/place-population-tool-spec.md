# Place Population Tool — Implementation Spec

## Overview

An MCP tool that returns historical population data and indexed record counts
for a FamilySearch place. No authentication required — it calls the Pop Stats
API, which is a separate service running on the host.

The tool takes a FamilySearch `placeId` and optional year filters, and returns
population data from multiple sources (populstat, gapminder) and FamilySearch
indexed birth record counts.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `placeId` | string | Yes | FamilySearch place ID (e.g., `"1927069"` for Nigeria) |
| `year` | number | No | Specific year to query |
| `year_start` | number | No | Start of year range |
| `year_end` | number | No | End of year range |

If no year parameters are provided, all available data for the place is returned.
When `year` is specified, a nearest-year fallback finds the closest available
data point if no exact match exists.

Example (single year):
```json
{ "placeId": "1927069", "year": 1960 }
```

Example (year range):
```json
{ "placeId": "1927069", "year_start": 1900, "year_end": 1950 }
```

---

## Output

The response is the structured JSON returned by the Pop Stats API. It contains
place metadata, population data grouped by source, and indexed record data.

| Field | Type | Description |
|-------|------|-------------|
| `place` | object | Place metadata (`place_id`, `name`, `level`, optional `parent`) |
| `population` | object? | Population data keyed by source name (e.g., `"populstat"`, `"gapminder"`) |
| `indexed_records` | object? | Indexed record data keyed by source (e.g., `"familysearch_births"`) |

Each population source entry:

| Field | Type | Description |
|-------|------|-------------|
| `source_url` | string? | URL to the original data source |
| `level` | string? | Present when data comes from a parent place (e.g., country data for a province query) |
| `place` | object? | Parent place info when data is resolved from parent (`place_id`, `name`) |
| `data` | array | Array of `{ year, population, data_type }` objects |

Each indexed records source entry:

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable label (e.g., `"Indexed birth records"`) |
| `level` | string? | Present when data comes from a parent place |
| `place` | object? | Parent place info when resolved from parent |
| `data` | array | Array of `{ period_start, period_end, records }` objects |

Empty sections are omitted from the response.

Example:
```json
{
  "place": {
    "place_id": "1927069",
    "name": "Nigeria",
    "level": "country"
  },
  "population": {
    "populstat": {
      "source_url": "http://populstat.info/Africa/nigeriac.htm",
      "data": [
        { "year": 1960, "population": 42739000, "data_type": "census" }
      ]
    },
    "gapminder": {
      "source_url": "https://www.gapminder.org/data/documentation/gd003/",
      "data": [
        { "year": 1960, "population": 45053782, "data_type": "estimate" }
      ]
    }
  },
  "indexed_records": {
    "familysearch_births": {
      "description": "Indexed birth records",
      "data": [
        { "period_start": 1955, "period_end": 1960, "records": 998942 }
      ]
    }
  }
}
```

---

## Tool Schema

```typescript
{
  name: "place_population",
  description: "Get historical population data and indexed record counts for a FamilySearch place. Pass a FamilySearch place ID (from the places tool) and optionally filter by year or year range. Returns population data from multiple sources and FamilySearch indexed birth record coverage. No authentication required.",
  inputSchema: {
    type: "object",
    properties: {
      placeId: {
        type: "string",
        description: "FamilySearch place ID (e.g., \"1927069\" for Nigeria). Use the places tool first to find the place ID."
      },
      year: {
        type: "number",
        description: "Specific year to query. If no exact match exists, returns the nearest available year."
      },
      year_start: {
        type: "number",
        description: "Start of year range filter."
      },
      year_end: {
        type: "number",
        description: "End of year range filter."
      }
    },
    required: ["placeId"]
  }
}
```

---

## Authentication

None required. The Pop Stats API is an internal service with no auth.

---

## Pop Stats API Reference

**Endpoint:**
```
GET {POP_STATS_BASE_URL}/population
```

The base URL defaults to `http://localhost:8000` and can be overridden via
the `POP_STATS_BASE_URL` environment variable.

**Query parameters:**

| Parameter | Type | Required | Purpose |
|-----------|------|----------|---------|
| `place_id` | string | Yes | FamilySearch place ID |
| `year` | number | No | Specific year |
| `year_start` | number | No | Start of range |
| `year_end` | number | No | End of range |

**Key API behaviors:**

- Nearest-year fallback: when `year` is specified and no exact match exists,
  the API returns the closest available data point.
- Parent resolution: for provinces and towns, gapminder population and
  FamilySearch indexed records are country-level only. The API automatically
  resolves to the parent country and flags the data with `level` and `place`
  fields.
- Empty sections are omitted from the response (no empty `population: {}`
  or `indexed_records: {}`).

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| `placeId` not provided | Throw error: `"placeId is required"` |
| Pop Stats API unreachable | Throw error: `"Population data service is unavailable. Is the Pop Stats API running?"` |
| API returns non-OK status | Throw error: `"Population API error: {status} {statusText}"` |
| API returns 404 / no data | Return the API's response as-is (place info with no population/indexed_records sections) |

---

## Configuration

The Pop Stats API base URL is read from the `POP_STATS_BASE_URL` environment
variable, defaulting to `http://localhost:8000`. This allows deployment
flexibility — the API may run on the same host or a remote server.

---

## Files

### `mcp-server/src/types/population.ts`

Input and output types for the population tool:
- `PopulationToolInput` — tool input shape
- `PopulationResponse` — API response shape (place, population, indexed_records)

### `mcp-server/src/tools/population.ts`

- `populationToolSchema` — MCP tool schema
- `populationTool(input)` — main function (builds query string, fetches, returns)

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Testing

### `tests/tools/population.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns population data for a valid placeId | Happy path |
| 2 | Returns data filtered by specific year | Year filter |
| 3 | Returns data filtered by year range | Year range filter |
| 4 | Returns nearest-year data when exact year has no match | Fallback behavior |
| 5 | Returns parent-level data for province/town queries | Parent resolution |
| 6 | Throws error when placeId is missing | Input validation |
| 7 | Throws error when API is unreachable | Service availability |
| 8 | Handles API error responses | HTTP error handling |
| 9 | Omits empty sections from response | Response structure |

### Smoke-test script

```bash
cd mcp-server
npx tsx dev/try-population.ts 1927069              # Nigeria (country)
npx tsx dev/try-population.ts 1927069 --year 1960  # Nigeria, specific year
npx tsx dev/try-population.ts 399 --year 1900      # Abia (province), parent resolution
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
- Call `population({ placeId: "1927069" })` — returns Nigeria population data
- Call `population({ placeId: "1927069", year: 1960 })` — returns 1960 data
- Call `population({ placeId: "399" })` — returns Abia data with parent resolution
- Call `population({})` — returns validation error

### Manual Layer 2 (Claude Code)
- "What was the population of Nigeria in 1960?" — Claude should call `place_search`
  to find Nigeria's place ID, then call `place_population` with that ID and year
