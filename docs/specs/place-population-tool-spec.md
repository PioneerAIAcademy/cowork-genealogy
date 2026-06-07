# Place Population Tool — Implementation Spec

## Overview

An MCP tool that returns historical population data and indexed record counts
for a FamilySearch place. No authentication required — it calls the Pop Stats
API, which is a separate service running on the host.

The tool takes a standard place name (`standardPlace`, from place_search) and optional year filters, and returns
population data from multiple sources (populstat, gapminder) and FamilySearch
indexed birth record counts.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `standardPlace` | string | Yes | Standard place name from place_search (e.g., `"Nigeria"`) |
| `year` | number | No | Specific year to query |
| `startYear` | number | No | Start of year range (inclusive) |
| `endYear` | number | No | End of year range (inclusive) |

If no year parameters are provided, all available data for the place is returned.
When `year` is specified, a nearest-year fallback finds the closest available
data point if no exact match exists.

Example (single year):
```json
{ "standardPlace": "Nigeria", "year": 1960 }
```

Example (year range):
```json
{ "standardPlace": "Nigeria", "startYear": 1900, "endYear": 1950 }
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
  description: "Get historical population data and indexed record counts for a FamilySearch place. Pass a standard place name (the `standardPlace` field from place_search) and optionally filter by year or year range. Returns population data from multiple sources and FamilySearch indexed birth record coverage. No authentication required.",
  inputSchema: {
    type: "object",
    properties: {
      standardPlace: {
        type: "string",
        description: "The standard place name (the `standardPlace` field from place_search, e.g. \"Nigeria\"). Call place_search first to get this name."
      },
      year: {
        type: "number",
        description: "Specific year to query. If no exact match exists, returns the nearest available year."
      },
      startYear: {
        type: "number",
        description: "Start of year range filter (inclusive)."
      },
      endYear: {
        type: "number",
        description: "End of year range filter (inclusive)."
      }
    },
    required: ["standardPlace"]
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
GET {popStatsUrl}/population
```

The base URL is read from `loadConfig().popStatsUrl` and defaults to the
hosted Pop Stats service (`https://malachi.taild68f1b.ts.net/pop-stats`). It
can be overridden per-user via the `popStatsUrl` field in
`~/.familysearch-mcp/config.json`.

**Query parameters:**

| Parameter | Type | Required | Purpose |
|-----------|------|----------|---------|
| `place_id` | string | Yes | FamilySearch place ID (upstream Pop Stats id-space; the tool resolves `standardPlace` to this via place_search internally) |
| `year` | number | No | Specific year |
| `year_start` | number | No | Start of range. The tool maps the camelCase MCP input `startYear` onto this wire param. |
| `year_end` | number | No | End of range. The tool maps the camelCase MCP input `endYear` onto this wire param. |

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
| `standardPlace` not provided | Throw error: `"standardPlace is required"` |
| `standardPlace` unresolvable / ambiguous | Throw error: `"Could not resolve \"<name>\" to a single FamilySearch place. Use place_search ..."` |
| Pop Stats API unreachable | Throw error: `"Population data service is unavailable. Is the Pop Stats API running?"` |
| API returns non-OK status | Throw error: `"Population API error: {status} {statusText}"` |
| API returns 404 / no data | Return the API's response as-is (place info with no population/indexed_records sections) |

---

## Configuration

The Pop Stats API base URL is read from `loadConfig().popStatsUrl` (the
`popStatsUrl` field in `~/.familysearch-mcp/config.json`), defaulting to the
hosted Pop Stats service `https://malachi.taild68f1b.ts.net/pop-stats`. This
allows deployment flexibility — the API may run on the same host or a remote
server.

---

## Files

### `packages/engine/mcp-server/src/types/place-population.ts`

Input and output types for the population tool:
- `PopulationToolInput` — tool input shape
- `PopulationResponse` — API response shape (place, population, indexed_records)

### `packages/engine/mcp-server/src/tools/place-population.ts`

- `populationToolSchema` — MCP tool schema
- `populationTool(input)` — main function (resolves `standardPlace` to a placeId, builds query string, fetches, returns)

### `packages/engine/mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

---

## Testing

### `tests/tools/place-population.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns population data for a valid standardPlace | Happy path |
| 2 | Returns data filtered by specific year | Year filter |
| 3 | Returns data filtered by year range | Year range filter |
| 4 | Returns nearest-year data when exact year has no match | Fallback behavior |
| 5 | Returns parent-level data for province/town queries | Parent resolution |
| 6 | Throws error when standardPlace is missing | Input validation |
| 7 | Throws error when API is unreachable | Service availability |
| 8 | Handles API error responses | HTTP error handling |
| 9 | Omits empty sections from response | Response structure |

### Smoke-test script

```bash
cd packages/engine/mcp-server
npx tsx dev/try-population.ts "Nigeria"              # Nigeria (country)
npx tsx dev/try-population.ts "Nigeria" --year 1960  # Nigeria, specific year
npx tsx dev/try-population.ts "Abia, Nigeria" --year 1900  # province, parent resolution
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
- Call `place_population({ standardPlace: "Nigeria" })` — returns Nigeria population data
- Call `place_population({ standardPlace: "Nigeria", year: 1960 })` — returns 1960 data
- Call `place_population({ standardPlace: "Abia, Nigeria" })` — returns Abia data with parent resolution
- Call `place_population({})` — returns validation error

### Manual Layer 2 (Claude Code)
- "What was the population of Nigeria in 1960?" — Claude should call `place_search`
  to get Nigeria's standard place name, then call `place_population` with that
  `standardPlace` and year
