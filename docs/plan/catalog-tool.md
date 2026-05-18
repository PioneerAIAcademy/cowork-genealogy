# Catalog Tool — Evidence and Design Notes

Evidence trail for a future `catalog` MCP tool, built on the FamilySearch
internal Catalog Search API. Captures findings from probes 1–9 (in
`mcp-server/dev/probe-catalog-*.ts`) and surfaces open design questions
for team discussion before any implementation begins.

This document is **not** a finalized spec. The spec (when written) will
live at `docs/specs/catalog-tool-spec.md`.

## Why a catalog tool

Catalog searches the FS Library bibliographic catalog — books,
microfilms, manuscripts, maps, periodicals. This is a different surface
than the existing tools:

| Tool | Endpoint | What it covers |
|------|----------|---------------|
| `search` | `/service/search/hr/v2/personas` | Indexed persons in record collections |
| `collections` | `/service/search/hr/v2/collections` | Indexed record collections (with counts) |
| `external_links` | `/service/search/hr/external/collections/search` | External (non-FS) collection links |
| Catalog (this tool) | `/service/search/catalog/v3/search` | FS Library catalog — most items NOT indexed |

Skills today reference the catalog in narrative form only (e.g.
`docs/gps/record-search.md:234`, `plugin/skills/search-records/...`).
There is no MCP tool, so Claude must direct users to the web UI when
catalog browse is needed.

## API surface

### Search endpoint

```
GET https://www.familysearch.org/service/search/catalog/v3/search
Authorization: Bearer <access_token>
User-Agent: <browser-like>
Accept: application/json
```

**Auth required.** Anonymous requests return 401 with empty body. The
Atlassian sample URL works without a Bearer only because that page is
viewed from an authenticated browser session (cookie auth).

### Item detail endpoint

```
GET https://www.familysearch.org/service/search/catalog/item/{titleno}
GET https://www.familysearch.org/service/search/catalog/item/koha:{titleno}
```

- Both forms work and return identical bodies.
- The `koha:` prefix is the internal item-id namespace; the bare
  `titleno` is sufficient.
- **A second prefix `olib:` also appears** in list-response identifiers
  (e.g. `olib:1932139`). Probe 9 confirmed the detail endpoint works
  for both `olib:<id>` and bare-id forms, returning a `source` shape
  comparable to `koha:` items (17 fields for the Manuscript tested).
  `olib:` items are a mix of formats — verified examples include
  `Manuscript` (`olib:1932139`) and `Electronic Resource`
  (`olib:1661470`). Earlier speculation that `olib:` was a
  "collection-level" namespace was wrong.
- There is **no** `v3/item/{id}` variant — the versioned path 404s.
- There is **no** `/platform/records/catalog/{id}` mirror — the
  platform API does not expose catalog.
- The user-facing URL `/search/catalog/{titleno}` 307-redirects to a
  localized HTML page; not usable as a JSON API.

## Search response shape

```json
{
  "searchHits": [
    {
      "metadataHit": {
        "metadata": {
          "coverage": [{ "temporal": {} }],
          "creator": ["Griffin, Ronald G"],
          "identifier": {
            "value": "https://...catalog/item/koha:1837843"
          },
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

- Default page size: **20** hits per response.
- `coverage[].temporal` is **always empty in the list response** —
  inclusive dates only appear in the detail endpoint.
- `format` does **not** appear in the list response — also detail-only.
- `score` reflects relevance ranking when the query has scoring fields
  (e.g. `q.keywords`).

### Sparse `properties[]` field on hits

A `properties[]` field appears on **some** hits (13 of 20 in the
Alabama sample, ~65%). Probes 1–7 missed this because they only
dumped `searchHits[0]`, which happens to be the Civil War book that
has no properties. Probe 8 swept all 20 hits and confirmed it.

Shape:

```json
"properties": [
  { "type": "org.familysearch.www.catalog.topic",   "value": "123363" },
  { "type": "org.familysearch.www.catalog.topic",   "value": "124078" },
  { "type": "org.familysearch.www.catalog.surname", "value": "Butler" }
]
```

Observed property types (Alabama page 1, 20 hits):

| Type | Count | What it is |
|------|-------|------------|
| `org.familysearch.www.catalog.topic` | 17 | Numeric topic code (e.g. `123363`, `124133`). **Different from `q.topic0` human-readable strings** — probably the internal ID that `q.subject_id` / `q.topic_id` operate on. |
| `org.familysearch.www.catalog.surname` | 3 | Surname strings extracted from titles (e.g. `Butler`, `Butter`, `Buttler` on the Butler-variants census item) |

Both `q.surname` and `q.topic0` already work via title/category
matching, so `properties[]` is **supplementary data the tool can
return for free**, not a new query path. It's particularly useful
for tagging surface — a list-mode caller can show topic codes
alongside titles without an N+1 detail fetch.

### `repositoryCalls[]` is variable-length

Hit length varies from 1 to 21 entries. Each represents a physical
copy or digital holding (e.g. multiple `"FamilySearch Library"`
entries = multiple copies in the same library; `"Online"` /
`"Online at Affiliate Library"` = digital access tiers). Probe 1's
"length=1" finding was an artifact of sampling only the first hit.

## Item detail response shape

`source.*` field set varies by item format. The shapes we observed:

| Field | Book | Microfilm | Periodical Issue | Serial (parent) |
|-------|------|-----------|------------------|----------------|
| `title`, `display_title`, `titleno` | ✓ | ✓ | ✓ | ✓ |
| `format` | "Book" | "Microfilm 35mm" | "Periodical Issue" | **absent** |
| `author` | ✓ | ✓ | — | ✓ |
| `subject[]` | ✓ | ✓ | — | ✓ (single obj) |
| `publisher { date, name, place }` | ✓ | ✓ | ✓ | ✓ |
| `language { text, seq }` | ✓ | — | ✓ | ✓ |
| `inclusive_dates` | (often) | ✓ | — | — |
| `available_online` | ✓ | ✓ | ✓ | ✓ |
| `copy { call_number, location, availability, shelf }` | ✓ | — | ✓ | — |
| `physical { physical_display, length, dim_use }` | ✓ | ✓ | — | ✓ |
| `isn` / `isns` | ✓ | — | — | — |
| `oclc_record_number` | ✓ | ✓ | ✓ | ✓ |
| `note` | ✓ | ✓ | — | ✓ |
| `film_note[]` (per-roll listing) | — | ✓ | — | — |
| `xref` | — | ✓ | — | — |
| `part_of` (parent reference) | — | — | ✓ | — |
| `contains` (child issues) | — | — | — | ✓ |
| `alt_title`, `numeric_designation` | — | — | — | ✓ |

**Microfilm `film_note[]`** is the per-roll content listing. Each entry
contains the DGS / digital film number (`digital_film_no`,
`fs_indexed_film_number`), legacy `filmno`, what is on that roll
(`text`, `items`), and indexing flag (`fs_indexed: "Y"|"N"`). This is
the highest-value structured data the catalog returns — it is what a
genealogist needs to drill into image browse or full-text search of a
specific roll.

**Subject types observed:** `LCTSH` (Library of Congress Topical
Subject Heading) and `TRACE` (FS's geographic-subject tracing format
with `geo_name` indicator).

## Query parameter behavior

### The single most important finding

**`m.queryRequireDefault=on` is mandatory.** Without it, every `q.*`
parameter is advisory ranking only — the API returns the entire
catalog (2,037,676 hits at probe time) and only re-orders by score.
This was the same trap the wiki page warned about; we re-confirmed it
empirically.

The MCP tool **must** always send `m.queryRequireDefault=on` unless a
deliberate "score-rank without filtering" mode is added later.

### Query-param matrix (with `m.queryRequireDefault=on`)

| Param | `totalHits` | Works? | Note |
|-------|-------------|--------|------|
| `q.title=marriage` | 30,150 | ✓ | Title field, substring + stemming |
| `q.surname=Flynn` | 88 | ✓ | Surname mentioned in title/content |
| `q.author=Griffin` | 429 | ✓ | Author field |
| `q.author_surname_text=Griffin` | 0 | **✗** | Wiki-documented; returns nothing |
| `q.author_surname_text=Smith / Jones / Williams` | 0 / 0 / 0 | **✗** | Probe 9 confirmed broken — three common surnames all return 0 |
| `q.subject=DNA` | 50 | ✓ | LC subject heading |
| `q.year=1880` | 167,307 | ✓ | Items covering that year |
| `q.year0=1850&q.year1=1860` | 0 | **✗** | Range form; wiki marks "experimental" |
| `q.place=Alabama` + `q.place.exact=on` | 894 | ✓ | **Use exact match for place** |
| `q.place_id=33` | 21,722 | ✓ but ID system collides | Returns Italian items |
| `q.film_number=004001998` | 1 | ✓ | Exact DGS lookup |
| `q.keywords=Alabama` | 13,718 | ✓ | Cross-field keyword |
| `q.isn=9780786430789` | 1 | ✓ | ISBN exact |
| `q.oclc_id=181368793` | 1 | ✓ | OCLC exact |
| `f.surname=Flynn` (filter form) | 0 | **✗** | Filters need exact facet value |
| `q.title=marriage` AND `q.place=Alabama` (exact) | 24 | ✓ | AND logic |
| `q.topic0=Military` + Alabama | 11 | ✓ | Top-level genealogy category — matches probe 5A facet count exactly |
| `q.topic0=Birth, Marriage and Death` + Alabama | 11 | ✓ | Same — facet-emitted strings work as filter values |
| `q.topic1=Vital Records` (with topic0 set) | 0 | **✗** | Drill-down value guessed; needs the exact facet-emitted child string |
| `f.topic0=Military` + Alabama | 11 | ✓ | `f.` and `q.` forms behave identically for `topic0` |
| `q.format_facet=Book` + Alabama | 410 | ✓ | Filter by item format |
| `q.format_facet=Microfilm` + Alabama | 0 | **✗** | Wrong value string — exact value is `"Microfilm 35mm"` |
| `q.format_facet=Microfilm 35mm` + Alabama | 187 | ✓ | Probe 9 — confirms exact-string requirement |
| `q.format_facet=Manuscript` + Alabama | 28 | ✓ | Probe 9 |
| `q.format_facet=Periodical` + Alabama | 0 | **✗** | Wrong string — real value is `"Periodical Issue"` |
| `q.availability=Online` + Alabama | 474 | ✓ | **Top-value filter for skills** — answers "what's online-viewable" |
| `q.availability=FamilySearch Library` + Alabama | 701 | ✓ | Holding-library filter |
| `f.availability=Online` + Alabama | 474 | ✓ | `f.` form identical |
| `q.place_ancestors=United States` | 0 | **✗** | Broken in all tested forms (place name, hierarchical path) |
| `q.inclusive_dates=1861-1865` | 10,200 | ✓ | Standalone date-coverage filter |
| `q.inclusive_dates=1880` | 6,739 | ✓ | Single-year form works standalone |
| `q.inclusive_dates=1850-1900` + Alabama | 0 | **✗** | Combination with place returns 0 — fragile |

### High-value working filters (probe 7)

The following filters were verified against probe 5 facet counts and
should be the primary skill-facing knobs in any MCP tool design:

- **`q.availability=Online`** — directly answers the question skills
  ask most often: *"is this catalog item viewable online without
  visiting a FamilySearch Library?"* Returns 474 of Alabama's 894 hits.

- **`q.topic0=<category>`** — top-level genealogy category filter.
  Values are the exact strings emitted by the `c.topic0=on` facet
  (e.g. `"Military"`, `"Birth, Marriage and Death"`, `"Census,
  Taxation, and Voter Lists"`). Both `q.` and `f.` forms work and
  return identical results.

  **`q.topic1`–`q.topic5` are NOT usable as a hierarchical drill-down.**
  Probe 9 tested `c.topic1=on` after `f.topic0=Military` and got
  three values back — `"Military"`, `"Census, Taxation, and Voter Lists"`,
  `"Repositories"` — which look like *co-occurring topic0 categories*,
  not Military sub-topics. Then `q.topic0=Military &
  q.topic1="Census, Taxation, and Voter Lists"` returned 0 hits.
  So the wiki's hierarchical drill-down description doesn't match
  the API's actual behavior. **The MCP tool should expose only
  `q.topic0`**, with no deeper drill-down, until the team understands
  what topic1+ are for.

- **`q.format_facet=<format>`** — filter by item format. Values must
  exactly match what the format facet emits. Probe 9 enumerated the
  complete enum via `c.format_facet=on` (Alabama scope, but the
  values are catalog-wide):

  | Value | Alabama count |
  |---|---|
  | `Book` | 410 |
  | `Microfilm 35mm` | 187 |
  | `Microfiche` | 116 |
  | `Microfilm 16mm` | 74 |
  | `Manuscript` | 28 |
  | `CD-Rom` | 14 |
  | `Map` | 11 |
  | `FHC Copy to Digitize` | 8 |
  | `Electronic Resource` | 6 |
  | `Periodical Issue` | 1 |

  The MCP tool's `format` input should be a TypeScript enum of these
  10 strings, not a free-text string. Common mistakes ("Microfilm"
  alone, "Periodical") return 0 hits silently.

### Broken or fragile params (probe 7)

- `q.place_ancestors` returned 0 hits for every tested form (plain
  place name, comma-separated path, with/without `m.queryRequireDefault`).
  **Not usable as a hierarchical place filter.** `q.place` with
  `q.place.exact=on` remains the only working place-name path.

- `q.inclusive_dates` works standalone but returns 0 hits when
  combined with `q.place` (exact). The combination breaks the most
  common skill query ("records covering 1850–1900 in Alabama").
  Likely better to use `q.year=<single-year>` until this is
  understood; multi-year coverage may require post-filter on
  detail-mode `inclusive_dates`.

### Place IDs are NOT interchangeable

Three incompatible place-ID systems exist:

| System | Alabama ID |
|--------|-----------|
| Places API (`/platform/places/`) | **351** |
| Collections API (`/service/search/hr/v2/collections`) | **33** |
| Catalog API (`/service/search/catalog/v3/search`) | **33 = Italy** (Fucecchio, Tuscany) |

`collections` already worked around the Places↔Collections mismatch
by passing place names instead of IDs (`docs/specs/collections-tool-spec.md`).
The catalog tool should do the same.

### Recommended query template

```
GET /service/search/catalog/v3/search?
  m.queryRequireDefault=on
  &m.defaultFacets=off
  &q.place=<place-name>
  &q.place.exact=on
  &q.<filter1>=<value1>
  &q.<filter2>=<value2>
  &count=20
  &offset=0
```

## Facets and groupBy

### Default facets (`m.defaultFacets=on`)

Returns five facet categories: **Year, Category, Availability,
Language, Format**. Each facet group has:

```json
{
  "count": 894,
  "displayCount": "894",
  "displayName": "Year",
  "facets": [
    { "count": 289, "displayName": "1800", "params": "..." },
    ...
  ],
  "params": "c.year0=on"
}
```

`params` strings are pre-built drill-down URLs that the client can
append. The Year facet is hierarchical (`c.year0=on` for centuries,
then `c.year1=on` for decades after filtering with `f.year0=1800`).

**Availability facet is very granular** — buckets like
`"FamilySearch Library"`, `"Online"`, `"Granite Mountain Record Vault"`,
plus per-Family-History-Center counts. Useful surface for "what's
viewable online vs. on-site only?"

### Granular `c.*` facets

Individual count terms (`c.format_facet`, `c.subject_facet`,
`c.availability`, `c.year0`, `c.topic0`–`c.topic5`) work as
documented. Hierarchical `c.year1`/`c.topic1`+ require a preceding
`f.year0`/`f.topic0` filter.

### `groupBy` — aggregated results

`groupBy=author|subject|placeSubject` rewrites `searchHits[]` to be
**aggregated facet values** rather than catalog items. Each "hit"
has only `identifier`, `title`, and `score`, where:

- `title.value` is the author/subject name
- `identifier.value` is the aggregation's internal ID (NOT a
  followable catalog item ID)
- `searchHits.length` is the number of distinct group values
- `totalHits` is still the total matching records

Example: `groupBy=subject&q.subject=DNA` → 7 hits like
`"DNA - Analysis"`, `"DNA - Evolution"`, `"DNA - Genealogy - Handbooks"`,
each representing a subject heading that has DNA records under it.

`groupBy` is the right surface for **"what subjects exist for this
place?"** style queries — a use case skills already describe (e.g.
locality-guide's reference-source-types).

## Proposed MCP tool shape (open for discussion)

A single tool `catalog` with two modes, mirroring how
`collections` evolved from list-only to list + detail (`id` parameter).

### Input

| Field | Type | Mode | Description |
|-------|------|------|-------------|
| `query` | string | list | Free-text keyword search (maps to `q.keywords`) |
| `place` | string | list | Place name; sent as `q.place` + `q.place.exact=on` |
| `surname` | string | list | `q.surname` |
| `title` | string | list | `q.title` |
| `author` | string | list | `q.author` |
| `subject` | string | list | `q.subject` |
| `year` | number | list | `q.year` (single year only — range form is broken) |
| `format` | enum | list | Filter by format. Enum of 10 values verified via probe 9: `Book`, `Microfilm 35mm`, `Microfiche`, `Microfilm 16mm`, `Manuscript`, `CD-Rom`, `Map`, `FHC Copy to Digitize`, `Electronic Resource`, `Periodical Issue`. |
| `availability` | enum | list | Filter by holding (`Online`, `FamilySearch Library`, …). `q.availability=Online` is the top skill-facing filter — verified in probe 7. |
| `topic` | string | list | Top-level genealogy category (`Military`, `Birth, Marriage and Death`, etc.). Maps to `q.topic0` only — `q.topic1`+ are not usable (probe 9). |
| `groupBy` | `"author" \| "subject" \| "placeSubject"` | list | Switch to aggregated mode |
| `id` | string | detail | Single-item lookup (titleno or `koha:<titleno>`) |
| `count` | number | list | Page size, default 20 |
| `offset` | number | list | Pagination offset |

Exactly one mode applies: if `id` is provided, detail mode wins.

### Output (list mode)

Curated `CatalogHit[]` with fields surfaced from the list response,
plus optional embed flag to also fetch detail for the top N hits
(avoids N+1 in the LLM workflow):

```ts
interface CatalogHit {
  id: string;            // titleno without koha:/olib: prefix
  title: string;         // metadata.title[0].value
  authors: string[];     // metadata.creator[] (often multiple)
  holdings: string[];    // metadata.repositoryCalls[].title (1-21 entries;
                         //  includes "Online", "FamilySearch Library", etc.)
  topicCodes: string[];  // from properties[type=...topic] — numeric IDs
  surnames: string[];    // from properties[type=...surname]
  score: number;
  url: string;           // user-facing /search/catalog/{id}
}
```

`authors` is plural because some items have 2-3 creators. `holdings`
is the full repositoryCalls list, not just the first — count and
diversity (e.g. "Online" presence) signals item availability.
`topicCodes` and `surnames` come from `properties[]` and are
**sparse** (~65% of hits had any) — return as empty arrays when
absent.

### Output (detail mode)

Surface the rich `source.*` shape, but normalize across the four
format variants observed. Recommended top-level fields:

```ts
interface CatalogItem {
  id: string;
  title: string;
  format: string | null;        // "Book", "Microfilm 35mm", etc.
  author: string | null;
  subjects: Array<{ text: string; type: string; geo?: boolean }>;
  publisher: { date: string; name: string; place: string } | null;
  inclusiveDates: string | null;
  availableOnline: boolean;     // "Y" -> true
  language: string | null;
  isbn: string | null;
  oclcId: string | null;
  callNumber: string | null;
  location: string | null;
  rolls: Array<{                // film_note[] for microfilm; empty otherwise
    dgs: string;                // digital_film_no
    legacyFilmNo: string;
    contents: string;           // text
    items: string;
    fsIndexed: boolean;
    location: string;
  }>;
  url: string;
}
```

### Open design questions for the team

1. **Should `query` accept the full `q.*` parameter map (advanced
   mode), or only the curated fields above?** The wiki documents many
   params; surfacing all of them invites LLM misuse but limits power.

2. **`groupBy` returns synthetic hits with NO catalog item IDs**
   (only aggregation IDs). Should it be a separate tool, or a mode
   of the same tool with a different output shape?

3. **N+1 detail fetches for high-value list rows.** The list response
   omits `format`, `inclusive_dates`, and `film_note[]`. Should the
   tool fetch detail for the top N (say N=5) hits automatically, or
   leave that to a follow-up call?

4. **Should we expose facets?** They are extremely rich
   (per-Family-History-Center availability buckets), but each one
   doubles the response size. Maybe expose only when an
   `includeFacets: true` flag is set.

5. **`available_online: "N"` items.** Many microfilms exist but are
   only viewable at a FamilySearch Center. Should the tool flag this
   prominently (skills currently mention "switch to Catalog browse to
   find unindexed films" — these are exactly those films)?
   The `q.availability=Online` filter (verified probe 7) gives the
   inverse view directly — items the user can see right now.

6. **Param names: `q.surname` searches surnames in titles, not
   author surnames.** Confusing in an LLM-facing schema. Consider
   renaming to `nameInTitle` or splitting into `authorSurname` +
   `subjectSurname` (though `q.author_surname_text` returned 0 hits
   for us — needs more probing).

## Items NOT investigated (potential future probes)

- **Pagination at scale.** Probes used default page size; have not
  confirmed `count=100`/`offset=1000` behavior.
- **Latin American notarial / manuscript items.** Probe 6 covered
  one Brazilian microfilm; other LA formats may have different
  field sets (per the wiki's claim that catalog covers LA notarial).
  The detail shape for `Manuscript` format was confirmed in probe 9
  (`olib:1932139`), but Maps and CD-Rom variants were not probed.
- **`groupBy=author` with no `q.author`** — does it return author
  facets across the whole catalog?
- **`q.inclusive_dates` + place combination.** Probe 7 showed the
  combination returns 0 hits even though each works alone. Worth
  testing other forms (e.g. `q.inclusive_dates=1861/1865` slash
  separator, or sending it as `f.inclusive_dates`).
- **Search-within-collection.** Does the catalog API support
  filtering hits within a single film/manuscript (analogous to
  full-text search inside a DGS)?
- **Rate limits / WAF behavior.** No 4xx/5xx observed during
  probing; not exercised at scale.

## Probe scripts (evidence trail)

| Script | Purpose |
|--------|---------|
| `mcp-server/dev/probe-catalog-basic.ts` | Endpoint shape + auth requirement (probe 1) |
| `mcp-server/dev/probe-catalog-detail.ts` | Detail endpoint discovery (probe 2) |
| `mcp-server/dev/probe-catalog-params.ts` | `q.*` and `f.*` parameter matrix (probe 4) |
| `mcp-server/dev/probe-catalog-facets.ts` | `m.defaultFacets`, `c.*`, `groupBy` (probe 5) |
| `mcp-server/dev/probe-catalog-microfilm.ts` | Non-book format variations (probe 6) |
| `mcp-server/dev/probe-catalog-params-extra.ts` | High-value param coverage: `q.topic0`, `q.format_facet`, `q.availability`, `q.place_ancestors`, `q.inclusive_dates` (probe 7) |
| `mcp-server/dev/probe-catalog-properties.ts` | Sweep all 20 hits of the Alabama page for `properties[]` and `repositoryCalls` length (probe 8) |
| `mcp-server/dev/probe-catalog-cleanup.ts` | Cleanup tests for tentative findings: format enum, olib: detail, topic1 hierarchy, `q.author_surname_text` (probe 9) |
