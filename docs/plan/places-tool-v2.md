# Places Tool Implementation Plan — v2

**Endpoints used:** (unchanged from v1)

- `GET https://api.familysearch.org/platform/places/search?q=name:{query}` — FamilySearch place name search
- `GET https://api.familysearch.org/platform/places/description/{id}` — FamilySearch place details by ID
- `GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}` — Wikipedia article summary

See the "API endpoints" section below for empirical notes and response shapes.

## Summary

Update the `places` MCP tool to return **all matches** for a name search, not
just the top result. v1 collapses search results to `entries[0]` and enriches
it with Wikipedia; v2 returns the full ranked list for name queries and
reserves Wikipedia enrichment for ID lookups only.

See `places-tool.md` for the original plan; this document describes only what
changes in v2.

## Motivation

The v1 tool answers "what is this place?" when the caller already knows which
place they mean. It cannot answer "which places are called X?" — a
disambiguation query that returns a ranked list. A name like "Madison" or
"Ohio" matches dozens of real places across different countries, counties,
and historical periods. Returning only the top match silently discards that
ambiguity and forces Claude to re-query the API if the top match turns out to
be wrong.

v2 exposes the full ranked list so Claude can see all candidates at once,
pick the right one by hierarchy and score, and then (if needed) request full
details via a follow-up ID lookup.

## Scope changes vs v1

| Aspect | v1 | v2 |
|---|---|---|
| Name search return | Single top-scored result | All results FamilySearch returns |
| Wikipedia on name search | Enriches top result | No enrichment |
| Wikipedia on ID lookup | Enriches result | Enriches result (unchanged) |
| Empty name-search results | Throws `Place not found` | Returns `{ results: [] }` |
| Empty ID lookup (404) | Throws `Place not found` | Throws (unchanged) |
| Response shape | `PlaceResult` | `{ results: PlaceResult[] }` |
| Score field | Discarded | Exposed as `score` on each result |
| Tool input schema | `{ query: string }` | Unchanged |

## Behavior rules

**Enrichment rule.** Wikipedia enrichment is driven purely by input type.
Numeric input → ID lookup → enriched. Non-numeric input → name search → not
enriched. No flags, no parameters, no thresholds. This is intentionally the
simplest rule that works; richer enrichment strategies are deferred.

**Empty-results rule.** A name search that matches nothing returns
`{ results: [] }` with no error. This lets Claude distinguish "no such place"
(a valid answer) from "the API is broken" (a thrown error).

**ID lookup rule.** An ID that FamilySearch returns 404 for still throws
`Place not found: ${id}`. Unlike a name search, an ID is an assertion — if
the asserted ID does not exist, that is a caller error.

**Ranking rule.** Name-search results are returned in the order FamilySearch
provides (already sorted by descending score). Raw score is exposed as
`score: number` on each result so Claude can reason about relative confidence.
No normalization, no filtering, no cap.

## Response shape

Uniform for both paths:

```typescript
interface PlacesToolResponse {
  results: PlaceResult[];
}

interface PlaceResult {
  // FamilySearch data
  placeId: string;
  name: string;
  fullName: string;
  type: string;
  latitude?: number;
  longitude?: number;
  dateRange?: string;
  parentPlaceId?: string;  // present on ID lookups, absent on name searches
  score?: number;          // present on name searches, absent on ID lookups

  // Wikipedia data (ID lookups only in v2)
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

**Why wrap the array in an object.** Room for future metadata (total count,
echoed query, pagination) without breaking callers.

**Why uniform shape for both paths.** Claude's downstream parsing is
branch-free: `results.forEach(...)` or `results[0]` regardless of input type.
ID lookup returns a one-element array; empty name search returns an empty
array; name search returns as many as FamilySearch provides.

## API endpoints (unchanged from v1)

```
GET https://api.familysearch.org/platform/places/search?q=name:{query}
    Accept: application/x-gedcomx-atom+json

GET https://api.familysearch.org/platform/places/description/{id}
    Accept: application/json

GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}
```

### Empirical notes from `/places/search`

- Returns up to 46 entries for "Ohio", each with a numeric `score` field.
- Top exact match scores 100.0; literally-named-but-ambiguous matches cluster
  at 64.0; fuzzy tail drops to ~34.0 and surfaces some noise (e.g., "Corinth,
  Massachusetts" at 34.0 for an Ohio search).
- `/places/interp` was investigated as a potential alternative endpoint for
  ranked results but returns 404 — it does not exist as a public endpoint.
  The `score` field on `/places/search` is the relevance signal to use.
- Search entries do **not** include `jurisdiction.resourceId`; parent IDs are
  only returned by the description endpoint. This is why `parentPlaceId` is
  absent from name-search results. The `fullName` still embeds the full
  hierarchy as a string (e.g., "Ohio, Hamilton, Texas, United States"), so
  Claude can still read the parentage.

## Files to modify

| File | Change |
|---|---|
| `mcp-server/src/types/place.ts` | Add `score?: number` to `PlaceResult`; add `PlacesToolResponse = { results: PlaceResult[] }` wrapper |
| `mcp-server/src/tools/places.ts` | `searchPlace()` returns `SearchPlaceResult[]`; `placesTool()` returns `PlacesToolResponse`; empty name search returns `{ results: [] }` instead of throwing |
| `mcp-server/tests/tools/places.test.ts` | Update existing tests to new shape; add tests for list behavior, empty-search, score exposure |
| `mcp-server/src/index.ts` | Confirm the MCP response serialization still works with the wrapper (likely no code change) |
| `docs/plan/places-tool.md` | No change — retained as v1 reference |

## Implementation steps (TDD)

Red-green-refactor, one unit at a time. Each step leaves the full test suite
passing before the next begins.

1. **Update types.** Add `score?: number` to `PlaceResult`. Add
   `PlacesToolResponse` wrapper type. No behavior change yet; the compiler
   will flag downstream sites in the next steps.
2. **Rewrite `searchPlace` tests** for array return. Cover: returns all
   entries, preserves `score` on each, returns `[]` on empty response body,
   returns `[]` on empty `entries`, throws on non-2xx HTTP status. Tests
   should fail (red).
3. **Update `searchPlace` implementation** to map over `data.entries` and
   return `SearchPlaceResult[]`. Tests pass (green).
4. **Rewrite `placesTool` tests** for the wrapped response. Cover: name
   search returns `{ results: [...] }` with multiple entries and no
   Wikipedia, ID lookup returns `{ results: [one] }` with Wikipedia, name
   search with zero matches returns `{ results: [] }` without throwing,
   ID 404 still throws, FamilySearch 500 still throws. Tests fail (red).
5. **Update `placesTool` implementation.**
   - Numeric input: call `getPlaceById`, fetch Wikipedia, wrap single result
     in `{ results: [...] }`. 404 → throw (unchanged).
   - Non-numeric input: call `searchPlace`, map results to `PlaceResult[]`
     (no Wikipedia fetch, preserve `score`), wrap in `{ results: [...] }`.
     Empty list → return `{ results: [] }`, do not throw.
   Tests pass (green).
6. **Refactor.** Look for duplicated shape-building logic between the two
   paths; pull out a shared `toPlaceResult()` helper only if it simplifies.
7. **Manual smoke test.** `npm run build`, then point an MCP client at the
   built server and run `places({ query: "Ohio" })` and
   `places({ query: "357" })`. Verify both response shapes match the types.

## Edge cases

- **Name search returns zero entries** → `{ results: [] }`, no throw.
- **Name search returns fuzzy-matched noise** (Corinth in an Ohio search) →
  return it anyway; Claude reads the score and decides.
- **FamilySearch returns empty HTTP body** (existing v1 behavior) → treat
  as zero entries, return `{ results: [] }`.
- **ID lookup with 404** → throw `Place not found: ${id}` (unchanged).
- **Wikipedia 404 or error on ID lookup** → graceful degradation, return
  result without `wikipedia` field (unchanged).
- **Score missing from a search entry** → field is omitted from that result;
  Claude sees `score: undefined`. Defensive but unlikely in practice.

## Out of scope for v2

Deferred deliberately; v2 does not pre-commit to any of these:

- Whether to enrich name-search results with Wikipedia at all (currently: no).
- Whether to cap the list length or filter by a score threshold (currently:
  return everything).
- Whether to normalize `score` to a 0–1 confidence (currently: raw).
- Whether `places` should be split into `placeSearch` and `placeDetails`, or
  stay as a single tool (currently: one, per CLAUDE.md convention).
- Hierarchy drill-down (children of a place) — a different operation, not
  part of this tool.

## Test commands

```bash
cd mcp-server && npm test                        # Run the full vitest suite
cd mcp-server && npm run test:watch              # Watch mode during TDD
cd mcp-server && npm run build                   # Typecheck and emit build/

# Live endpoint sanity checks (no auth required):
curl -H "Accept: application/x-gedcomx-atom+json" \
  "https://api.familysearch.org/platform/places/search?q=name:Ohio"
curl -H "Accept: application/json" \
  "https://api.familysearch.org/platform/places/description/357"
```
