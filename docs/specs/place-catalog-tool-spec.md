# `place_catalog` MCP Tool — Implementation Spec

## Overview

A new MCP tool that searches the **FamilySearch Library catalog**
(books, microfilms, manuscripts, maps, periodicals) for items
covering a specific place. Wraps the internal Catalog Search API
documented at the [Catalog Search API wiki page](https://icseng.atlassian.net/wiki/spaces/Product/pages/814383280/Catalog+Search+API).

The catalog is a different search surface than indexed records:

| Tool | Endpoint | What it covers |
|------|----------|---------------|
| `record_search` | `/service/search/hr/v2/personas` | Indexed persons in record collections |
| `place_collections` | `/service/search/hr/v2/collections` | Indexed record collections with counts |
| `place_external_links` | `/service/search/hr/external/collections/search` | External (non-FS) collection links |
| **`place_catalog` (this tool)** | `/service/search/catalog/v3/search` | FS Library catalog — most items NOT indexed |

Skills currently reference the catalog only in narrative form (e.g.
locality-guide pointing users at the catalog web UI for unindexed
films and manuscripts). With this tool the LLM can run those lookups
itself and pass concrete titles, call numbers, and DGS roll numbers
back to the user.

Requires authentication (OAuth tokens obtained via the `login` tool).

---

## Design decisions

### Why `place_catalog` (place-required), not generic `catalog`

The design brief named the tool `place_catalog`. The `place_*`
naming convention in this codebase (`place_search`,
`place_collections`, `place_external_links`, `place_population`,
`place_distance`) implies place is **required input**. This V1
follows that convention:

- The primary skill use case is *"what's in the catalog for this
  place?"* — locality-guide, historical-context, and
  search-records all need this exact lookup.
- Other catalog axes (surname, year, format, availability, topic)
  are exposed as **optional narrowing filters** on top of a
  place-anchored query — they make place results more useful, not
  replace them.
- Non-place catalog queries (e.g., "find books by author Smith
  anywhere") are out of scope for V1 and can land in a follow-up
  generic `catalog_search` tool if a skill requires them. The
  evidence trail (probes 1–9, see `docs/plan/catalog-tool.md`)
  already covers most of the API surface — adding a sibling tool
  later is cheap.

### Single list-mode tool (no detail mode in V1)

The plan considered an item-by-id "detail mode" within the same
tool. V1 ships the **list/search mode only**. Reasons:

- Detail mode doesn't fit a place-required signature — the caller
  has an item id, not a place.
- The catalog's detail endpoint returns a rich `source.*` shape that
  varies across formats (Book / Microfilm / Manuscript / Periodical
  Issue / etc., per probe 6+9). The shape stabilization belongs in
  its own design pass, not bundled into the V1 list tool.
- The list response already carries enough per-hit metadata
  (`title`, `authors`, `holdings`, `topicCodes`, `surnames`, `score`,
  `url`) for the LLM to triage and surface results to the user. The
  user can then click through to the FS UI for full detail.

A follow-up `place_catalog_item` (or whichever name fits) tool can
add detail mode once we have a concrete skill needing it.

### `groupBy` deferred to V2

The Catalog API supports a `groupBy=author|subject|placeSubject`
aggregation that returns "synthetic" hits — facet labels with
counts instead of catalog items. The plan (probe 5) found this
shape promising for *"what subjects exist for this place?"* style
queries but with limitations (no followable item ids, different
output shape). V1 omits `groupBy`; V2 can add it as a separate
mode (or a sibling tool) once a skill needs that query pattern.

---

## Input

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `place` | string | **yes** | — | Place name. Sent as `q.place` + `q.place.exact=on`. Use the full FamilySearch place string (e.g., `"Alabama, United States"`, `"Schuylkill, Pennsylvania, United States"`). |
| `query` | string | no | — | Free-text keyword search across all indexed fields. Maps to `q.keywords`. |
| `surname` | string | no | — | Surname mentioned in the title/content. Maps to `q.surname`. **Not** the author's surname — `q.author_surname_text` returned 0 hits in every probe (probe 9). |
| `title` | string | no | — | Title-text match (with stemming). Maps to `q.title`. |
| `author` | string | no | — | Author-text match. Maps to `q.author`. |
| `subject` | string | no | — | LC subject heading match. Maps to `q.subject`. |
| `year` | integer | no | — | Single year of coverage. Maps to `q.year`. Range form (`q.year0` / `q.year1`) returned 0 hits and is not exposed. |
| `format` | enum | no | — | Item format filter. One of the 10 values enumerated below. Maps to `q.format_facet`. |
| `availability` | enum | no | — | Holding/access filter. One of `"Online"`, `"FamilySearch Library"`, `"Granite Mountain Record Vault"`, etc. Maps to `q.availability`. |
| `topic` | string | no | — | Top-level genealogy category. Maps to `q.topic0`. Values are facet-emitted strings — see Topic values below. Deeper hierarchical drill-down (`q.topic1`–`q.topic5`) is NOT exposed; probe 9 confirmed it doesn't work as documented. |
| `language` | string | no | — | Top-level language filter (e.g., `"English"`, `"German"`, `"French"`, `"Spanish"`). Maps to `q.language0`. Useful for narrowing place-anchored searches by language of the material (e.g., German-language books about Pennsylvania). The hierarchical `q.language1` sub-filter is not exposed in V1. Probe-verification deferred to the implementation PR; values are open strings (no client-side enum). |
| `count` | integer | no | `20` | Page size. Upstream default is 20; max not yet probed at scale. |
| `offset` | integer | no | `0` | Pagination offset. |

### Format enum (10 values, verified by probe 9)

`format` accepts exactly these strings:

- `"Book"`
- `"Microfilm 35mm"`
- `"Microfiche"`
- `"Microfilm 16mm"`
- `"Manuscript"`
- `"CD-Rom"`
- `"Map"`
- `"FHC Copy to Digitize"`
- `"Electronic Resource"`
- `"Periodical Issue"`

Common mistakes (`"Microfilm"` alone, `"Periodical"`) return 0 hits
silently — the enum prevents that footgun.

### Topic values (open enum, facet-emitted strings)

`topic` accepts the strings emitted by the `c.topic0=on` facet for
the catalog. Verified examples: `"Military"`, `"Birth, Marriage and
Death"`, `"Census, Taxation, and Voter Lists"`, `"Repositories"`.
The complete list will be enumerated and documented during the
implementation PR's evidence-trail update; the tool does **not**
validate against a closed enum because new categories may be added
upstream.

### Why `place` is required

Beyond honoring the tool's name, requiring `place` aligns with the
recommended query template the probes converged on (see
`docs/plan/catalog-tool.md` §"Recommended query template"). A
place-anchored query consistently returned focused, useful result
sets across probe runs; non-anchored queries either return the full
catalog (when `m.queryRequireDefault` is off — a known footgun) or
fragile, hard-to-reason-about hit counts.

### Defaults this tool *always* sends

- `m.queryRequireDefault=on` — **mandatory** per probe 1. Without
  it, every `q.*` parameter is advisory ranking only and the API
  returns the entire catalog (2,037,676 hits at probe time). The
  tool hardcodes this; it is not a user-facing parameter.
- `m.defaultFacets=off` — V1 does not surface facets. Skip the
  payload they add. (V2 can add an `includeFacets: true` flag if a
  skill needs them.)
- `q.place.exact=on` — required for `q.place` to behave as a place
  filter rather than fuzzy substring (per probe 4).

---

## Output

A flattened, LLM-reasoning-friendly shape. The verbose
`searchHits[].metadataHit.metadata.*` nesting is parsed once and
reduced to a `CatalogHit[]` array.

| Field | Type | Always present? | Description |
|-------|------|-----------------|-------------|
| `place` | string | yes | The `place` value passed in, echoed back. |
| `totalHits` | integer | yes | Upstream `totalHits` — total catalog items matching the query (not limited by `count`). |
| `returnedCount` | integer | yes | Number of items in `hits[]`. |
| `offset` | integer | yes | Pagination offset of the first hit. |
| `hits` | array of `CatalogHit` | yes | The catalog items. May be empty (`[]`). |

### `CatalogHit` shape

| Field | Type | Always present? | Description |
|-------|------|-----------------|-------------|
| `id` | string | yes | Bare titleno (e.g., `"1837843"`). Stripped of `koha:` / `olib:` prefixes. The user-facing URL field uses this. |
| `title` | string | yes | `metadata.title[0].value`. |
| `authors` | array of strings | yes (may be empty) | `metadata.creator[]` — often multiple creators. |
| `holdings` | array of strings | yes (length 1–21) | `metadata.repositoryCalls[].title` — every physical/digital holding line. Includes signals like `"Online"`, `"Online at Affiliate Library"`, `"FamilySearch Library"`, `"Granite Mountain Record Vault"`. |
| `topicCodes` | array of strings | yes (may be empty) | Numeric topic IDs extracted from `properties[type="org.familysearch.www.catalog.topic"]`. Sparse — present on ~65% of hits (probe 8). Useful as tagging surface; **not** human-readable. |
| `surnames` | array of strings | yes (may be empty) | Surnames extracted from `properties[type="org.familysearch.www.catalog.surname"]`. Sparse. |
| `score` | number | yes | Relevance ranking score from the upstream `metadataHit.score`. |
| `url` | string | yes | `https://www.familysearch.org/search/catalog/<id>` — the user-facing detail URL. |

### Example output

```json
{
  "place": "Alabama, United States",
  "totalHits": 894,
  "returnedCount": 20,
  "offset": 0,
  "hits": [
    {
      "id": "1837843",
      "title": "Alabama Civil War records",
      "authors": ["Griffin, Ronald G"],
      "holdings": ["FamilySearch Library"],
      "topicCodes": [],
      "surnames": [],
      "score": 1.0,
      "url": "https://www.familysearch.org/search/catalog/1837843"
    },
    {
      "id": "2103552",
      "title": "Butler-Butter-Buttler family records, 1850 census, Alabama",
      "authors": ["Butler, Edna May"],
      "holdings": ["FamilySearch Library", "Online", "Online at Affiliate Library"],
      "topicCodes": ["123363", "124078"],
      "surnames": ["Butler", "Butter", "Buttler"],
      "score": 0.92,
      "url": "https://www.familysearch.org/search/catalog/2103552"
    }
  ]
}
```

### Empty-result example

```json
{
  "place": "Some Specific Town, County, State",
  "totalHits": 0,
  "returnedCount": 0,
  "offset": 0,
  "hits": []
}
```

Not an error — surface as-is. A place with no catalog items is a
legitimate research finding.

---

## Error Handling

All errors are LLM-instruction errors (the message tells Claude
what to do next), thrown as `Error` objects.

| Condition | Throw message |
|-----------|--------------|
| No FamilySearch session (no tokens / refresh failed) | `"User is not logged in to FamilySearch. Call the login tool to authenticate."` (re-raised from `getValidToken()`) |
| API returns 401 | `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 403 with Imperva body (errorCode 15) | `"FamilySearch catalog endpoint blocked by WAF. The User-Agent header was rejected — check that the MCP server is running an unmodified build."` |
| API returns 400 with JSON body | `"FamilySearch catalog endpoint rejected the request: ${detail-from-body}."` |
| API returns other 4xx/5xx | `"FamilySearch catalog endpoint error: ${status} ${statusText}."` |
| `place` missing or empty | `"place_catalog: place is required (e.g., 'Alabama, United States'). To search the catalog without a place filter, use the future catalog_search tool."` |
| `format` not in the allowed enum | `"place_catalog: format must be one of: Book, Microfilm 35mm, Microfiche, Microfilm 16mm, Manuscript, CD-Rom, Map, FHC Copy to Digitize, Electronic Resource, Periodical Issue. Got: ${format}. (Common mistakes 'Microfilm' or 'Periodical' return 0 hits silently — use the exact string.)"` |
| `year` is not a positive integer | `"place_catalog: year must be a positive integer. Got: ${year}"` |
| `count` is out of range (1–100, say) | `"place_catalog: count must be between 1 and 100. Got: ${count}"` |
| `offset` is negative | `"place_catalog: offset must be non-negative. Got: ${offset}"` |
| `fetch()` itself fails (network) | `"Could not reach FamilySearch catalog endpoint: ${error.message}."` |

---

## FamilySearch Catalog Search API Reference

**Endpoint:**
```
GET https://www.familysearch.org/service/search/catalog/v3/search
```

Same `www.familysearch.org` host that the other authenticated FS
service-tier tools use (`record_search`, `place_collections`,
`place_external_links`).

**Required headers:**
```
Authorization: Bearer <access token from getValidToken()>
Accept: application/json
User-Agent: <BROWSER_USER_AGENT from src/constants.ts>
```

The `User-Agent` must be the browser-style Mozilla string —
WAF-avoidance pattern (probe 1).

**Query parameters this tool always sends:**

| Param | Value | Why |
|---|---|---|
| `m.queryRequireDefault` | `on` | **Mandatory** — without it the API returns the full catalog and only re-ranks. |
| `m.defaultFacets` | `off` | V1 doesn't surface facets. |
| `q.place` | `<place>` | The required place filter. |
| `q.place.exact` | `on` | Place-as-exact-filter, not fuzzy substring. |
| `count` | `<count>` (default 20) | Page size. |
| `offset` | `<offset>` (default 0) | Pagination. |

**Optional query parameters (sent only when caller provides them):**

| Caller field | Param sent | Notes |
|---|---|---|
| `query` | `q.keywords` | Free-text cross-field search. |
| `surname` | `q.surname` | Surname-in-title (not author surname). |
| `title` | `q.title` | Title text with stemming. |
| `author` | `q.author` | Author text. |
| `subject` | `q.subject` | LC subject heading. |
| `year` | `q.year` | Single year only. |
| `format` | `q.format_facet` | Item format (enum-validated client-side). |
| `availability` | `q.availability` | Holding/access filter. |
| `topic` | `q.topic0` | Top-level genealogy category. |
| `language` | `q.language0` | Top-level language filter. |

**Reference call (place-only search for Alabama):**

```bash
curl -H 'Authorization: Bearer p0-XXXX' \
  -H 'User-Agent: Mozilla/5.0 ...' \
  -H 'Accept: application/json' \
  'https://www.familysearch.org/service/search/catalog/v3/search?m.queryRequireDefault=on&m.defaultFacets=off&q.place=Alabama%2C%20United%20States&q.place.exact=on&count=20&offset=0'
```

**Reference call with narrowing filters (Alabama, Online, Military topic):**

```bash
curl -H 'Authorization: Bearer p0-XXXX' \
  -H 'User-Agent: Mozilla/5.0 ...' \
  -H 'Accept: application/json' \
  'https://www.familysearch.org/service/search/catalog/v3/search?m.queryRequireDefault=on&m.defaultFacets=off&q.place=Alabama%2C%20United%20States&q.place.exact=on&q.availability=Online&q.topic0=Military&count=20&offset=0'
```

**Response shape (200 OK):**

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
      },
      "properties": [
        { "type": "org.familysearch.www.catalog.topic", "value": "123363" },
        { "type": "org.familysearch.www.catalog.surname", "value": "Butler" }
      ]
    }
  ],
  "facets": [],
  "totalHits": 894,
  "offset": 0
}
```

Notes:

- `coverage[].temporal` and `format` are **always absent in the list
  response** — detail-only (probe 6). The tool surfaces neither in
  V1; callers who need them can follow up via the FS web UI URL.
- The `identifier.value` field is a URL with a `koha:` or `olib:`
  prefix on the titleno. The tool strips the prefix and the URL
  wrapper before exposing `id` and `url`.
- `properties[]` is sparse — present on ~65% of hits (probe 8). The
  tool flattens it into per-hit `topicCodes[]` and `surnames[]`
  arrays.

---

## Internal Pipeline

The tool's `placeCatalog()` function:

```
input: { place, query?, surname?, title?, author?, subject?, year?,
         format?, availability?, topic?, count?, offset? }
  │
  ├─ 1. Validate inputs:
  │     - place is a non-empty string
  │     - format ∈ {the 10-value enum} when provided
  │     - year > 0 when provided
  │     - count ∈ [1, 100] when provided
  │     - offset ≥ 0 when provided
  │     (Error messages name the offending field and quote the value.)
  │
  ├─ 2. Apply defaults:
  │     - count ?? 20
  │     - offset ?? 0
  │
  ├─ 3. Build URL with fixed params + caller-provided filters:
  │       const url = new URL(ENDPOINT);
  │       url.searchParams.set("m.queryRequireDefault", "on");
  │       url.searchParams.set("m.defaultFacets", "off");
  │       url.searchParams.set("q.place", place);
  │       url.searchParams.set("q.place.exact", "on");
  │       url.searchParams.set("count", String(count));
  │       url.searchParams.set("offset", String(offset));
  │       // Optional caller fields, only when present:
  │       if (query) url.searchParams.set("q.keywords", query);
  │       if (surname) url.searchParams.set("q.surname", surname);
  │       if (title) url.searchParams.set("q.title", title);
  │       if (author) url.searchParams.set("q.author", author);
  │       if (subject) url.searchParams.set("q.subject", subject);
  │       if (year) url.searchParams.set("q.year", String(year));
  │       if (format) url.searchParams.set("q.format_facet", format);
  │       if (availability) url.searchParams.set("q.availability", availability);
  │       if (topic) url.searchParams.set("q.topic0", topic);
  │       if (language) url.searchParams.set("q.language0", language);
  │
  ├─ 4. GET with auth + browser UA + Accept: application/json
  │
  ├─ 5. Map upstream HTTP errors per the Error Handling table.
  │
  ├─ 6. Parse body. For each searchHit:
  │     - id = strip "koha:" or "olib:" prefix and URL wrapper from
  │       metadata.identifier.value
  │     - title = metadata.title[0].value
  │     - authors = metadata.creator ?? []
  │     - holdings = metadata.repositoryCalls.map(r => r.title)
  │     - topicCodes = properties
  │         .filter(p => p.type === "org.familysearch.www.catalog.topic")
  │         .map(p => p.value)
  │     - surnames = properties
  │         .filter(p => p.type === "org.familysearch.www.catalog.surname")
  │         .map(p => p.value)
  │     - score = metadataHit.score
  │     - url = `https://www.familysearch.org/search/catalog/${id}`
  │
  └─ return: {
        place,
        totalHits: body.totalHits,
        returnedCount: hits.length,
        offset: body.offset,
        hits,
      }
```

---

## Files to Create

### 1. `mcp-server/src/types/placeCatalog.ts`

```typescript
export type CatalogFormat =
  | "Book"
  | "Microfilm 35mm"
  | "Microfiche"
  | "Microfilm 16mm"
  | "Manuscript"
  | "CD-Rom"
  | "Map"
  | "FHC Copy to Digitize"
  | "Electronic Resource"
  | "Periodical Issue";

export interface PlaceCatalogInput {
  place: string;
  query?: string;
  surname?: string;
  title?: string;
  author?: string;
  subject?: string;
  year?: number;
  format?: CatalogFormat;
  availability?: string;
  topic?: string;
  language?: string;
  count?: number;
  offset?: number;
}

export interface CatalogHit {
  id: string;
  title: string;
  authors: string[];
  holdings: string[];
  topicCodes: string[];
  surnames: string[];
  score: number;
  url: string;
}

export interface PlaceCatalogResult {
  place: string;
  totalHits: number;
  returnedCount: number;
  offset: number;
  hits: CatalogHit[];
}

// Raw upstream response shape — internal use only.
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
    properties?: Array<{ type: string; value: string }>;
  }>;
  facets?: unknown[];
  totalHits: number;
  offset: number;
}
```

### 2. `mcp-server/src/tools/place-catalog.ts`

The tool function + MCP schema. Pattern mirrors `place-collections.ts`
(authenticated FS service tier with browser UA) and `record-search.ts`
(same `www.familysearch.org` host).

### 3. `mcp-server/dev/try-place-catalog.ts`

One-shot smoke test calling the function directly with the
`"Alabama, United States"` reference query from the probes. Mirrors
`dev/try-place-collections.ts`.

### 4. `mcp-server/tests/tools/place-catalog.test.ts`

Vitest with mocked `fetch`. Cases to cover:

- Happy path → flattened hits with title/authors/holdings/score/url
- Happy path with `properties[]` → topicCodes and surnames populated
- Happy path without `properties[]` → topicCodes and surnames are empty arrays
- Empty result → `totalHits: 0`, `hits: []`
- All optional filters at once → all `q.*` params present in the URL
- 401 → re-login error
- 403 with Imperva body → WAF error
- 400 with JSON detail → quote the detail
- Validation: missing `place` → required-field error
- Validation: invalid `format` → enum error listing all 10 values
- Validation: `year: -1` → positive-integer error
- Validation: `count: 0` or `count: 200` → range error
- Validation: `offset: -1` → non-negative error
- `id` extraction: strips both `koha:` and `olib:` prefixes correctly
- URL building: `m.queryRequireDefault=on` and `q.place.exact=on` are always present
- URL building: `m.defaultFacets=off` is always present
- URL building: place name with spaces gets URL-encoded correctly

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
    "manuscripts, maps, periodicals) for items covering a place. The " +
    "catalog covers material most of which is NOT indexed in the " +
    "record collections — it's the right surface for locality " +
    "research, unindexed-film discovery, and 'what genealogically " +
    "useful material exists for this place?' questions.\n" +
    "\n" +
    "Required: `place` (full place string, e.g., 'Alabama, United " +
    "States'). Optional narrowing filters: `query` (free-text), " +
    "`surname` (name in title), `title`, `author`, `subject`, `year` " +
    "(single year), `format` (enum: Book, Microfilm 35mm, etc.), " +
    "`availability` (e.g., 'Online' for items viewable without " +
    "visiting a library), `topic` (top-level category like 'Military' " +
    "or 'Birth, Marriage and Death'), `language` (e.g., 'English', " +
    "'German').\n" +
    "\n" +
    "Returns up to `count` hits (default 20) with title, authors, " +
    "holdings (including online-availability signals), score, and a " +
    "user-facing URL. Catalog items can be browsed via the URL — most " +
    "are not full-text searchable.",
  inputSchema: {
    type: "object" as const,
    properties: {
      place: {
        type: "string",
        description:
          "Full place name (e.g., 'Alabama, United States'). Required.",
      },
      query: {
        type: "string",
        description: "Free-text keyword search across all indexed fields.",
      },
      surname: {
        type: "string",
        description:
          "Surname mentioned in the title/content. Not the author's " +
          "surname (the API's author_surname_text field is broken).",
      },
      title: {
        type: "string",
        description: "Title text with stemming.",
      },
      author: {
        type: "string",
        description: "Author text.",
      },
      subject: {
        type: "string",
        description: "Library of Congress subject heading.",
      },
      year: {
        type: "integer",
        minimum: 1,
        description:
          "Single year of coverage (e.g., 1880). Year ranges are not " +
          "supported by the upstream API.",
      },
      format: {
        type: "string",
        enum: [
          "Book",
          "Microfilm 35mm",
          "Microfiche",
          "Microfilm 16mm",
          "Manuscript",
          "CD-Rom",
          "Map",
          "FHC Copy to Digitize",
          "Electronic Resource",
          "Periodical Issue",
        ],
        description:
          "Filter by item format. Exact strings only — 'Microfilm' " +
          "alone returns 0 hits silently.",
      },
      availability: {
        type: "string",
        description:
          "Filter by holding/access tier (e.g., 'Online', " +
          "'FamilySearch Library', 'Granite Mountain Record Vault'). " +
          "'Online' is the top skill-facing filter — items the user " +
          "can view immediately without visiting a library.",
      },
      topic: {
        type: "string",
        description:
          "Top-level genealogy category (e.g., 'Military', 'Birth, " +
          "Marriage and Death', 'Census, Taxation, and Voter Lists'). " +
          "Hierarchical drill-down (q.topic1+) is not exposed because " +
          "the upstream API behavior doesn't match the docs.",
      },
      language: {
        type: "string",
        description:
          "Top-level language filter (e.g., 'English', 'German', " +
          "'French', 'Spanish'). Useful for narrowing place-anchored " +
          "searches by language of the material — e.g., German-" +
          "language books about Pennsylvania.",
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Page size. Default 20.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Pagination offset. Default 0.",
      },
    },
    required: ["place"],
  },
};
```

---

## Patterns to Follow

- **Auth:** call `getValidToken()` from `src/auth/refresh.ts`. Never read tokens directly.
- **Headers:** use `BROWSER_USER_AGENT` from `src/constants.ts`. Do not hardcode the Mozilla string.
- **HTTP errors:** map each upstream status to an LLM-instruction error message per the Error Handling table. Never surface raw HTTP errors to the LLM.
- **URL building:** use `URL` + `searchParams.set(...)` — `URL` handles place-name encoding (commas, spaces) for free.
- **Place ID systems are NOT interchangeable.** Do not accept place IDs as input. The Catalog API's `q.place_id` numbering disagrees with both the Places API and the Collections API — Alabama in catalog is `33`; in Places it's `351`; in Collections `33` means Italy (probe 7). `place_collections` already worked around the Collections/Places mismatch by accepting place names; this tool does the same.

---

## API surface coverage (brief → spec)

Every parameter from the Catalog API wiki page, mapped to its V1
disposition. Read alongside the Out of Scope section below for the
detailed reasoning on deferred items.

### Global terms

| Brief param | V1 disposition |
|---|---|
| `m.defaultFacets` | Hardcoded `off` (facets deferred to V2) |
| `m.queryRequireDefault` | Hardcoded `on` (mandatory per probe 1) |

### Query terms exposed as V1 inputs

| Brief param | V1 input | Notes |
|---|---|---|
| `q.place` | `place` (required) | + hardcoded `q.place.exact=on` |
| `q.keywords` | `query` | Cross-field free-text |
| `q.surname` | `surname` | Surname-in-title, not author surname |
| `q.title` (also covers `q.subtitle`, `q.alt_title` per brief) | `title` | |
| `q.author` | `author` | |
| `q.subject` | `subject` | LC subject heading |
| `q.year` | `year` | Single year only |
| `q.format_facet` | `format` | Enum of 10 values |
| `q.availability` | `availability` | |
| `q.topic0` | `topic` | |
| `q.language0` | `language` | |

### Query terms deferred or excluded

| Brief param | Disposition | Why |
|---|---|---|
| `q.year0` / `q.year1` (range) | Excluded | Probe 7: returns 0 hits |
| `q.topic1`–`q.topic5` | Excluded | Probe 9: doesn't drill down |
| `q.language1` | Deferred to V2 | Hierarchical drill-down not yet probed |
| `q.place_ancestors` | Excluded | Probe 7: returns 0 hits |
| `q.place_id` | Excluded | Probe 7: incompatible place-ID systems |
| `q.place0`–`q.place5` (experimental) | Excluded | Brief marks experimental; `q.place` already works |
| `q.author_surname_text` | Excluded | Probes 4 + 9: returns 0 hits |
| `q.author_givenname_text` | Excluded | Same family as `q.author_surname_text` — likely also broken; not probed |
| `q.oclc_id`, `q.isn`, `q.film_number`, `q.call_number` | Deferred to follow-up tool | Exact-id lookups don't fit place-required signature; better as a sibling tool (e.g., `catalog_by_id`) if a skill needs them. `q.film_number` (DGS lookup) verified working by probe 7. |
| `q.inclusive_dates` | Excluded | Probe 7: works standalone but returns 0 when combined with `q.place` |
| `q.subtitle`, `q.title_sort`, `q.alt_title` | Excluded | Implicit via `q.title` per brief, or internal sort-only |
| `q.author_facet`, `q.author_id`, `q.series_id`, `q.subject_facet`, `q.subject_id`, `q.subject_class`, `q.availability_call_number`, `q.film_availability` | Excluded | Internal / technical fields, not user-facing |

### Term modifiers

| Brief feature | V1 disposition |
|---|---|
| `q.[term].require` | Hardcoded globally via `m.queryRequireDefault=on`; individual modifiers not exposed |

### Filter terms (`f.*`)

| Brief feature | V1 disposition |
|---|---|
| `f.*` (strict-exact filter variants) | Excluded | With `m.queryRequireDefault=on` hardcoded, `q.*` and `f.*` behave identically for most fields (probe 7). Adding `f.*` as a parallel surface would double the input vocabulary without adding capability for V1's use cases. |

### Facet/Count terms (`c.*`)

| Brief feature | V1 disposition |
|---|---|
| `c.year0/1`, `c.language0/1`, `c.topic0-5`, `c.place0-5`, `c.availability`, `c.format_facet`, `c.subject_facet`, `c.author_facet` | Deferred to V2 — facets are large response payloads. Add an `includeFacets: true` flag in V2 when a skill needs them. |

### GroupBy terms

| Brief feature | V1 disposition |
|---|---|
| `groupBy=author/subject/placeSubject/placeSubjectFromPlaceId` | Deferred to V2 (or a sibling tool) — returns aggregated "synthetic hits" that need their own output shape; deserves a dedicated design pass. |

---

## Out of Scope for V1

- **Detail mode (`id` lookup).** The Catalog item-detail endpoint
  (`/service/search/catalog/item/{titleno}`) returns a rich
  `source.*` shape that varies by format (Book / Microfilm /
  Manuscript / Periodical Issue per probes 2, 6, 9). Stabilizing
  that shape belongs in its own design pass — a future
  `place_catalog_item` (or similar) tool can add it.
- **`groupBy` aggregation mode.** Returns synthetic hits (author /
  subject / placeSubject facets with counts) rather than catalog
  items. Promising for *"what subjects exist for this place?"* (probe
  5) but the output shape is different enough to deserve its own
  design pass.
- **Faceted browse (`m.defaultFacets=on` / individual `c.*` params).**
  Facets are extremely rich (per-Family-History-Center availability
  buckets, hierarchical year/topic/language counts) but each one
  doubles the response size. Add an `includeFacets: true` flag in
  V2 once a skill needs them.
- **Hierarchical topic drill-down (`q.topic1`–`q.topic5`).**
  Documented in the wiki but probe 9 confirmed it doesn't behave as
  drill-down — `q.topic1` after `f.topic0=Military` returns
  co-occurring top-level categories, not Military sub-topics. Not
  exposed until the team understands the actual semantics.
- **`q.place_ancestors`.** Returned 0 hits for every tested form in
  probe 7. Not usable as a hierarchical place filter.
- **Year ranges (`q.year0` / `q.year1`).** Returned 0 hits in probe
  7. The upstream API's `q.inclusive_dates` works standalone but
  returns 0 hits when combined with `q.place` (exact). Single-year
  `q.year` is the only reliable date filter in V1.
- **Author surname filter.** `q.author_surname_text` returned 0 hits
  for every tested surname in probes 4 and 9 (Griffin, Smith, Jones,
  Williams). Not exposed — the `surname` field accepts the working
  `q.surname` instead (which matches surname-in-title, not author
  surname).
- **`q.place_id` numeric input.** Three incompatible place-ID
  systems exist (Places `351`, Collections `33`, Catalog `33` =
  Italy) — accepting numeric ids would invite cross-tool confusion.
  Place name is the safe contract.
- **`inclusiveDates`, `format`, and other detail-only fields in the
  list response.** They are absent from the list endpoint (probe
  6). Surfacing them per-hit requires the deferred detail mode.
- **Pagination at scale.** Probes used default page size (20).
  Behavior with `count=100` / `offset=1000` not yet probed; V1 caps
  `count` at 100 as a conservative guess.
- **Companion plan doc** (`docs/plan/place-catalog-tool.md` — note
  that the existing `docs/plan/catalog-tool.md` evidence trail
  remains the source of truth for probe findings, and will be
  preserved or moved alongside the spec at implementation time) and
  **testing guide** (`docs/testing-guides/place-catalog-tool-testing-guide.md`).
  Per CLAUDE.md convention these ship with the implementation PR.

---

## Evidence Trail (live-API findings)

Unlike most new tool specs, the evidence trail for `place_catalog`
is **already populated** by probes 1–9, captured in
`docs/plan/catalog-tool.md`. The spec relies on those findings
directly:

| Behavior | Evidence | Source |
|----------|----------|--------|
| Endpoint works with Bearer + browser UA | 200 OK on every probe | Probe 1 |
| Anonymous requests return 401 | Confirmed | Probe 1 |
| `m.queryRequireDefault=on` is mandatory | Without it: 2,037,676 hits returned regardless of query | Probe 1 |
| `q.place` requires `q.place.exact=on` for exact matching | Confirmed | Probe 4 |
| Place name `"Alabama, United States"` returns 894 hits | Repeated across probes | Probes 4–9 |
| `q.format_facet` value enum (10 strings) | Enumerated via `c.format_facet=on` | Probe 9 |
| `properties[]` is sparse (~65% of hits) | All 20 hits of Alabama page swept | Probe 8 |
| `repositoryCalls[]` length varies 1–21 | Swept | Probe 8 |
| `q.topic0` works as filter; `q.topic1+` doesn't behave as drill-down | Probe 9 confirmed `q.topic0=Military` + `q.topic1=Census, Taxation, and Voter Lists` returns 0 | Probe 9 |
| `q.availability=Online` returns 474 of Alabama's 894 hits | Verified against facet count | Probe 7 |
| `q.year` works standalone; range form `q.year0`/`q.year1` returns 0 | Tested | Probe 7 |
| `q.author_surname_text` returns 0 hits for any tested surname | Tested with Griffin, Smith, Jones, Williams | Probes 4 + 9 |
| `q.place_ancestors` returns 0 hits in every form | Tested | Probe 7 |
| Three incompatible place-ID systems (Places, Collections, Catalog) | Confirmed | Probe 7 |
| `koha:` and `olib:` titleno prefixes both work on the detail endpoint | Confirmed | Probe 9 |
| List response omits `format`, `coverage[].temporal`, `inclusive_dates` | Confirmed | Probes 4 + 6 |

The probe scripts that produced these findings are **not** checked
in — per CLAUDE.md convention probes are dev-only scaffolding and not
shipped. The findings themselves are preserved in
`docs/plan/catalog-tool.md` (which lands in the same PR as this spec)
and are cited inline in the table above. The implementation PR will
re-run the probes against the live API to confirm the documented
contract still holds and will translate the findings into vitest
mocks; the probe scripts themselves do not need to live in tree.

---

## Open Questions (deferred to implementation PR)

- **Rate limits.** Not stress-tested. Will surface during real
  Cowork sessions.
- **`count` upper bound.** V1 caps at 100 as a conservative guess.
  The actual upstream limit is not known.
- **Should `availability` be enum-validated?** The probe trail
  found `"Online"` and `"FamilySearch Library"` as the high-value
  values, but the full enum (including per-Family-History-Center
  buckets) is large and changes over time. V1 leaves it as a free
  string; consider enum-validation if a skill picks a small set of
  intended values.
- **Should the tool fetch detail for the top N hits automatically?**
  The list response omits `format`, `inclusive_dates`, and per-roll
  microfilm content listings. The plan flagged this as an N+1
  concern. V1 leaves it to the caller (or to the deferred
  `place_catalog_item` tool); a `includeDetailForTop: 5` flag could
  land in V2 if real skill usage warrants it.
- **`q.inclusive_dates` + `q.place` combination is broken.** Probe
  7 found this returns 0 hits even when each works alone. The V1
  tool exposes only single-year `q.year` to avoid the trap; if a
  skill needs multi-year coverage on a place, the workaround is to
  paginate and post-filter on detail-mode `inclusive_dates`.
- **Catalog growth over time.** New `format` values, new `topic0`
  values, new `availability` buckets may appear upstream. The format
  enum is closed in V1 (10 known values); topic and availability
  are open strings. Worth re-probing periodically.

