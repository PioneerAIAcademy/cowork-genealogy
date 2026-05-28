# Image Search Tool — Implementation Spec

## Overview

An MCP tool that searches FamilySearch's Records Management Service (RMS)
for **image groups** — digitized volumes of historical documents. Supports
two query modes:

1. **Place + date range** — find all image groups covering a geographic
   area and time period (requires `placeRepIds`)
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
| `FS-User-Agent-Chain` | `chesworth` | Hard-coded identifier so FamilySearch team knows who to contact |

This endpoint does **not** use `BROWSER_USER_AGENT`. It uses
`FS-User-Agent-Chain` instead.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `placeRepIds` | number[] | No* | FamilySearch place representation IDs. Can pass multiple to search across places. **Not** the same as `placeId` from `place_search` — see Design Notes. |
| `fromDate` | string | No | Start of date range, `YYYY-MM-DD` format (e.g., `"1730-01-01"`). Only used with `placeRepIds`. |
| `toDate` | string | No | End of date range, `YYYY-MM-DD` format (e.g., `"1810-12-31"`). Only used with `placeRepIds`. |
| `imageGroupNumber` | string | No* | Image group number, optionally with wildcard `*` (e.g., `"007621224*"`). Image group numbers come from catalog search results. |

\* At least one of `placeRepIds` or `imageGroupNumber` is required.

### Fixed fields (always sent in request body)

| Field | Value | Rationale |
|-------|-------|-----------|
| `types` | `["NATURAL"]` | Always query Natural Groups for correct granularity |
| `returnChildCounts` | `false` | Keep response lean |
| `active` | `true` | Only return available groups |

### Request body examples

**Mode 1 — Place + date range:**
```json
{
  "coverage": {
    "placeRepIds": [2968392],
    "fromDateString": "1730-01-01",
    "toDateString": "1810-12-31"
  },
  "types": ["NATURAL"],
  "returnChildCounts": false,
  "active": true
}
```

**Mode 2 — Image group number lookup:**
```json
{
  "name": "007621224*",
  "types": ["NATURAL"],
  "returnChildCounts": false,
  "active": true
}
```

Note: the API uses `name` as the field for image group number lookups.

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
| `dateRange` | string? | Human-readable date range (from `datesOrig`, e.g., `"1726–1812"`) |
| `recordType` | string? | Record type (from `recordTypeOrig`, e.g., `"Burial Records"`) |
| `placeRelevance` | number | Match relevance (0–100) |

### Output example

```json
{
  "query": {
    "placeRepIds": [2968392],
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
    "Two query modes: (1) search by place + date range using placeRepIds, or " +
    "(2) look up a specific volume by image group number. " +
    "Returns image group metadata including coverage (places, dates, record " +
    "types) and creators. Use the results with image_read to view individual " +
    "images from a group. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      placeRepIds: {
        type: "array",
        items: { type: "number" },
        description:
          "FamilySearch place representation IDs. These are NOT the same " +
          "as placeId from place_search. Can pass multiple to search " +
          "across places.",
      },
      fromDate: {
        type: "string",
        description:
          "Start of date range in YYYY-MM-DD format (e.g., '1730-01-01'). " +
          "Only used with placeRepIds.",
      },
      toDate: {
        type: "string",
        description:
          "End of date range in YYYY-MM-DD format (e.g., '1810-12-31'). " +
          "Only used with placeRepIds.",
      },
      imageGroupNumber: {
        type: "string",
        description:
          "Image group number, optionally with wildcard * " +
          "(e.g., '007621224*'). Image group numbers come from catalog " +
          "search results.",
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
| Neither `placeRepIds` nor `imageGroupNumber` provided | Throw: `"image_search requires either placeRepIds or imageGroupNumber."` |
| Both `placeRepIds` and `imageGroupNumber` provided | Throw: `"Provide either placeRepIds or imageGroupNumber, not both."` |
| `placeRepIds` is empty array | Throw: `"placeRepIds array must not be empty."` |
| `fromDate` or `toDate` not in `YYYY-MM-DD` format | Throw: `"fromDate must be in YYYY-MM-DD format (e.g., '1730-01-01')."` |
| `fromDate`/`toDate` provided without `placeRepIds` | Throw: `"fromDate and toDate require placeRepIds."` |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error |
| API returns 401 | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| API returns 403 | Throw: `"FamilySearch image search API error: 403 Forbidden."` |
| Other non-OK status | Throw: `"FamilySearch image search API error: {status} {statusText}."` |
| Network error | Throw: `"Could not reach FamilySearch image search API: {message}."` |

---

## Mapping Logic

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
| 1 | Returns groups for placeRepIds + date range query | Happy path — place mode |
| 2 | Returns groups for image group number query | Happy path — image group number mode |
| 3 | Throws when neither placeRepIds nor imageGroupNumber provided | Required input validation |
| 4 | Throws when both placeRepIds and imageGroupNumber provided | Mutual exclusion |
| 5 | Throws when placeRepIds is empty array | Empty array validation |
| 6 | Throws when fromDate is invalid format | Date format validation |
| 7 | Throws when fromDate/toDate provided without placeRepIds | Orphan date validation |
| 8 | Builds correct request body for place mode | Request construction |
| 9 | Builds correct request body for image group number mode | Request construction |
| 10 | Maps API response to simplified output | Response mapping |
| 11 | Handles groups with multiple coverages | Multi-coverage mapping |
| 12 | Handles empty groups response | Zero-result path |
| 13 | Throws auth error when not authenticated | Auth propagation |
| 14 | Throws on 401 with re-login guidance | Token-expired path |
| 15 | Throws on network error | Connectivity failure |
| 16 | Sends correct headers (Authorization, Content-Type, FS-User-Agent-Chain) | Header contract |

### Smoke test

```bash
cd mcp-server
npx tsx dev/try-image-search.ts --place 2968392 --from 1730-01-01 --to 1810-12-31
npx tsx dev/try-image-search.ts --imageGroupNumber "007621224*"
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

### placeRepId vs placeId

The API requires `placeRepId`, which is **not** the same as the `placeId`
returned by `place_search`. A placeRepId is a FamilySearch place
*representation* ID — a specific version/form of a place entry. The
existing `place_search` tool does not currently expose placeRepIds.

For v1, callers must obtain placeRepIds through other means (e.g., from
catalog search results, from the FamilySearch place authority API, or
from coverage entries in prior `image_search` results). A future
enhancement could add placeRepId to `place_search` output or provide a
conversion utility.

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
truncated. A future enhancement can accept a `pageToken` input to
support multi-page traversal.
