# Volume Search Tool — Implementation Spec

## Overview

An MCP tool that searches FamilySearch's Records Management Service
(RMS) for **image groups** — digitized volumes of historical documents
(microfilm rolls, book scans) — by **place and year range**. For each
matching image group it returns coverage metadata plus two
searchability signals the LLM needs to plan its research:

- **`recordSearchablePercent`** — what fraction of the volume's images
  have been indexed into structured records (findable by name via
  `record_search`).
- **`fulltextSearchable`** — whether the volume's images have been
  full-text (OCR) processed, so `fulltext_search` will return hits for
  it.

This is the renamed and enriched successor to the old `image_search`
tool (which performed this group search). The name `image_search` now
belongs to a separate tool that lists the individual images *within* a
group — see `docs/specs/image-search-tool-spec.md`.

### Why this matters

Not all FamilySearch images are indexed or transcribed. Many volumes
exist only as scanned images. `volume_search` lets the LLM discover
which digitized volumes cover a place and time period, then judge — per
volume — whether to (a) search it by name (`record_search`, once it
accepts an image group filter), (b) search its text (`fulltext_search`),
or (c) browse it image by image (`image_search` → `image_read`).

### Relationship to other tools

```
collections_search  →  discovers COLLECTIONS for a place
volume_search       →  discovers IMAGE GROUPS (volumes) covering a place + year range   ← this tool
image_search        →  lists the IMAGE IDs within one image group
image_read         →  reads a SINGLE IMAGE
fulltext_search    →  searches OCR text; accepts imageGroupNumber to scope to one volume
record_search      →  searches indexed records by person (will gain an image_group_number
                       filter in a later PR; accepts either imageGroupNumber or imageGroupPrefix)
```

### Image group numbers and Natural Groups

An image group number identifies a grouping of images — typically one
microfilm roll or digitized book. (FamilySearch historically used
several names — DGS, filmNumber, digitalFilmNumber — but the canonical
term is **image group number**.) Sometimes an image group is split into
**Natural Groups** — logical sub-volumes (e.g., one parish register
within a multi-volume film). This tool **only ever queries `NATURAL`
groups**:

- If an image group has been split, each Natural Group is returned
  individually, with a `groupName` of the form
  `{prefix}_{part}_{naturalId}` (e.g., `007621224_005_M99P-2TQ`).
- If an image group has **not** been split, it is returned as a single
  group whose `groupName` is the bare image group number (e.g.,
  `004452257`), and whose `types` is `["DGS", "NATURAL"]`. It still
  matches the `NATURAL` filter.

---

## Endpoints

| Purpose | Method + URL |
|---------|--------------|
| **Group search** | `PUT https://sg30p0.familysearch.org/service/records/rms/group-service/group/search` (with `returnChildCounts: true`, child counts come back inline) |
| **Full-text searchability** | `GET https://sg30p0.familysearch.org/service/search/fulltext/search/groupNumber?ids={comma-separated}` |
| **standardPlace → placeId → placeRepIds (input conversion)** | Anonymous FamilySearch place lookups (place search + `GET https://api.familysearch.org/platform/places/{placeId}`), via the resolver in `src/utils/place-resolver.ts` |

Note: the group search is a **PUT** request (not GET or POST).

### Headers

All `sg30p0.familysearch.org` calls (group search, full-text searchability):

| Header | Value | Notes |
|--------|-------|-------|
| `Authorization` | `Bearer <token>` | From `getValidToken()` |
| `Content-Type` | `application/json` | On the PUT (group search) |
| `Accept` | `application/json` | |
| `User-Agent` | `BROWSER_USER_AGENT` | From `src/constants.ts` — FS sits behind Imperva, which 403s non-browser UAs |
| `FS-User-Agent-Chain` | `chesworth` | Hard-coded identifier so the FamilySearch team knows who to contact |

The place-resolution calls (the place search and `api.familysearch.org`
lookups behind `standardPlaceToPlaceId` → `placeIdToRepIds`) are
**anonymous** — they send no `Authorization` header. They run inside the
resolver in `src/utils/place-resolver.ts`, whose underlying FamilySearch
place fetchers all hit anonymous endpoints.

> **Verify during implementation:** that the full-text searchability
> endpoint accepts the same headers. It requires authentication; the
> browser UA + agent chain are sent for consistency with the other
> RMS calls but may not be strictly required.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `standardPlace` | string | **Yes** | Standard place name (the `standardPlace` field from `place_search`). The tool resolves it to a `placeId` and then to one or more `placeRepId`s internally (via `standardPlaceToPlaceId` → `placeIdToRepIds`). |
| `startYear` | integer | No | Earliest year of interest, inclusive (e.g., `1730`). Omit for all periods. |
| `endYear` | integer | No | Latest year of interest, inclusive (e.g., `1810`). Must be ≥ `startYear`. Omit for all periods. |
| `pageToken` | string | No | Opaque pagination cursor. Pass back the `nextPageToken` from a previous response to fetch the next page. **Must be sent together with the same `standardPlace`/`startYear`/`endYear`** that produced it (see [Pagination](#pagination)). |

### Fixed fields (always sent in the group-search request body)

| Field | Value | Rationale |
|-------|-------|-----------|
| `types` | `["NATURAL"]` | Only query Natural Groups, for correct granularity |
| `active` | `true` | Only return available groups |
| `pageSize` | `100` | One page per call (see Pagination) |
| `returnChildCounts` | `true` | Populates `childCount` / `indexedChildCount` / `noIndexableDataChildCount` **inline** on each group in the search response |

`returnChildCounts: true` is sent, and the group-search response returns the
child counts **inline** on each group — no per-group sub-fetch is needed.
(Confirmed against the live API: the search response carries `childCount`,
`indexedChildCount`, and `noIndexableDataChildCount` directly.)

### Internal conversion: standardPlace → placeId → placeRepIds

When the LLM provides a `standardPlace` name, the tool resolves it in two
steps (both **anonymous** — no auth token is sent on these calls):

1. `standardPlaceToPlaceId(standardPlace)` resolves the name to a single
   `placeId` via FamilySearch place search. It returns `null` when the
   name is unresolvable or maps to multiple distinct spots (guarding the
   fan-out).
2. `placeIdToRepIds(placeId)` calls
   `GET https://api.familysearch.org/platform/places/{placeId}` and
   extracts all `placeRepId`s (one placeId can map to multiple
   placeRepIds).
3. The tool passes them in a single search call via
   `coverage.placeRepIds` — the API accepts the array natively (no
   fan-out or dedup needed).

This is invisible to the LLM, which only ever provides a
`standardPlace`. Both helpers live in the shared resolver
`src/utils/place-resolver.ts` (see [Files](#files)).

> There is **no reverse `placeRepId` → `placeId` conversion** in this
> tool. The old tool did this to populate a `placeId` in coverage
> output; that field has been dropped, so the reverse conversion
> (`repIdToPlaceId`) is removed entirely.

### Request body example

The RMS wire fields `fromDateString`/`toDateString` are **derived** from the
integer `startYear`/`endYear` inputs (they are not passed by the caller):
`fromDateString = "${startYear}-01-01"` and
`toDateString = "${endYear}-12-31"`. This is years-only — there is **no**
sub-year/ISO-day precision. So `startYear: 1730, endYear: 1810` yields:

```json
{
  "coverage": {
    "placeRepIds": [2968392, 10609408],
    "fromDateString": "1730-01-01",
    "toDateString": "1810-12-31"
  },
  "types": ["NATURAL"],
  "active": true,
  "pageSize": 100
}
```

On a paged call, `nextPageToken` is added and the rest of the body is
**byte-for-byte identical** to the call that produced the token (the API
requires this).

---

## API response shape

Probed against the live endpoint (see `metadata-search-documentation.txt`).

**Top-level:**

```json
{
  "groups": [ ... ],
  "numberReturned": 6,
  "totalCount": 6,
  "nextPageToken": "002400...1a0004"
}
```

- `nextPageToken` is present only when more pages remain.
- **Empty result:** when no groups match, the response is
  `{"totalCount": 0}` — no `groups` key and no `numberReturned`. The
  tool must default `results` to `[]` and `totalResults` to `0`.

**Each group (fields this tool consumes):**

| API field | Type | Used for |
|-----------|------|----------|
| `groupName` | string | `imageGroupNumber` and (derived) `imageGroupPrefix` |
| `childCount` | number? | `imageCount` and the `recordSearchablePercent` numerator base |
| `indexedChildCount` | number? | `recordSearchablePercent` numerator |
| `noIndexableDataChildCount` | number? | excluded from the `recordSearchablePercent` denominator |
| `id` | string | Group identifier (not output) |
| `coverages` | Coverage[] | `coverages` output array |
| `languages` | string[] | `languages` output |
| `title` | string? | `title` output (when present) |
| `volumes` | string[]? | `volumes` output (when present) |

Group fields intentionally **ignored**: `creators`, `custodians`,
`active`, `types`, `externalId`, `externalIds`, `parentIds`,
`phoenixAcquisitionIds`, `archivalReferenceNumbers`, `hasAuditIssues`,
`createdDateTime`, `modifiedDateTime`, `modified`,
`publicationDateOverride*`.

**Each coverage entry (fields this tool consumes):**

| API field | Type | Used for |
|-----------|------|----------|
| `place` | string | `place` (resolved, human-readable) |
| `datesOrig` | string? | `dateRange` (when present, e.g. `"1726–1812"`) |
| `recordTypeOrig` | string? | `recordType` (when present and not an internal placeholder) |

Coverage fields intentionally **ignored**: `placeRepId`,
`placeRepIdHierarchy`, `placeCoordinates`, `placeOrig`,
`placeRelevance`, `recordTypeConceptId`,
`recordTypeConceptIdHierarchy`, `lifeEventIds`, `fromDate`/`toDate`,
`fromdateString`/`todateString`, `citationString`, `source`.

---

## Child counts (inline)

The group-search request sends `returnChildCounts: true`, and the search
response returns the child counts **inline on each group** — there is **no
per-group sub-fetch**. Each group carries:

| API field | Meaning |
|-----------|---------|
| `childCount` | Total images in the group |
| `indexedChildCount` | Images indexed into structured records |
| `noIndexableDataChildCount` | Images with no indexable data (blanks, covers, etc.) |

The tool derives:

- **`imageCount`** ← `childCount`
- **`recordSearchablePercent`** ← `round( indexedChildCount / (childCount − noIndexableDataChildCount) × 100 )`

The denominator excludes non-indexable images so the percent reflects
the fraction of *indexable* images that have actually been indexed.

**Edge cases:**
- If the denominator (`childCount − noIndexableDataChildCount`) is `≤ 0`,
  set `recordSearchablePercent` to `null`.
- If a group omits the count fields entirely, set both `imageCount` and
  `recordSearchablePercent` to `null` for that group.

---

## Full-text searchability sub-fetch

To set `fulltextSearchable`, the tool batches the page's `groupName`
values (≤ 100 per call) into:

```
GET https://sg30p0.familysearch.org/service/search/fulltext/search/groupNumber?ids=8583524,007621224_005_M99P-2TQ,...
```

The response is the **sublist of ids that are full-text searchable**:

```json
{ "ids": ["8583524", "005876561"] }
```

Mapping:

- Build a `Set` from the returned `ids`.
- For each group, `fulltextSearchable = set.has(group.groupName)`
  (`true` if echoed back, `false` if not).
- The call is **retried up to 3 times** on failure. If it still fails,
  set `fulltextSearchable` to `null` (unknown) for every group in the
  batch — **not** `false` (absence-from-results means "not searchable";
  a failed call means "we could not determine it").

The endpoint accepts full `groupName`s, including split-group forms
(e.g., `7710186_001_M995-YTF` appears in the example `ids`), so matching
on the full `groupName` is exact — no prefix fallback is needed.

---

## Output

**Top-level:**

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Echo of input (`standardPlace`, `startYear?`, `endYear?`) |
| `totalResults` | number | `totalCount` from the API (across all pages) |
| `nextPageToken` | string? | Present only when more pages remain; pass back as `pageToken` |
| `results` | VolumeGroup[] | The matched image groups (this page) |

**Each `VolumeGroup`:**

| Field | Type | Description |
|-------|------|-------------|
| `imageGroupNumber` | string | The group's `groupName` (e.g., `"004452257"` or `"007621224_005_M99P-2TQ"`). Pass to `image_search` to list its images, or to `fulltext_search` (as its `imageGroupNumber`) to search this volume's text. |
| `imageGroupPrefix` | string | The bare image group number: the substring before the first `_` if any underscore is present, else the whole `groupName`. (`"007621224_005_M99P-2TQ"` → `"007621224"`; `"004452257"` → `"004452257"`.) Either this or the full `imageGroupNumber` can be passed to `record_search`'s image-group filter (coming in a later PR; see [Relationship to other tools](#relationship-to-other-tools)). |
| `imageCount` | number \| null | Total images in the group (`childCount`); `null` if counts couldn't be fetched. |
| `recordSearchablePercent` | number \| null | Percent of indexable images that are indexed into searchable records; `null` if not computable or counts couldn't be fetched. |
| `fulltextSearchable` | boolean \| null | `true`/`false` from the full-text endpoint; `null` if the check failed. |
| `title` | string? | Human-readable title, when present. |
| `volumes` | string[]? | Volume identifiers (e.g., `["Libro 9"]`), when present. |
| `languages` | string[] | Language codes (e.g., `["en", "la"]`); `[]` when absent. |
| `coverages` | SimplifiedCoverage[] | What this volume covers. |

**Each `SimplifiedCoverage`:**

| Field | Type | Description |
|-------|------|-------------|
| `place` | string | Human-readable place (e.g., `"Edensor, Derbyshire, England, United Kingdom"`). |
| `dateRange` | string? | Human-readable date range (from `datesOrig`, e.g., `"1726–1812"`), when present. |
| `recordType` | string? | Record type (from `recordTypeOrig`, e.g., `"Burial Records"`), when present. Omitted when the API returns an internal placeholder (a value matching `^concept-id:` or `^title:`). |

### Output example

```json
{
  "query": {
    "standardPlace": "Edensor, Derbyshire, England, United Kingdom",
    "startYear": 1730,
    "endYear": 1810
  },
  "totalResults": 6,
  "results": [
    {
      "imageGroupNumber": "004452257",
      "imageGroupPrefix": "004452257",
      "imageCount": 412,
      "recordSearchablePercent": 89,
      "fulltextSearchable": false,
      "languages": ["en", "la"],
      "coverages": [
        {
          "place": "Edensor, Derbyshire, England, United Kingdom",
          "dateRange": "1726–1812",
          "recordType": "Burial Records"
        }
      ]
    }
  ]
}
```

---

## Tool schema

```typescript
{
  name: "volume_search",
  description:
    "Search FamilySearch's Records Management Service for image groups — " +
    "digitized volumes of historical documents (microfilm rolls, book scans) — " +
    "covering a place and year range. Provide a standardPlace from place_search and an " +
    "optional year range. For each volume it returns coverage (places, dates, " +
    "record types), how much of the volume is indexed for record_search " +
    "(recordSearchablePercent), and whether it is full-text searchable " +
    "(fulltextSearchable). Use the returned imageGroupNumber with image_search to " +
    "list the volume's images, or with fulltext_search to search its text. " +
    "Results are paginated — pass back nextPageToken (with the same standardPlace and " +
    "years) as pageToken to get the next page. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      standardPlace: {
        type: "string",
        description:
          "Standard place name (the `standardPlace` field from place_search). " +
          "Required. The tool resolves it to a placeId and its place " +
          "representation IDs for the query.",
      },
      startYear: {
        type: "integer",
        description:
          "Earliest year of interest, inclusive (e.g., 1730). Omit for all periods.",
      },
      endYear: {
        type: "integer",
        description:
          "Latest year of interest, inclusive (e.g., 1810). Must be ≥ startYear. " +
          "Omit for all periods.",
      },
      pageToken: {
        type: "string",
        description:
          "Pagination cursor. Pass the nextPageToken from a previous " +
          "response, together with the same standardPlace/startYear/endYear, to " +
          "fetch the next page.",
      },
    },
    required: ["standardPlace"],
  },
}
```

---

## Authentication

Uses `getValidToken()` from `src/auth/refresh.ts`. Same OAuth flow as
all other authenticated tools. Do not re-implement token plumbing.

---

## Error handling

| Condition | Behavior |
|-----------|----------|
| `standardPlace` not provided | Throw: `"volume_search requires a standardPlace."` |
| `standardPlace` unresolvable / ambiguous | Throw: `"Could not resolve \"<name>\" to a single place; use place_search ..."` |
| `startYear` not an integer year | Throw: `"startYear must be an integer year (e.g., 1730)."` |
| `endYear` not an integer year | Throw: `"endYear must be an integer year (e.g., 1810)."` |
| `endYear` < `startYear` | Throw: `"endYear must be greater than or equal to startYear."` |
| Resolved place has no placeRepIds | Throw: `"No place representations found for \"{standardPlace}\"."` |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error |
| Group-search API returns 401 | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| Group-search API returns 403 | Throw: `"FamilySearch volume search API error: 403 Forbidden."` |
| Group-search API other non-OK | Throw: `"FamilySearch volume search API error: {status} {statusText}."` |
| Group-search network error | Throw: `"Could not reach FamilySearch volume search API: {message}."` |
| Group missing inline count fields | Set `imageCount` and `recordSearchablePercent` to `null` for that group; continue |
| **Full-text** check fails (after 3 retries) | Set `fulltextSearchable` to `null` for the batch; continue |

The full-text sub-fetch failure is **non-fatal** — a partial result with
`null` signals is more useful than a hard error.

---

## Mapping logic

### Pre-request

1. Validate `standardPlace` (required) and the integer years
   (`startYear`/`endYear`, with `endYear` ≥ `startYear`).
2. Resolve `standardPlace` → `placeId` via `standardPlaceToPlaceId`,
   then `placeId` → `placeRepIds` via `placeIdToRepIds` (both anonymous).
3. Derive the RMS wire dates from the integer years
   (`fromDateString = "${startYear}-01-01"`,
   `toDateString = "${endYear}-12-31"`) and build the group-search body
   (fixed fields + coverage + optional `nextPageToken`).

### Group search → full-text

1. PUT the group search (`returnChildCounts: true`); read `groups`,
   `totalCount`, `numberReturned`, `nextPageToken`. Child counts arrive
   **inline** on each group — no per-group fetch.
2. In one or more batches of ≤ 100 `groupName`s (3 retries): fetch the
   full-text-searchable set.

### Per-group mapping

For each group in `response.groups`:

1. `imageGroupNumber` ← `group.groupName`
2. `imageGroupPrefix` ← `group.groupName` before first `_`, else whole
3. `imageCount` ← `childCount` (or `null`)
4. `recordSearchablePercent` ← computed (or `null`)
5. `fulltextSearchable` ← membership in the full-text set (or `null`)
6. `title` ← `group.title` (when present)
7. `volumes` ← `group.volumes` (when present)
8. `languages` ← `group.languages ?? []`
9. For each `group.coverages` entry:
   - `place` ← `coverage.place`
   - `dateRange` ← `coverage.datesOrig` (when present)
   - `recordType` ← `coverage.recordTypeOrig` (when present and not
     matching `^(concept-id|title):`)

---

## Pagination

The API paginates with an opaque cursor. Constraints (from the API
docs):

- `nextPageToken` is **only valid with the exact same searchSpec** — the
  tool must rebuild a byte-for-byte identical body and append the token.
  Therefore the caller passes `pageToken` **together with the same
  `standardPlace`/`startYear`/`endYear`**. The year → ISO date derivation
  (`"${startYear}-01-01"` / `"${endYear}-12-31"`) is deterministic, so the
  same years always produce the same `fromDateString`/`toDateString` and
  hence the same body.
- The token is a client-side cursor with a **~9-day TTL** (the database
  is repaired every 9 days); stale tokens may skip or duplicate rows.

> **`standardPlace` re-resolution caveat (since the input is now a name, not a
> placeId).** Each page re-resolves `standardPlace` → `placeId` → `placeRepIds`
> to rebuild the coverage body. Within one server process this is deterministic
> (the resolver's in-process caches memoize the lookups), so pagination is
> byte-stable for the lifetime of a session. The only way the rebuilt body can
> differ from the token-minting body is if the **process restarts** between
> pages *and* the underlying FamilySearch place data shifts within the same
> 9-day window — a rare edge. Because `standardPlace` is a canonical
> fully-qualified name, resolution is exact-match and stable in practice; if a
> stale cursor is ever rejected, the caller simply re-issues page 1.

The tool returns **one page (≤ 100 groups) per call** plus
`nextPageToken` when more remain. It does **not** auto-aggregate all
pages — that would walk every page (and full-text batch) for what is
usually just a scoping question. `totalResults` tells the caller how many
groups exist in total.

---

## Caching

No caching. Results depend on search parameters and change as new
images are digitized, indexed, or full-text processed.

---

## Files

| File | Action |
|------|--------|
| `src/types/volume-search.ts` | Create — input, output, and API response types |
| `src/tools/volume-search.ts` | Create — tool function, validation, request building, full-text sub-fetch, mapping, schema export |
| `src/utils/place-resolver.ts` | Use — `standardPlaceToPlaceId` and `placeIdToRepIds` (the place-name → placeId → placeRepIds resolution) live here, anonymous. The old `place-search.ts` copy of `placeIdToRepIds` was deleted; the resolver is the single home |
| `src/tool-schemas.ts` | Add `volumeSearchSchema` to `allToolSchemas` |
| `src/index.ts` | Wire `volume_search` handler in `CallToolRequestSchema` |
| `manifest.json` | Add `{ "name": "volume_search" }` to the `tools` array |
| `dev/try-volume-search.ts` | Create — one-shot smoke test |
| `tests/tools/volume-search.test.ts` | Create — unit tests |
| `README.md` | Add `volume_search` to the tool catalog |
| `CLAUDE.md` | Add `volume_search` to the authenticated-tools list; ensure the code-reuse note points at `src/utils/place-resolver.ts` as the home of `standardPlaceToPlaceId`/`placeIdToRepIds` (not the old `image-search.ts`) |

---

## Testing

### `tests/tools/volume-search.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns groups for standardPlace + year range | Happy path |
| 2 | Throws when standardPlace is missing | Required-input validation |
| 3 | Throws when startYear/endYear is not an integer, or endYear < startYear | Year validation |
| 4 | Resolves standardPlace → placeId → placeRepIds and passes them in `coverage.placeRepIds` | Input conversion |
| 5 | Sends fixed fields `types:["NATURAL"]`, `active:true`, `pageSize:100`, `returnChildCounts:true` | Request construction |
| 6 | Derives `imageGroupPrefix` for both bare and 3-segment `groupName`s | Prefix rule |
| 7 | Computes `recordSearchablePercent` = round(indexed / (total − nonIndexable) × 100) | Counts math |
| 8 | Sets `recordSearchablePercent: null` when denominator ≤ 0 | Zero-denominator edge |
| 9 | Sets `imageCount`/`recordSearchablePercent: null` when a group omits inline count fields | Missing-counts path |
| 10 | Sets `fulltextSearchable: true/false` from the groupNumber endpoint | Full-text mapping |
| 11 | Sets `fulltextSearchable: null` after the full-text call fails 3× | Full-text failure path |
| 12 | Batches `groupName`s in chunks of ≤ 100 | Batch sizing |
| 13 | Maps coverages to `{ place, dateRange?, recordType? }`; drops `placeId`/`placeRelevance` | Coverage mapping |
| 14 | Omits `recordType` when value is `concept-id:…`/`title:…` | Placeholder filtering |
| 15 | Handles empty `{"totalCount":0}` response | Zero-result path |
| 16 | Returns `nextPageToken` when present; rebuilds identical body + token on paged call | Pagination |
| 17 | Throws on 401 with re-login guidance | Token-expired path |
| 18 | Throws on network error | Connectivity failure |
| 19 | Sends correct headers (Authorization, Content-Type, User-Agent, FS-User-Agent-Chain) | Header contract |

### Smoke test

```bash
cd mcp-server
npx tsx dev/try-volume-search.ts --standardPlace "Edensor, Derbyshire, England, United Kingdom" --startYear 1730 --endYear 1810
```

> The `standardPlace "Edensor, Derbyshire, England, United Kingdom"` /
> `1730`..`1810` query is a reasonable starting fixture (it
> appears in `metadata-search-documentation.txt`). The live request/response
> behavior has been confirmed: the group search with `returnChildCounts:
> true` returns child counts inline, and the full-text `groupNumber`
> endpoint behaves as specced.

---

## Design notes

### Two searchability signals, two mechanisms

`recordSearchablePercent` and `fulltextSearchable` describe **different
search systems** and are sourced differently:

- `recordSearchablePercent` comes from the **inline child counts**
  (`indexedChildCount` vs. indexable images) returned on each group. It
  tells the LLM how much of the volume is reachable through the indexed
  `record_search`.
- `fulltextSearchable` comes from the dedicated **full-text groupNumber
  endpoint**. It tells the LLM whether `fulltext_search` (which accepts
  an `imageGroupNumber`) will find anything in this volume.

A volume can be one, both, or neither. Both being low/false is the
signal that the only way into the volume is to browse it image by image
(`image_search` → `image_read`).

### Child counts come back inline

`returnChildCounts: true` on the group search **does** populate
`childCount` / `indexedChildCount` / `noIndexableDataChildCount` inline on
each returned group — confirmed against the live API. There is no
per-group sub-fetch; the tool reads the counts straight off the search
response. (An earlier draft of this spec assumed `returnChildCounts` was
ineffective and required a single-group `?include-child-count=true` fetch
per group; that turned out to be wrong and the inline approach is what
ships.)

### Terminology

The tool uses `imageGroupNumber` / `imageGroupPrefix` consistently on
all LLM-facing surfaces. The underlying API's legacy field name is
`groupName`; it is mapped on output.
