# `place_catalog` MCP Tool — Implementation Spec

## Overview

A new MCP tool that searches the **FamilySearch Library catalog**
(books, microfilms, manuscripts, maps, periodicals). Wraps the
internal Catalog Search API documented at the [Catalog Search API
wiki page](https://icseng.atlassian.net/wiki/spaces/Product/pages/814383280/Catalog+Search+API).

The catalog is a different search surface than indexed records:

| Tool | Endpoint | What it covers |
|------|----------|---------------|
| `record_search` | `/service/search/hr/v2/personas` | Indexed persons in record collections |
| `place_collections` | `/service/search/hr/v2/collections` | Indexed record collections with counts |
| `place_external_links` | `/service/search/hr/external/collections/search` | External (non-FS) collection links |
| **`place_catalog` (this tool)** | `/service/search/catalog/v3/search` | FS Library catalog — most items NOT indexed |

Skills currently reference the catalog only in narrative form. With
this tool the LLM can run the lookup itself and surface concrete
titles, holdings, and — critically — **which downstream search
surfaces (record_search / fulltext_search / image_read) are
available for each catalog item**, so it can choose its next call.

Requires authentication (OAuth tokens via the `login` tool).

---

## Two-tool design

The catalog work splits across two MCP tools:

1. **`place_catalog` (this tool, V1)** — list/search mode. Returns
   `CatalogHit[]` with the per-item fields the LLM needs to triage
   results, **plus three boolean flags per hit** indicating which
   downstream search surfaces are available for that item:
   `recordSearch`, `fullTextSearch`, `imageSearch`. To compute those
   flags the tool internally calls upstream detail/availability
   endpoints for each unique search result; the rest of the per-item
   detail shape (per-roll microfilm content, full `source.*`, notes,
   `inclusive_dates`, etc.) is **not** returned by this tool.

2. **`place_catalog_item` (V2 follow-up)** — read mode for a single
   catalog item by id. Returns the full detail JSON. Lives separately
   because the LLM only needs the full detail when it has a specific
   item it wants to drill into; routine triage is served by the
   3-flag enrichment that `place_catalog` already does.

This spec covers `place_catalog` only.

---

## Design decisions

### Input contract: at-least-one of `placeId`, `keywords`, `surname`, `dgs`

The tool requires **at least one** of:

- `placeId` (numeric FamilySearch place id from `place_search`) — the primary axis
- `keywords` (free-text; maps to `q.keywords`)
- `surname` (in title/content; maps to `q.surname`)
- `dgs` (Digital Folder / microfilm number; maps to `q.film_number`)

Multiple of the four can be combined (e.g., `placeId` + `surname`).

A search with **none** of the four throws — required to prevent the
all-catalog footgun (without `m.queryRequireDefault=on`, every `q.*`
param is advisory ranking only and the API returns the entire
catalog).

Optional narrowing filters considered earlier (`title`, `author`,
`subject`, `year`, `topic`, `language`, `onlineOnly`, `availability`,
`format`) are deliberately **not** part of V1. The tool stays narrow;
narrowing happens client-side on returned results or via a follow-up
call.

### `placeId` → catalog rep IDs, union, dedup

The catalog's place model is anchored on **rep IDs**, not Primary
place IDs. A single Primary place ID can correspond to multiple rep
snapshots over time. The LLM is never exposed to rep IDs; the tool
resolves them internally.

**Resolution mechanism (probed 2026-05-27):**

`GET https://api.familysearch.org/platform/places/{placeId}` returns
a `places[]` array containing:
- one stub entry whose `id` equals the requested `placeId` (the
  Primary) and which has no `display` block
- one or more rep entries, each with `id = <rep id>` and
  `identifiers["http://gedcomx.org/Primary"][0]` ending in `<placeId>`

The rep IDs are the `id` values of all entries other than the stub.
Verified one-to-many for several places (e.g., Primary 2249479
"Alabama, Transvaal" → reps 6068937, 6068938; Primary 10440752
"DeKalb, Alabama" → 3 reps). For most US states the relationship is
one-to-one (Primary 33 "Alabama, United States" → rep 351).

The tool then:

1. Resolves `placeId` → `[repId1, repId2, …]` via the call above
2. Runs one catalog search per rep id (each with `q.place_id=<rep>`)
3. Unions the result sets and removes duplicates by catalog `id`

The catalog image-search tool will face the same conversion problem;
the resolution helper should be extracted into a shared utility when
the second consumer lands.

### Three boolean flags per hit

For each unique catalog hit, the tool synthesizes three booleans:

| Flag | True when the item has | Downstream LLM action |
|---|---|---|
| `recordSearch` | Indexed record collection(s) attached | Can call `record_search` for persons |
| `fullTextSearch` | OCR/transcribed full text attached | Can call `fulltext_search` for keywords |
| `imageSearch` | Browsable images (DGS) attached | Can call `image_read` to view rolls |

These flags drive the LLM's next call. Without them the LLM would
have to make N speculative tool calls itself to discover what's
available; this tool collapses that into a single round trip.

**Signal sources (probed 2026-05-27):**

- **`imageSearch`** — from the catalog item-detail response:
  `source.available_online === "Y"`.
- **`fullTextSearch`** — from a separate call to the existing
  fulltext-search endpoint, keyed by the catalog item's DGS:
  `GET /service/search/fulltext/search?q.groupName=<digital_film_no>&count=1&m.queryRequireDefault=on`.
  If `results > 0`, the catalog item has OCR/transcribed text.
  Probe-verified: koha:381194 DGS 7937005 → 601 results;
  koha:62934 DGS 7953746 → 0 results. For multi-DGS items the
  tool checks the first DGS only. For items with no DGS the flag
  is `false`. This matches the meeting note that fulltext
  availability is an asynchronous call keyed by DGS.
- **`recordSearch`** — signal source not yet identified; see Open
  Questions. Defaults to `false` until resolved.

If any of the upstream calls fails for a specific hit, the
corresponding flag is set to `false` for that hit and the search
continues — a per-hit enrichment failure does not fail the whole
search.

### `id` retains `koha:` / `olib:` prefix

Catalog `id` values come from the upstream `identifier.value` URL
with a `koha:` or `olib:` prefix. **The tool preserves the prefix.**
Reasons:

- The two prefixes name distinct catalog backends — stripping invites
  collisions (a `koha:` id and an `olib:` id sharing a number).
- The FS web UI accepts the prefixed form in `/search/catalog/<id>`.
- The future `place_catalog_item` tool needs the prefixed form to
  disambiguate.

The `url` field is built as `https://www.familysearch.org/search/catalog/<id>`
with the prefix intact.

### Service-tier host

The tool calls `sg30p0.familysearch.org`, not `www.familysearch.org`.
Both return identical results (probe-verified 2026-05-25: 894 hits
on Alabama from either host); the service-tier host is the right
surface for service-tier endpoints and matches the internal-API
examples.

The user-facing `url` field still points at `www.familysearch.org`
(that's where users go); only the API call runs against `sg30p0`.

### Why no detail mode in this tool

`place_catalog` already does N item-detail calls internally (one per
unique search hit, for flag extraction). Returning the **full**
detail JSON from each of those calls would defeat the point of the
LLM not having to make them — the response payload would be huge
and most of it would go unused.

The follow-up `place_catalog_item` tool returns the full detail JSON
for a single id when the LLM has triaged the search results and
wants to drill into one specific item.

---

## Input

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `placeId` | string | one-of¹ | — | Numeric FamilySearch place ID (from `place_search`). Resolved internally to one or more catalog rep IDs; results unioned and deduped. |
| `keywords` | string | one-of¹ | — | Free-text keyword search across all indexed fields. Maps to `q.keywords`. |
| `surname` | string | one-of¹ | — | Surname mentioned in title/content. Maps to `q.surname`. **Not** the author's surname — `q.author_surname_text` returns 0 hits for every tested surname (probes 4 + 9). |
| `dgs` | string | one-of¹ | — | Digital Folder / microfilm number. Maps to `q.film_number`. |
| `count` | integer | no | `20` | Page size per rep-ID query. Range 1–100. |
| `offset` | integer | no | `0` | Pagination offset. |

¹ At least one of `placeId`, `keywords`, `surname`, or `dgs` must be provided.

### Defaults this tool *always* sends to the upstream API

- `m.queryRequireDefault=on` — **mandatory** per probe 1. Without it,
  every `q.*` parameter is advisory ranking only and the API returns
  the entire catalog (2,037,676 hits at probe time). The tool
  hardcodes this; it is not a user-facing parameter.
- `m.defaultFacets=off` — V1 does not surface facets. Saves payload.

---

## Output

| Field | Type | Always present? | Description |
|-------|------|-----------------|-------------|
| `totalHits` | integer | yes | Best-effort estimate of unique catalog items matching: sum of upstream `totalHits` across rep-ID queries, minus the dedup count. Exact when `placeId` resolves to ≤1 rep id or `placeId` was not provided. |
| `returnedCount` | integer | yes | Number of items in `hits[]`. |
| `offset` | integer | yes | Pagination offset of the first hit. |
| `hits` | array of `CatalogHit` | yes | Catalog items, deduped by `id` and enriched with the 3 flags. May be empty (`[]`). |

### `CatalogHit` shape

| Field | Type | Always present? | Description |
|-------|------|-----------------|-------------|
| `id` | string | yes | Catalog id with prefix preserved (e.g., `"koha:1837843"` or `"olib:2103552"`). |
| `title` | string | yes | `metadata.title[0].value`. |
| `authors` | array of strings | yes (may be empty) | `metadata.creator[]`. |
| `holdings` | array of strings | yes | `metadata.repositoryCalls[].title` — raw holding strings. |
| `recordSearch` | boolean | yes | Item has indexed record collections — the LLM can call `record_search`. |
| `fullTextSearch` | boolean | yes | Item has OCR / transcribed text — the LLM can call `fulltext_search`. |
| `imageSearch` | boolean | yes | Item has browsable images / DGS — the LLM can call `image_read`. |
| `score` | number | yes | Highest `metadataHit.score` across the rep-ID queries this hit appeared in. |
| `url` | string | yes | `https://www.familysearch.org/search/catalog/<id>` — built with the prefix intact. |

### Example output

```json
{
  "totalHits": 894,
  "returnedCount": 2,
  "offset": 0,
  "hits": [
    {
      "id": "koha:1837843",
      "title": "Alabama Civil War records",
      "authors": ["Griffin, Ronald G"],
      "holdings": ["FamilySearch Library"],
      "recordSearch": false,
      "fullTextSearch": false,
      "imageSearch": false,
      "score": 1.0,
      "url": "https://www.familysearch.org/search/catalog/koha:1837843"
    },
    {
      "id": "koha:2103552",
      "title": "Butler family records, 1850 census, Alabama",
      "authors": ["Butler, Edna May"],
      "holdings": ["FamilySearch Library", "Online"],
      "recordSearch": true,
      "fullTextSearch": true,
      "imageSearch": true,
      "score": 0.92,
      "url": "https://www.familysearch.org/search/catalog/koha:2103552"
    }
  ]
}
```

Empty results return `totalHits: 0, hits: []` — not an error. A
place with no catalog items is a legitimate research finding.

---

## Error Handling

All errors are LLM-instruction errors (the message tells Claude what
to do next), thrown as `Error` objects.

| Condition | Throw message |
|-----------|--------------|
| No FamilySearch session OR API returns 401 | `"User is not logged in to FamilySearch. Call the login tool to authenticate."` |
| API returns 400 with JSON body | `"FamilySearch catalog rejected the request: ${detail-from-body}."` |
| API returns other 4xx/5xx | `"FamilySearch catalog error: ${status} ${statusText}."` |
| All four of `placeId`, `keywords`, `surname`, `dgs` missing | `"place_catalog: at least one of placeId, keywords, surname, or dgs is required."` |
| `count` is out of range (1–100) | `"place_catalog: count must be between 1 and 100. Got: ${count}."` |
| `offset` is negative | `"place_catalog: offset must be non-negative. Got: ${offset}."` |
| `placeId` resolves to zero rep IDs | `"place_catalog: placeId ${placeId} has no catalog rep mapping. The place may be too granular for the catalog, or the id is wrong."` |
| `fetch()` network failure | `"Could not reach FamilySearch catalog endpoint: ${error.message}."` |

The two "not logged in" cases (no tokens locally vs. token rejected
by API) are coalesced into one row — the LLM's next action is
identical for both.

The catalog has no restricted items (some films may be view-restricted,
but title records are always accessible), so a 403 is not expected
during normal use. If one does occur it falls through to the generic
4xx/5xx row.

Per-hit item-detail failures during flag extraction are swallowed —
the tool sets all 3 flags to `false` for the affected hit and
continues. The search itself succeeds.

---

## FamilySearch Catalog Search API Reference

**Endpoint:**
```
GET https://sg30p0.familysearch.org/service/search/catalog/v3/search
```

Service-tier host. Probe-verified 2026-05-25 to return identical
results to `www.familysearch.org`.

**Required headers:**
```
Authorization: Bearer <access token from getValidToken()>
Accept: application/json
User-Agent: <BROWSER_USER_AGENT from src/constants.ts>
```

The browser UA is **always** sent (probe 1: non-browser UAs get
Imperva-403'd, including the catalog's internal `fs-search-agent`).

**Query parameters this tool always sends:**

| Param | Value | Why |
|---|---|---|
| `m.queryRequireDefault` | `on` | Mandatory — without it the API returns the full catalog regardless of query (2,037,676 hits at probe time). |
| `m.defaultFacets` | `off` | V1 doesn't surface facets. |
| `count` | `<count>` (default 20) | Page size. |
| `offset` | `<offset>` (default 0) | Pagination. |

**Per-search-axis query parameters (one of these is required):**

| Caller field | Param sent |
|---|---|
| (resolved from `placeId`) | `q.place_id` (one value per rep id; one search per rep id). The upstream parameter is literally named `place_id` but accepts the catalog's rep ID values, **not** Places-API Primary IDs. Probe-verified 2026-05-28. |
| `keywords` | `q.keywords` |
| `surname` | `q.surname` |
| `dgs` | `q.film_number` |

**Reference call (surname only, no place):**

```bash
curl -H 'Authorization: Bearer p0-XXXX' \
  -H 'User-Agent: Mozilla/5.0 ...' \
  -H 'Accept: application/json' \
  'https://sg30p0.familysearch.org/service/search/catalog/v3/search?m.queryRequireDefault=on&m.defaultFacets=off&q.surname=Butler&count=20&offset=0'
```

**Search response shape (200 OK):**

```json
{
  "searchHits": [
    {
      "metadataHit": {
        "metadata": {
          "creator": ["Griffin, Ronald G"],
          "identifier": { "value": "https://www.familysearch.org/search/catalog/koha:1837843" },
          "title": [{ "value": "...", "lang": "en-US" }],
          "repositoryCalls": [{ "title": "FamilySearch Library" }]
        },
        "score": 1
      }
    }
  ],
  "facets": [],
  "totalHits": 894,
  "offset": 0
}
```

The `identifier.value` field is a URL ending in a `koha:` or
`olib:`-prefixed titleno. The tool extracts the prefixed id and
uses it directly (no prefix-stripping).

**Item-detail endpoint** (called per unique hit, for flag extraction):

```
GET https://sg30p0.familysearch.org/service/search/catalog/item/<id>
```

The response shape varies by format (Book / Microfilm / Manuscript /
Periodical Issue). The tool reads two pieces from it:
`source.available_online` ("Y" / "N") to set `imageSearch`, and the
first `source.film_note[].digital_film_no` (DGS) which keys the
separate `fullTextSearch` lookup against the fulltext-search
endpoint. See Design Decisions for the full per-flag wiring and Open
Questions for the unresolved `recordSearch` source.

---

## Internal Pipeline

The tool's `placeCatalog()` function:

```
input: { placeId?, keywords?, surname?, dgs?, count?, offset? }
  │
  ├─ 1. Validate inputs:
  │     - at least one of placeId / keywords / surname / dgs is set
  │     - count ∈ [1, 100] when provided
  │     - offset ≥ 0 when provided
  │     (Error messages name the offending field and quote the value.)
  │
  ├─ 2. Apply defaults: count ?? 20; offset ?? 0.
  │
  ├─ 3. Resolve rep IDs:
  │     - if placeId provided:
  │         GET https://api.familysearch.org/platform/places/{placeId}
  │         filter response.places[] to entries with id != placeId
  │           (i.e., drop the Primary stub)
  │         repIds = those filtered entries' id values
  │     - if placeId absent: rep list = []
  │     - if rep list is empty AND placeId was provided:
  │       throw "no catalog rep mapping" error
  │
  ├─ 4. Run catalog searches:
  │     - if rep list non-empty: one GET per rep id, each with
  │       q.place_id=<rep> plus the active axes (q.keywords,
  │       q.surname, q.film_number)
  │     - if rep list empty: one GET with just the active axes
  │     Each GET sets the always-sent params and headers.
  │
  ├─ 5. Map HTTP errors per the Error Handling table.
  │
  ├─ 6. Parse each response. For each searchHit:
  │     - id = strip "https://www.familysearch.org/search/catalog/"
  │       wrapper from metadata.identifier.value, keeping the
  │       koha:/olib: prefix
  │     - title = metadata.title[0].value
  │     - authors = metadata.creator ?? []
  │     - holdings = metadata.repositoryCalls.map(r => r.title)
  │     - score = metadataHit.score
  │     - url = `https://www.familysearch.org/search/catalog/${id}`
  │
  ├─ 7. Union & dedup:
  │     - merge searchHits[] across responses
  │     - dedup by id; when same id appears in multiple responses,
  │       keep the highest score
  │
  ├─ 8. For each unique hit (in parallel, with a small concurrency
  │     cap), synthesize the 3 flags:
  │       - GET sg30p0/service/search/catalog/item/<id>
  │           imageSearch = source.available_online === "Y"
  │           dgs = first source.film_note[].digital_film_no, if any
  │       - if dgs is present:
  │           GET www/service/search/fulltext/search
  │             ?q.groupName=<dgs>&count=1&m.queryRequireDefault=on
  │           fullTextSearch = response.results > 0
  │         else:
  │           fullTextSearch = false
  │       - recordSearch = false  (signal source not yet identified;
  │         see Open Questions)
  │     Any individual upstream call failure sets that one flag to
  │     false; the search itself doesn't fail.
  │
  ├─ 9. Compute totalHits = (sum of upstream totalHits) − (dedup count).
  │
  └─ return { totalHits, returnedCount, offset, hits }
```

Step 3 is fully specified (probed against the live API). Step 8 is
fully specified for `imageSearch` and `fullTextSearch`; the
`recordSearch` source still needs to be identified before shipping.

---

## Files to Create

### 1. `mcp-server/src/types/placeCatalog.ts`

```typescript
export interface PlaceCatalogInput {
  placeId?: string;
  keywords?: string;
  surname?: string;
  dgs?: string;
  count?: number;
  offset?: number;
}

export interface CatalogHit {
  id: string;              // prefix preserved (e.g., "koha:1837843")
  title: string;
  authors: string[];
  holdings: string[];
  recordSearch: boolean;
  fullTextSearch: boolean;
  imageSearch: boolean;
  score: number;
  url: string;
}

export interface PlaceCatalogResult {
  totalHits: number;
  returnedCount: number;
  offset: number;
  hits: CatalogHit[];
}

// Raw upstream search response — internal use only.
export interface CatalogApiResponse {
  searchHits: Array<{
    metadataHit: {
      metadata: {
        creator?: string[];
        identifier?: { value: string };
        title?: Array<{ value: string; lang?: string }>;
        repositoryCalls?: Array<{ title: string }>;
      };
      score: number;
    };
  }>;
  facets?: unknown[];
  totalHits: number;
  offset: number;
}

// Raw upstream item-detail response — internal use only. Only the
// fields the tool actually reads are typed; the rest of source.* is
// ignored. film_note may be a single object or an array depending on
// the format (probe finding: array for multi-roll microfilms, object
// for single-roll items).
export interface CatalogItemDetailResponse {
  source?: {
    available_online?: "Y" | "N";
    film_note?:
      | { digital_film_no?: string }
      | Array<{ digital_film_no?: string }>;
  };
}

// Raw upstream fulltext-search response (subset). The tool only
// reads `results` to decide fullTextSearch true/false.
export interface FulltextSearchResponse {
  results?: number;
}
```

### 2. `mcp-server/src/tools/place-catalog.ts`

The tool function + MCP schema. Pattern mirrors `place-collections.ts`
(authenticated FS service tier with browser UA).

### 3. `mcp-server/dev/try-place-catalog.ts`

One-shot smoke test calling the function directly. Mirrors
`dev/try-place-collections.ts`.

### 4. `mcp-server/tests/tools/place-catalog.test.ts`

Vitest with mocked `fetch`. Cases:

- Happy path with `placeId` → rep lookup + per-rep query + union + dedup + per-hit item-detail
- Happy path with `keywords` only (no placeId) → single search query
- Happy path with `dgs` only → single search with `q.film_number`
- Happy path with `surname` only → single search
- Dedup: same id across two rep-ID responses → kept once, highest score wins
- Per-hit item-detail enrichment: 3 flags populated from a mocked detail response
- Per-hit item-detail failure: all 3 flags = false, search succeeds
- `fullTextSearch = true` when the fulltext endpoint returns `results > 0` for the hit's DGS
- `fullTextSearch = false` when the fulltext endpoint returns `results = 0`, or when the catalog item has no DGS in its item-detail
- Empty result → `totalHits: 0`, `hits: []`
- `id` extraction: keeps `koha:` and `olib:` prefixes
- URL building: `m.queryRequireDefault=on` always present
- URL building: when `count` not provided, request includes `count=20`
- Validation: none of `placeId`/`keywords`/`surname`/`dgs` → required-axis error
- Validation: `count: 0` or `count: 200` → range error
- Validation: `offset: -1` → non-negative error
- 401 → "not logged in" error
- 400 with JSON detail → quote the detail
- `placeId` resolves to zero reps → "no catalog rep mapping" error

---

## Files to Modify

### `mcp-server/src/index.ts`

Three additions in the same pattern as other tools:

1. Import: `import { placeCatalog, placeCatalogSchema, type PlaceCatalogInput } from "./tools/place-catalog.js";`
2. Schema in the `ListToolsRequestSchema` array.
3. `if (request.params.name === "place_catalog") { ... }` block in `CallToolRequestSchema`.

---

## Tool Schema

```typescript
export const placeCatalogSchema = {
  name: "place_catalog",
  description:
    "Search the FamilySearch Library catalog (books, microfilms, " +
    "manuscripts, maps, periodicals). The catalog covers material " +
    "most of which is NOT indexed in record collections — it's the " +
    "right surface for locality research, unindexed-film discovery, " +
    "and 'what genealogically useful material exists?' questions.\n" +
    "\n" +
    "At least one of `placeId`, `keywords`, `surname`, or `dgs` must be " +
    "provided. Multiple can be combined. `placeId` (from " +
    "place_search) is resolved internally to one or more catalog " +
    "rep IDs; results are unioned and deduped.\n" +
    "\n" +
    "Each returned hit carries three boolean flags — `recordSearch`, " +
    "`fullTextSearch`, `imageSearch` — telling the LLM which " +
    "downstream tool (record_search, fulltext_search, image_read) " +
    "is available for that catalog item.",
  inputSchema: {
    type: "object" as const,
    properties: {
      placeId: {
        type: "string",
        description:
          "Numeric FamilySearch place ID (from place_search). " +
          "Resolved internally to one or more catalog rep IDs. " +
          "At least one of `placeId`, `keywords`, `surname`, or `dgs` must be supplied.",
      },
      keywords: {
        type: "string",
        description:
          "Free-text keyword search across all indexed fields. " +
          "At least one of `placeId`, `keywords`, `surname`, or `dgs` must be supplied.",
      },
      surname: {
        type: "string",
        description:
          "Surname mentioned in the title/content. Not the author's " +
          "surname (q.author_surname_text returns 0 hits upstream). " +
          "At least one of `placeId`, `keywords`, `surname`, or `dgs` must be supplied.",
      },
      dgs: {
        type: "string",
        description:
          "Digital Folder / microfilm number. Maps to q.film_number. " +
          "At least one of `placeId`, `keywords`, `surname`, or `dgs` must be supplied.",
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Page size per rep-ID query. Default 20.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Pagination offset. Default 0.",
      },
    },
  },
};
```

---

## Patterns to Follow

- **Auth:** call `getValidToken()` from `src/auth/refresh.ts`. Never read tokens directly.
- **Headers:** use `BROWSER_USER_AGENT` from `src/constants.ts`. Always sent — this is what prevents Imperva 403s.
- **URL building:** use `URL` + `searchParams.set(...)`.
- **HTTP errors:** map each upstream status to an LLM-instruction error per the Error Handling table.
- **Place IDs:** the upstream parameter is `q.place_id`, but it accepts **rep IDs** as values, not Places-API Primary IDs. (Confirmed by probe 2026-05-28: `q.place_id=351` — Alabama's rep — returns Alabama catalog items; `q.place_id=33` — Alabama's Primary — returns 21,722 hits because the bare numeric collides across place-ID systems.) Always resolve the caller's `placeId` to rep IDs via the Places API first, then pass each rep to `q.place_id`. Never expose either form of numeric ID through the tool's input surface.
- **Enrichment concurrency:** cap at 5 hits processed concurrently. Each hit may make up to 2 HTTP calls (item-detail + fulltext-search-by-DGS), so worst-case 10 in-flight requests against the upstream.

---

## Out of Scope for V1

- **Optional narrowing filters cut for V1 to keep the tool narrow:**
  `title`, `author`, `subject`, `topic`, `language`, `format`, `availability`.
  Add back when a skill specifically needs one.
- **`year` (and year ranges)** — investigated and dropped, not
  ignored. Single-year `q.year` works upstream, but every range
  form (`q.year0`/`q.year1`, `q.inclusive_dates` combined with
  place) returns 0 hits. See the Evidence Trail for the test
  results.

---

## Evidence Trail (live-API findings)

### Year-range re-probe (2026-05-27)

Run to verify whether the upstream API's year-range parameters
actually return non-empty results:

| Query | totalHits |
|---|---|
| `q.year=1880` (no place) | 167,306 ✓ |
| `q.year=1880` + Alabama exact | 18 ✓ |
| `q.year0=1850&q.year1=1900` (no place) | 0 ✗ |
| `q.year0=1850` alone | 0 ✗ |
| `q.year1=1900` alone | 0 ✗ |
| `q.inclusive_dates=1850/1900` (no place) | 149 ✓ |
| `q.inclusive_dates=1850/1900` + Alabama | 0 ✗ |
| Range form + Alabama | 0 ✗ |

Decision: do not expose any year input in V1. (Single-year `q.year`
works, but all optional narrowers are out of scope for V1.)

### Place-ID parameter name (2026-05-28)

Run to settle which upstream parameter accepts a rep ID. Alabama's
Primary is `33`; Alabama's rep is `351`.

| Query | Result |
|---|---|
| Baseline `q.place="Alabama, United States"` + `q.place.exact=on` | 894 |
| `q.placeRepId=351` | HTTP 400 — `"Unable to map supplied value=place_rep_id to query term"` |
| `q.place_id=351` (rep value) | 4,650 ✓ |
| `q.placeId=351` (rep value, camelCase) | 4,650 (alias) |
| `q.place_id=33` (Primary value) | 21,722 — cross-system collision; do not use |
| `f.place_id=351` (filter form) | 0 |

Decision: the upstream parameter is `q.place_id`, and it must
receive a **rep ID** value. Passing the Primary ID (or guessing
parameter name as `q.placeRepId`) breaks the search. The tool
resolves `placeId` → rep IDs via the Places API and then queries
`q.place_id=<rep>` per rep.

---

## Open Questions (deferred to implementation)

The 3-flag design itself (`recordSearch`, `fullTextSearch`,
`imageSearch`, all populated by `place_catalog` before returning) was
confirmed final on 2026-05-27. The open question below is scoped to
the field-mapping implementation detail, not the overall approach.

- **Source for the `recordSearch` flag.** `imageSearch` comes from
  the catalog item-detail response and `fullTextSearch` comes from
  the existing fulltext-search endpoint keyed by DGS (see Design
  Decisions), but the `recordSearch` signal (does this catalog item
  have indexed record collections attached?) was not surfaced by
  probing — the item-detail response carries no indexed-record
  field, and the existing `record_search` tool takes collection IDs
  rather than catalog ids or DGS. The catalog team needs to confirm
  which endpoint or item-detail variant the FS web UI uses for this
  signal. Until confirmed, `recordSearch` will default to `false`.
