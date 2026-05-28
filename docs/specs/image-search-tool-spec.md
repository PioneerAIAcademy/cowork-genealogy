# Image Search Tool — Implementation Spec

## Overview

An MCP tool that searches FamilySearch's Records Management Service (RMS)
for **image groups** — digitized volumes of historical documents. Supports
two query modes:

1. **Place + date range** — find all image groups covering a geographic
   area and time period (requires `placeId` from `place_search`)
2. **Image group number** — look up a specific digitized volume by its
   image group number

This fills a gap between `place_collections` (discovers *collections*)
and `image_read` (reads a *single image*). `image_search` discovers the
*volumes* that sit between those two levels — the actual digitized
microfilm rolls or book scans containing the document images.

### Why this matters

Not all FamilySearch images are indexed or transcribed. Many volumes
exist only as scanned images with no searchable text. Researchers need
to browse specific volumes (e.g., a probate book from a county
courthouse) image by image. `image_read` can read a single image, but
you first need to **find** which image groups exist for a place and time
period — that's what `image_search` provides.

### Image group numbers and Natural Groups

An image group number identifies a grouping of images — typically one
microfilm roll or digitized book. (FamilySearch historically used
several names for this concept — DGS, filmNumber, digitalFilmNumber —
but the canonical term is **image group number**.) Sometimes an image
group is split into **Natural Groups** — logical sub-volumes (e.g., one
parish register within a multi-volume film). We always query for type
`NATURAL`:
- If an image group has been split, each Natural Group is returned
  individually
- If an image group has **not** been split, it contains both
  `["DGS", "NATURAL"]` types and is still returned

---

## Endpoint

```
PUT https://sg30p0.familysearch.org/service/records/rms/group-service/group/search
```

Note: this is a PUT request (not GET or POST).

### Headers

| Header | Value | Notes |
|--------|-------|-------|
| `Authorization` | `Bearer <token>` | From `getValidToken()` |
| `Content-Type` | `application/json` | JSON request body |
| `User-Agent` | `BROWSER_USER_AGENT` | From `src/constants.ts` — same as other authenticated tools |
| `FS-User-Agent-Chain` | `chesworth` | Hard-coded identifier so FamilySearch team knows who to contact |

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `placeId` | string | No* | FamilySearch place ID — the same `placeId` returned by `place_search`. The tool internally converts this to one or more `placeRepId`s via the places API, then queries RMS for each and unions the results. |
| `fromDate` | string | No | Start of date range, `YYYY-MM-DD` format (e.g., `"1730-01-01"`). Only used with `placeId`. |
| `toDate` | string | No | End of date range, `YYYY-MM-DD` format (e.g., `"1810-12-31"`). Only used with `placeId`. |
| `imageGroupNumber` | string | No* | Image group number (e.g., `"007621224"`). The tool automatically appends a wildcard for the RMS query. Image group numbers come from catalog search results. |

\* At least one of `placeId` or `imageGroupNumber` is required.

### Fixed fields (always sent in request body)

| Field | Value | Rationale |
|-------|-------|-----------|
| `types` | `["NATURAL"]` | Always query Natural Groups for correct granularity |
| `returnChildCounts` | `false` | Keep response lean |
| `active` | `true` | Only return available groups |

### Internal conversion: placeId → placeRepIds

When the LLM provides a `placeId`, the tool:

1. Calls `GET https://api.familysearch.org/platform/places/{placeId}` to
   retrieve all place representations for that place
2. Extracts the list of `placeRepId`s (one placeId can map to multiple
   placeRepIds — e.g., placeId `6137147` maps to placeRepIds `2968392`
   and `10609408`)
3. Passes all placeRepIds in a single RMS call via the `coverage.placeRepIds`
   array — the API accepts multiple values natively

This conversion is invisible to the LLM — it only sees `placeId` in the
input schema.

**Verified May 2026**: passing `placeRepIds: [2968392, 10609408]` in one
call returns the same 4 groups as calling with `[2968392]` alone (the
second placeRepId returned 0 results independently). No deduplication
needed — the API handles the array correctly.

### Reverse conversion: placeRepId → placeId in output

RMS coverage entries contain `placeRepId` but not `placeId`. To return
`placeId` in the output, the tool must convert each coverage
`placeRepId` back to a `placeId` via the places API. This can be batched
or cached during the request.

### Request body examples

**Mode 1 — Place + date range** (all placeRepIds in one call):
```json
{
  "coverage": {
    "placeRepIds": [2968392, 10609408],
    "fromDateString": "1730-01-01",
    "toDateString": "1810-12-31"
  },
  "types": ["NATURAL"],
  "returnChildCounts": false,
  "active": true
}
```

**Mode 2 — Image group number lookup** (tool appends `*` automatically):
```json
{
  "name": "007621224*",
  "types": ["NATURAL"],
  "returnChildCounts": false,
  "active": true
}
```

Note: the API uses `name` as the field for image group number lookups.
The tool always appends `*` to the image group number before sending.

---

## API Response Shape

Probed May 2026 against the live endpoint.

**Top-level:**
```json
{
  "groups": [...],
  "numberReturned": 4,
  "totalCount": 4
}
```

For small result sets (typical of place+date and image group number
queries), `numberReturned` equals `totalCount` and all groups are
returned in a single response. For large result sets, the API
paginates — see Pagination note below.

**Empty result shape** (probed May 2026): when no groups match, the
response is `{"totalCount": 0}` — **no `groups` key and no
`numberReturned` key**. The tool must handle this gracefully by
defaulting `groups` to `[]` and `numberReturned` to `0`.

**Pagination** (probed May 2026): for large result sets the API **does**
paginate. It returns `numberReturned` (e.g., 10) out of `totalCount`
and includes a `nextPageToken` string for fetching the next page. For
typical place+date or image group number queries the result set is small
(single digits) and fits in one page. Pagination support is deferred for
v1 — the tool returns the first page and reports `totalCount` so the
caller knows if results were truncated.

**Both modes combined** (probed May 2026): sending both `coverage` and
`name` in the same request returns `{"totalCount": 0}` — the API does
not support combining them. The tool validates this client-side.

**Additional group fields** observed in some results (not present in all):

| Field | Type | Description |
|-------|------|-------------|
| `title` | string? | Human-readable title (e.g., `"Homestead Records - Nebraska - ..."`) |
| `volumes` | string[]? | Volume identifiers (e.g., `["Libro 9"]`) |
| `custodians` | string[]? | Record custodians (e.g., `["United States. National Archives and Records Administration"]`) |
| `archivalReferenceNumbers` | string[]? | Archival reference numbers (e.g., `["RG 49"]`) |

**Each group object:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Group ID. Format varies: `"DGS-{number}"` for unsplit image groups, or an alphanumeric ID like `"M921-6ZS"` for Natural Group sub-groups |
| `groupName` | string | Image group number. For unsplit groups this is the bare number (e.g., `"004452257"`); for split sub-groups it includes the number, part, and ID (e.g., `"007621224_005_M99P-2TQ"`) |
| `active` | boolean | Whether the group is available |
| `types` | string[] | `["NATURAL", "DGS"]` (unsplit) or `["NATURAL"]` (split sub-group) |
| `coverages` | Coverage[] | What this volume covers (place, dates, record type) |
| `creators` | string[] | Who created the records (e.g., `"Church of England. Parish Church of Edensor (Derbyshire)"`) |
| `externalId` | string | Legacy film number or internal identifier (e.g., `"1041700"`) |
| `externalIds` | string[]? | e.g., `["FILMNUMBER:1041700"]` |
| `languages` | string[] | e.g., `["en", "la"]` |
| `createdDateTime` | string | ISO datetime when the group was created |
| `modifiedDateTime` | string | ISO datetime when last modified |
| `parentIds` | string[] | Parent group IDs in the hierarchy |
| `publicationDateOverrideFormatted` | string? | Publication date (when present) |
| `hasAuditIssues` | boolean | Whether the group has audit issues |
| `title` | string? | Human-readable title (present on some groups, e.g., `"Homestead Records - Nebraska - ..."`) |
| `volumes` | string[]? | Volume identifiers (e.g., `["Libro 9"]`) |
| `custodians` | string[]? | Record custodians |
| `archivalReferenceNumbers` | string[]? | Archival reference numbers |

**Each coverage entry:**

| Field | Type | Description |
|-------|------|-------------|
| `place` | string | Human-readable place (e.g., `"Edensor, Derbyshire, England, United Kingdom"`) |
| `placeRepId` | number | Place representation ID |
| `placeCoordinates` | object | `{ latitude: number, longitude: number }` |
| `fromdateString` | string | Coverage start date (ISO) |
| `todateString` | string | Coverage end date (ISO) |
| `datesOrig` | string? | Human-readable date range (e.g., `"1726–1812"`) |
| `recordTypeOrig` | string? | Record type (e.g., `"Burial Records"`, `"Deed records"`) |
| `citationString` | string | Full citation string |
| `placeRelevance` | number | Match relevance score (0–100) |
| `placeRepIdHierarchy` | number[] | Place hierarchy from country down |
| `recordTypeConceptId` | number | Record type concept ID |
| `source` | string | `"USER"` or `"FILM_ITEM"` |

---

## Output

The tool maps the API response to a clean shape.

**Top-level:**

| Field | Type | Description |
|-------|------|-------------|
| `query` | object | Echo of input parameters |
| `totalGroups` | number | Total groups found (`totalCount` from API) |
| `returned` | number | Number of groups returned (`numberReturned` from API) |
| `groups` | ImageGroup[] | The matched image groups |

**Each `ImageGroup`:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Group ID (e.g., `"DGS-004452257"` for unsplit, `"M99P-2TQ"` for split sub-groups) |
| `imageGroupNumber` | string | Image group number — bare number for unsplit groups (e.g., `"004452257"`), or number + part + ID for sub-groups (e.g., `"007621224_005_M99P-2TQ"`). Mapped from `groupName` in the API response. |
| `title` | string? | Human-readable title when available (e.g., `"Homestead Records - Nebraska - ..."`) |
| `types` | string[] | e.g., `["NATURAL", "DGS"]` |
| `creators` | string[] | Record creators |
| `languages` | string[] | Language codes |
| `custodians` | string[]? | Record custodians (e.g., archives or churches) |
| `volumes` | string[]? | Volume identifiers (e.g., `["Libro 9"]`) |
| `coverages` | SimplifiedCoverage[] | What this volume covers |

**Each `SimplifiedCoverage`:**

| Field | Type | Description |
|-------|------|-------------|
| `place` | string | Human-readable place |
| `placeId` | string | FamilySearch place ID (converted from `placeRepId` in the API response) |
| `dateRange` | string? | Human-readable date range (from `datesOrig`, e.g., `"1726–1812"`) |
| `recordType` | string? | Record type (from `recordTypeOrig`, e.g., `"Burial Records"`) |
| `placeRelevance` | number | Match relevance (0–100) |

### Output example

```json
{
  "query": {
    "placeId": "6137147",
    "fromDate": "1730-01-01",
    "toDate": "1810-12-31"
  },
  "totalGroups": 4,
  "returned": 4,
  "groups": [
    {
      "id": "DGS-004452257",
      "imageGroupNumber": "004452257",
      "types": ["NATURAL", "DGS"],
      "creators": ["Church of England. Parish Church of Edensor (Derbyshire)"],
      "languages": ["en", "la"],
      "coverages": [
        {
          "place": "Edensor, Derbyshire, England, United Kingdom",
          "placeId": "6137147",
          "dateRange": "1726–1812",
          "recordType": "Burial Records",
          "placeRelevance": 94
        }
      ]
    }
  ]
}
```

---

## Tool Schema

```typescript
{
  name: "image_search",
  description:
    "Search FamilySearch's Records Management Service for image groups — " +
    "digitized volumes of historical documents (microfilm rolls, book scans). " +
    "Two query modes: (1) search by place + date range using a placeId from " +
    "place_search, or (2) look up a specific volume by image group number. " +
    "Returns image group metadata including coverage (places, dates, record " +
    "types) and creators. Use the results with image_read to view individual " +
    "images from a group. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      placeId: {
        type: "string",
        description:
          "FamilySearch place ID from place_search. The tool internally " +
          "converts this to place representation IDs for the RMS query.",
      },
      fromDate: {
        type: "string",
        description:
          "Start of date range in YYYY-MM-DD format (e.g., '1730-01-01'). " +
          "Only used with placeId.",
      },
      toDate: {
        type: "string",
        description:
          "End of date range in YYYY-MM-DD format (e.g., '1810-12-31'). " +
          "Only used with placeId.",
      },
      imageGroupNumber: {
        type: "string",
        description:
          "Image group number (e.g., '007621224'). Image group numbers " +
          "come from catalog search results.",
      },
    },
  },
}
```

---

## Authentication

Uses `getValidToken()` from `src/auth/refresh.ts`. Same OAuth flow as
all other authenticated tools. Do not re-implement token plumbing.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Neither `placeId` nor `imageGroupNumber` provided | Throw: `"image_search requires either placeId or imageGroupNumber."` |
| Both `placeId` and `imageGroupNumber` provided | Throw: `"Provide either placeId or imageGroupNumber, not both."` |
| `fromDate` or `toDate` not in `YYYY-MM-DD` format | Throw: `"fromDate must be in YYYY-MM-DD format (e.g., '1730-01-01')."` |
| `fromDate`/`toDate` provided without `placeId` | Throw: `"fromDate and toDate require placeId."` |
| Places API returns no placeRepIds for given placeId | Throw: `"No place representations found for placeId {placeId}."` |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error |
| API returns 401 | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 403 | Throw: `"FamilySearch image search API error: 403 Forbidden."` |
| Other non-OK status | Throw: `"FamilySearch image search API error: {status} {statusText}."` |
| Network error | Throw: `"Could not reach FamilySearch image search API: {message}."` |

---

## Mapping Logic

### Pre-request: input conversion

**Place mode (`placeId` provided):**
1. Call `GET https://api.familysearch.org/platform/places/{placeId}`
   with `Authorization` and `Accept: application/json` headers
2. Extract all `placeRepId` values from the place representations
3. Pass all placeRepIds in a single RMS request:
   `coverage.placeRepIds: [repId1, repId2, ...]`

**Image group number mode (`imageGroupNumber` provided):**
1. Append `*` wildcard to the value (e.g., `"007621224"` → `"007621224*"`)
2. Set as `name` field in the RMS request body

### Post-request: response mapping

For each group in `response.groups`:

1. `id` ← `group.id`
2. `imageGroupNumber` ← `group.groupName`
3. `title` ← `group.title` (when present)
4. `types` ← `group.types`
5. `creators` ← `group.creators`
6. `languages` ← `group.languages`
7. `custodians` ← `group.custodians` (when present)
8. `volumes` ← `group.volumes` (when present)
9. For each entry in `group.coverages`:
   - `place` ← `coverage.place`
   - `placeId` ← convert `coverage.placeRepId` to placeId via places API
   - `dateRange` ← `coverage.datesOrig` (human-readable, e.g., `"1726–1812"`)
   - `recordType` ← `coverage.recordTypeOrig` (e.g., `"Burial Records"`)
   - `placeRelevance` ← `coverage.placeRelevance`

Fields intentionally omitted from output (internal/low-value):
- `modified`, `createdDateTime`, `modifiedDateTime` (internal timestamps)
- `parentIds`, `phoenixAcquisitionIds` (internal hierarchy)
- `hasAuditIssues` (internal QA)
- `publicationDateOverride`, `publicationDateOverrideFormatted` (publication metadata)
- `externalId`, `externalIds` (legacy film numbers — internal identifiers)
- `archivalReferenceNumbers` (archival internal reference)
- Coverage internals: `fromDate`/`toDate` (epoch millis, redundant with
  string versions), `placeRepIdHierarchy`, `recordTypeConceptId`,
  `recordTypeConceptIdHierarchy`, `lifeEventIds`, `placeOrig`,
  `placeCoordinates`, `source`, `citationString`, `fromdateString`,
  `todateString`

---

## Caching

No caching. Query results depend on search parameters and may change as
new images are digitized.

---

## Files

| File | Purpose |
|------|---------|
| `src/types/image-search.ts` | Input, output, and API response type definitions |
| `src/tools/image-search.ts` | Tool function, input validation, request building, response mapping, schema export |
| `src/tool-schemas.ts` | Register `imageSearchSchema` in `allToolSchemas` |
| `src/index.ts` | Wire `image_search` handler in `CallToolRequestSchema` |
| `manifest.json` | Add `{ "name": "image_search" }` |
| `tests/tools/image-search.test.ts` | Unit tests |

---

## Testing

### `tests/tools/image-search.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns groups for placeId + date range query | Happy path — place mode |
| 2 | Returns groups for image group number query | Happy path — image group number mode |
| 3 | Throws when neither placeId nor imageGroupNumber provided | Required input validation |
| 4 | Throws when both placeId and imageGroupNumber provided | Mutual exclusion |
| 5 | Throws when fromDate is invalid format | Date format validation |
| 6 | Throws when fromDate/toDate provided without placeId | Orphan date validation |
| 7 | Converts placeId to placeRepIds via places API | placeId→placeRepId conversion |
| 8 | Passes all placeRepIds in single RMS call via coverage.placeRepIds array | Single-call with multiple placeRepIds |
| 9 | Builds correct request body for place mode | Request construction |
| 10 | Builds correct request body for image group number mode (appends wildcard) | Request construction |
| 11 | Maps API response to simplified output | Response mapping |
| 12 | Handles groups with multiple coverages | Multi-coverage mapping |
| 13 | Handles empty groups response | Zero-result path |
| 14 | Throws auth error when not authenticated | Auth propagation |
| 15 | Throws on 401 with re-login guidance | Token-expired path |
| 16 | Throws on network error | Connectivity failure |
| 17 | Sends correct headers (Authorization, Content-Type, User-Agent, FS-User-Agent-Chain) | Header contract |
| 18 | Throws when places API returns no placeRepIds | No representations found |
| 19 | Converts placeRepId in coverage to placeId in output | Reverse placeRepId→placeId conversion |

### Smoke test

```bash
cd mcp-server
npx tsx dev/try-image-search.ts --placeId 6137147 --from 1730-01-01 --to 1810-12-31
npx tsx dev/try-image-search.ts --imageGroupNumber "007621224"
```

---

## Design Notes

### Terminology: image group number

FamilySearch historically used several names for the same concept: DGS
(Digital Group Sheet), filmNumber, digitalFilmNumber. The canonical term
is now **image group number**. This spec and the tool implementation use
`imageGroupNumber` consistently in all user/LLM-facing surfaces (input
parameters, output fields, descriptions, error messages). The underlying
API still uses legacy field names (`groupName`, `name`, `externalId`) —
these are mapped to `imageGroupNumber` in the tool's output.

### placeId → placeRepId conversion

The RMS API requires `placeRepId`, but the LLM only knows about
`placeId` (from `place_search`). The tool handles this conversion
internally:

1. Call `GET https://api.familysearch.org/platform/places/{placeId}`
2. Extract all `placeRepId`s from the response (one placeId can map to
   multiple placeRepIds)
3. Pass all placeRepIds in a single RMS call — the API's `placeRepIds`
   array accepts multiple values natively, no fan-out or dedup needed

For the output, coverage entries from RMS contain `placeRepId` — the
tool converts these back to `placeId` via the places API so the LLM
always sees `placeId`.

This keeps the LLM interface simple — it only needs the `placeId` it
already gets from `place_search`.

### Relationship to other tools

```
place_collections  →  discovers COLLECTIONS for a place
image_search       →  discovers IMAGE GROUPS (volumes) within collections
image_read         →  reads a SINGLE IMAGE from a group
```

### Pagination

The API paginates large result sets, returning a `nextPageToken` for
fetching subsequent pages (default page size appears to be 10). For
typical place+date or image group number queries the result set is small
(single digits) and fits in one page. For v1, the tool returns the first
page only and reports `totalGroups` so the caller knows if results were
truncated.
