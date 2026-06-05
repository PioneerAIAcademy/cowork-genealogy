# Place Search Tool — Implementation Spec

## Overview

Two MCP tools, `place_search` and `place_search_all`, return FamilySearch
place data for a named place, enriched with a Wikipedia link. No
authentication required — both use the public FamilySearch places endpoints.

Both tools are thin wrappers over a single **internal** function,
`placeSearch(placeName, contextName?)`, and both return arrays of
`SimplifiedPlaceResult` — a deliberately ID-free shape. **FamilySearch place
IDs and place representation (rep) IDs are never exposed to the LLM.** They are
an internal API detail; the model works with place names and the returned
human-readable fields only. (A later phase will route every tool that needs a
place ID through `placeSearch` so IDs stay inside the server.)

`place_search_all` is documented in
[`place-search-all-tool-spec.md`](./place-search-all-tool-spec.md); this file
covers `place_search` and the shared internal function.

### The two FamilySearch ID systems (internal only)

A FamilySearch place carries two distinct identifiers: the **Primary** ID
(`placeId`, the canonical place ID) and the **rep** ID (`placeRepId`,
FamilySearch's internal sequential index, accepted by the
`/places/description/{id}` endpoint). The number spaces overlap, so the same
number means different places on different endpoints. The internal function
handles this plumbing privately; neither ID appears in tool output.

---

## Wikipedia link source

`wikipediaUrl` comes from **FamilySearch's own curated per-place link**, not from
a Wikipedia name lookup. FamilySearch stores a `WIKIPEDIA_LINK` attribute on each
place rep, exposed by the same place service the FS research-places website uses:

```
GET https://www.familysearch.org/service/standards/place/ws-ui/places/reps/{placeRepId}/attributes/
```

Take the attribute whose `type.code == "WIKIPEDIA_LINK"` and use its `url`. These
links are correct per-place (verified live):

| Place | `placeRepId` | FS `WIKIPEDIA_LINK` url |
|-------|--------------|-------------------------|
| Paris, Idaho | `3988097` | `https://en.wikipedia.org/wiki/Paris,_Idaho` |
| Paris, France | `442102` | `https://fr.wikipedia.org/wiki/Paris` |
| Paris, Texas | `5021746` | `https://en.wikipedia.org/wiki/Paris,_Texas` |
| Paris, Ontario | `11783786` | `https://en.wikipedia.org/wiki/Paris,_Ontario` |

When a place has no `WIKIPEDIA_LINK` attribute, `wikipediaUrl` is omitted. The
`/platform/places` search and description endpoints do **not** carry this link —
it lives only on this `ws-ui` attributes endpoint.

> Earlier drafts of this spec described enriching via a Wikipedia name lookup
> (`/page/summary/{name}`), which produced wrong links for non-primary-topic
> places. That was a mistake — superseded by the FamilySearch attribute above.

---

## Internal function — `placeSearch(placeName, contextName?) -> PlaceResult[]`

The single entry point any tool should call when it needs FamilySearch place
data or IDs for a named place. Returns the full internal `PlaceResult[]` (which
still carries IDs for in-server use).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `placeName` | string | Yes | The place to search for (e.g., `"Paris"`). |
| `contextName` | string | No | Name of a higher-level place used to disambiguate (e.g., `"Idaho"`, `"France"`). |

Steps:

1. **Search** — `GET /platform/places/search?q=name:{placeName}` (Places_Search_resource).
2. **Filter by context** — if `contextName` is given, keep only search entries
   whose `fullName` contains it (case-insensitive substring). **If nothing
   matches, keep the unfiltered list** — better to return extra results than
   zero. Filtering happens on the search entries, before any description call.
3. **Describe** — for each surviving rep ID, `GET /platform/places/description/{repId}`
   (Place_Description_resource). If a description 404s, fall back to the
   search-entry data so the place is not dropped.
4. **Enrich** — for each place, `GET …/service/standards/place/ws-ui/places/reps/{placeRepId}/attributes/`
   and take the `WIKIPEDIA_LINK` attribute's `url` as `wikipediaUrl` (see
   [Wikipedia link source](#wikipedia-link-source)). Graceful: a non-OK status,
   network error, or absent attribute yields no `wikipediaUrl`, not an error.
5. **Cache** — memoize the `PlaceResult[]` in a module-level `Map` keyed by the
   normalized `(placeName, contextName)` pair (trimmed + lowercased). No TTL;
   lives for the MCP server process. A cache hit returns immediately without
   re-fetching.

### Context filter examples

- `placeSearch("Paris", "Idaho")` → Paris places in Idaho.
- `placeSearch("Paris", "France")` → Paris in France.
- `placeSearch("Paris")` → all Paris matches FamilySearch returns, unfiltered.

---

## `place_search` tool

`placeSearchTool({ placeName, contextName? })` runs `placeSearch`, projects each
`PlaceResult` to `SimplifiedPlaceResult` via `simplifyPlaceResult`, and returns
`{ results: SimplifiedPlaceResult[] }`.

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `placeName` | string | Yes | Place name to search for. |
| `contextName` | string | No | Higher-level place to disambiguate by; matched as a case-insensitive substring of each candidate's full name. If nothing matches, unfiltered results are returned. |

```json
{ "placeName": "Paris", "contextName": "Idaho" }
```

### Output

`{ results: SimplifiedPlaceResult[] }`. Each `SimplifiedPlaceResult`:

| Field | Type | Description |
|-------|------|-------------|
| `fullName` | string | Full jurisdictional name (e.g., `"Paris, Bear Lake, Idaho, United States"`). |
| `type` | string | Place type (e.g., `"City"`, `"County"`, `"Country"`). |
| `dateRange` | string? | Temporal description in ISO formal notation (e.g., `"+1875/"`). |
| `latitude` | number? | Geographic latitude. |
| `longitude` | number? | Geographic longitude. |
| `familysearchUrl` | string | Link to the place on the FamilySearch website. |
| `wikipediaUrl` | string? | Link to the Wikipedia article (when enrichment succeeds). |

No `placeId`, `placeRepId`, `score`, `name`, `parentPlaceRepId`, or `wikipedia`
object is present — those exist only on the internal `PlaceResult`.

```json
{
  "results": [
    {
      "fullName": "Paris, Bear Lake, Idaho, United States",
      "type": "City",
      "dateRange": "+1875/",
      "latitude": 42.22722,
      "longitude": -111.40028,
      "familysearchUrl": "https://www.familysearch.org/en/research/places/?text=Paris&focusedId=3988097",
      "wikipediaUrl": "https://en.wikipedia.org/wiki/Paris,_Idaho"
    }
  ]
}
```

### Tool Schema

```typescript
{
  name: "place_search",
  description:
    "Look up places for genealogy research by name. Pass a place name " +
    "(e.g., 'Paris', 'Madison') to get all matching places. Optionally pass a " +
    "higher-level place as context to disambiguate among places that share a " +
    "name — e.g. placeName 'Paris' with contextName 'Idaho' returns Paris in " +
    "Idaho, while contextName 'France' returns Paris in France. Each result " +
    "includes the full jurisdictional name, place type, date range, " +
    "coordinates, a FamilySearch link, and (when available) a Wikipedia link. " +
    "Use place_search_all instead when you need every historical jurisdiction " +
    "a place has belonged to over time.",
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

## Authentication

None. The FamilySearch places endpoints and the Wikipedia API are all public.

---

## FamilySearch API Reference

### Places_Search_resource

```
GET https://api.familysearch.org/platform/places/search?q=name:{query}
Accept: application/x-gedcomx-atom+json
```

Response: `entries[]`, each with `id` (rep ID), `score`, and
`content.gedcomx.places[0]` carrying `display.{name,fullName,type}`,
`latitude`/`longitude`, `temporalDescription.formal`, and
`identifiers["http://gedcomx.org/Primary"][0]` (a URL whose last path segment is
the Primary `placeId`).

### Place_Description_resource

```
GET https://api.familysearch.org/platform/places/description/{repId}
Accept: application/json
```

Response: `places[0]` with the same display/coord/temporal fields plus
`jurisdiction.resourceId` (parent rep ID). Accepts **rep IDs only**.

---

## Wikipedia link API Reference

```
GET https://www.familysearch.org/service/standards/place/ws-ui/places/reps/{placeRepId}/attributes/
Accept: application/json
```

(This is the place service the FS research-places website uses, not the
`api.familysearch.org/platform` API. Send a browser `User-Agent`; the request
succeeds unauthenticated.)

Response: `attributes[]`. Take the entry whose `type.code == "WIKIPEDIA_LINK"`
and use its `url` (its `urlTitle` is the article title, e.g. `"Paris, Idaho -
Wikipedia"`). Optional enrichment — any non-OK status, error, or missing
attribute degrades gracefully to no `wikipediaUrl`. (Places may also carry an
`FS_WIKI_LINK` attribute — the FamilySearch research wiki, a different thing;
ignore it for `wikipediaUrl`.)

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Search returns no results (empty body or empty entries) | Return `{ results: [] }` |
| A description lookup 404s | Fall back to the search-entry data; do not drop the place |
| FamilySearch search/description returns other non-OK status | Throw `"FamilySearch API error: {status} {statusText}"` |
| Wikipedia API fails (any status or network error) | Omit Wikipedia fields (graceful degradation) |

---

## Files

| File | Contents |
|------|----------|
| `mcp-server/src/types/place.ts` | `SimplifiedPlaceResult`, `PlaceResult` (internal), `PlaceSearchToolResponse = { results: SimplifiedPlaceResult[] }`, and the FS/Wikipedia response types. |
| `mcp-server/src/tools/place-search.ts` | Internal `placeSearch` + module cache, `getPlaceRepIds`, `getPlaceWikipediaUrl` (reads the `WIKIPEDIA_LINK` attribute), `simplifyPlaceResult`, `placeSearchTool` + `placeSearchToolSchema`, `placeSearchAllTool` + `placeSearchAllToolSchema`. Plus the reusable helpers `searchPlace`, `getPlaceById`, `getPlaceByPrimaryId`, `getPlaceCandidateNames`, `extractPrimaryId`, `toPlaceResult`. |
| `mcp-server/src/tool-schemas.ts`, `src/index.ts`, `manifest.json` | Registration for both tools. |
| `mcp-server/tests/tools/place-search.test.ts` | Unit + integration coverage. |
| `mcp-server/dev/try-place-search.ts`, `dev/try-place-search-all.ts` | Live smoke scripts. |

---

## Verification

```bash
cd mcp-server && npm run build && npm test

# Live smoke (no auth):
npx tsx dev/try-place-search.ts Paris Idaho     # Paris in Idaho
npx tsx dev/try-place-search.ts Paris France    # Paris in France
npx tsx dev/try-place-search.ts Paris           # all Paris matches, unfiltered
```

Confirm no result object contains `placeId`, `placeRepId`, `score`, `name`, or
`parentPlaceRepId`.
