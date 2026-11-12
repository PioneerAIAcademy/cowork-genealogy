# Place Search All Tool — Implementation Spec

## Overview

`place_search_all` is an MCP tool that, for a named place, returns **every
jurisdiction that place has belonged to over time**. Where `place_search`
returns the matching place(s), `place_search_all` additionally expands each
match to all of its FamilySearch place representations — useful when boundaries
or parent jurisdictions changed across the time period being researched (e.g. a
town that was in a colonial territory before statehood, or a county whose parent
changed).

It shares the internal `placeSearch` function and the ID-free
`SimplifiedPlaceResult` output shape with `place_search`; see
[`place-search-tool-spec.md`](./place-search-tool-spec.md) for both. **Place IDs
and rep IDs are never exposed to the LLM.**

No authentication required.

---

## Input

Identical to `place_search`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `placeName` | string | Yes | Place name to search for. **Sanitized before it is sent** (`&` → the word `and`; `?` `*` `#` `~` dropped) — see [`place-search-tool-spec.md`](./place-search-tool-spec.md#places_search_resource), which owns the shared query construction. |
| `contextName` | string | No | Higher-level place to disambiguate by; matched as a case-insensitive substring of each candidate's full name. If nothing matches, unfiltered results are used. |

```json
{ "placeName": "Schuylkill County", "contextName": "Pennsylvania" }
```

---

## Behavior

`placeSearchAllTool({ placeName, contextName? })`:

1. **Base search** — run the internal `placeSearch(placeName, contextName)` (same
   search → context filter → describe → enrich → cache flow as `place_search`,
   **including the fuzzy fallback** — see the sibling spec's step 1).
2. **Collect Primary IDs** — gather the distinct `placeId` (Primary) values from
   the base results.
3. **Expand** — for each Primary ID, take its Place_resource listing (`GET
   /platform/places/{pid}`) to list **all** of its representation (rep) IDs,
   reusing the listing the base search already fetched for that Primary ID
   while naming matches (the sibling spec's step 5) rather than fetching it
   again. Union the rep IDs across all Primary IDs into a distinct set.
4. **Describe each rep** — for each distinct rep ID,
   `GET /platform/places/description/{repId}` (Place_Description_resource).
5. **Enrich + simplify** — for each, read the FamilySearch `WIKIPEDIA_LINK`
   attribute for `wikipediaUrl` (see the place_search spec's
   [Wikipedia link source](./place-search-tool-spec.md#wikipedia-link-source)),
   then project to `SimplifiedPlaceResult`. Rep IDs whose description lookup
   404s are dropped. On an exact base outcome, each result carries
   `matchedName` by the sibling spec's step 5 rule, read from its Primary ID's
   listing names: the query leaf equals one of the place's names (folded) that
   is not the representation's own. Every listing is in hand, so this costs no
   request, and it reaches representations whose base result was named after
   the leaf.
6. Return `{ results: SimplifiedPlaceResult[], matchType: "exact" | "fuzzy" }`,
   carrying the base search's `matchType` unchanged — unflagged fuzzy results
   from this tool are exactly the failure the flag exists to prevent.

The result set is broader than `place_search`: it includes the temporal/parent
variants of each matched place, not just the place itself.

---

## Output

`{ results: SimplifiedPlaceResult[], matchType: "exact" | "fuzzy" }`, same shape as
`place_search` (see the sibling spec) — including `wikipediaUrl`, `matchedName`
and the top-level `matchType`, `"fuzzy"` when the base search's results came
from the fuzzy fallback and `"exact"` otherwise, which means only that the
exact-name query produced them (see the sibling spec's Output). The internal FamilySearch
identifiers, relevance score, and short `name` are not exposed.

```json
{
  "results": [
    {
      "standardPlace": "Schuylkill, Pennsylvania, United States",
      "type": "County",
      "dateRange": "+1811/",
      "latitude": 40.707,
      "longitude": -76.185,
      "familysearchUrl": "https://www.familysearch.org/en/research/places/?text=Schuylkill&focusedId=393167",
      "wikipediaUrl": "https://en.wikipedia.org/wiki/Schuylkill_County,_Pennsylvania"
    },
    {
      "standardPlace": "Schuylkill, Philadelphia, Philadelphia, Pennsylvania, British Colonial America",
      "type": "Neighborhood or suburb",
      "dateRange": "/+1776",
      "latitude": 39.9422,
      "longitude": -75.1875,
      "familysearchUrl": "https://www.familysearch.org/en/research/places/?text=Schuylkill&focusedId=4982995",
      "wikipediaUrl": "https://en.wikipedia.org/wiki/Schuylkill,_Philadelphia"
    }
  ],
  "matchType": "exact"
}
```

---

## Tool Schema

```typescript
{
  name: "place_search_all",
  description:
    "Look up a place and return every jurisdiction it has belonged to over " +
    "time. Takes the same input as place_search (a place name plus an optional " +
    "higher-level place as context). Where place_search returns the matching " +
    "place(s), place_search_all additionally expands each match to all of its " +
    "historical representations — useful when boundaries or parent " +
    "jurisdictions changed across the time period you're researching. Each " +
    "result includes the standardized place name (standardPlace), place type, " +
    "date range, coordinates, a FamilySearch link, and (when available) a " +
    "Wikipedia link. " +
    'matchType is "exact" when the exact-name query produced these results, or ' +
    '"fuzzy" when the place you named had no exact match and these are ' +
    "sounds-alike corrections; confirm a fuzzy one before using it. A result " +
    "with matchedName matched your text through that other name of the place " +
    "(e.g. its name in another language): an exact match, not a guess. If no " +
    "result's standardPlace starts with the name you sent and none carries a " +
    "matchedName, the search matched another part of your text, not the place.",
  inputSchema: {
    type: "object",
    properties: {
      placeName: {
        type: "string",
        description: "The place name to search for (e.g., 'Paris', 'Schuylkill County')."
      },
      contextName: {
        type: "string",
        description:
          "Optional name of a higher-level place (state, country, etc.) used to " +
          "disambiguate. Matches places whose full name contains this text. If " +
          "nothing matches, the unfiltered results are returned instead."
      }
    },
    required: ["placeName"]
  }
}
```

---

## FamilySearch API Reference

In addition to Places_Search_resource and Place_Description_resource (see the
`place_search` spec), `place_search_all` uses:

### Place_resource

```
GET https://api.familysearch.org/platform/places/{pid}
Accept: application/json
```

Returns `places[]`: a bare place entry (`id === pid`, no `display`) followed by
representation entries, each with `place.resourceId === pid`. Collect each
representation's `id` (the rep IDs). The bare entry's `names[]` lists every name
of the place as `{ lang, value }`, which the matched name is read from.
Implemented as `getPlaceListing(pid)` in `utils/place-api.ts`, returning the
representations and the bare entry's names with `lang` (no auth; parallels the
token-bound `placeIdToRepIds` in `image-search.ts`).

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Base search returns no matches (exact and, when eligible, fuzzy — see the sibling spec) | Return `{ results: [], matchType: "exact" }` |
| `GET /places/{pid}` 404s | Treat as no rep IDs for that pid (skip it) |
| `GET /places/{pid}` fails while the base search names matches | No `matchedName` for that place; the listing is not reused, so step 3 fetches it again |
| `GET /places/{pid}` other non-OK status in step 3 | Throw `"FamilySearch API error: {status} {statusText}"` |
| A rep-ID description lookup 404s | Drop that rep ID from the results |
| Wikipedia API fails | Omit Wikipedia fields (graceful degradation) |

---

## Verification

```bash
cd packages/engine/mcp-server && npm run build && npm test

# Live smoke (no auth):
npx tsx dev/try-place-search-all.ts "Schuylkill County" Pennsylvania
```

Confirm the result set includes temporal/parent variants and that no result
object contains `placeId`, `placeRepId`, `score`, `name`, or
`parentPlaceRepId`.
