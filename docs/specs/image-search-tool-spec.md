# Image Search Tool — Implementation Spec

## Overview

An MCP tool that lists the **individual images within a single image
group** (a digitized volume — one microfilm roll or book scan). Given an
`imageGroupNumber`, it returns the sorted list of image IDs in that
volume.

Each image ID has the form `{imageGroupPrefix}_{imageNumber}` — a
9-ish-digit image group number, an underscore, and a 5-digit sequence
number (e.g., `004884748_02613`). A **separate PR** updates `image_read`
to accept an `imageId` directly and construct the DGS URL
(`https://familysearch.org/das/v2/dgs:{imageId}/dist.jpg`) internally,
so an `imageId` from this tool feeds `image_read` directly — the caller
does not build the URL.

> **Future direction:** the tool is named `image_search` (not
> `image_list`) because it will later accept search/filter criteria to
> narrow which images are returned. For now it has no filters — it
> returns **all** images in the group. The name is forward-looking by
> design.

### Relationship to other tools

```
volume_search  →  discovers IMAGE GROUPS (volumes) covering a place + date range
image_search     →  lists the IMAGE IDs within ONE image group          ← this tool
image_read       →  reads a SINGLE IMAGE (will accept an imageId directly — separate PR)
```

The previous tool named `image_search` performed the place+date group
search; that behavior now lives in `volume_search` (see
`docs/specs/metadata-search-tool-spec.md`). This spec **replaces** the
old `image_search`.

### Image group number forms

`imageGroupNumber` arrives from `volume_search`'s `imageGroupNumber`
output (or, eventually, a catalog). It takes one of two forms, which
determine how the tool resolves it to a group the image-listing endpoint
understands:

1. **Split Natural Group** — three underscore-separated segments,
   `{prefix}_{part}_{naturalId}` (e.g., `007621224_005_M99P-2TQ`). The
   **natural group id is the last segment** (`M99P-2TQ`) and is passed
   directly to the image-listing endpoint.
2. **Unsplit image group** — a bare number with no underscores (e.g.,
   `007621224` or `004452257`; also called the `imageGroupPrefix`). It
   must first be converted to an **apid** via the apid endpoint, and the
   apid is then passed to the image-listing endpoint.

---

## Endpoints

| Purpose | Method + URL |
|---------|--------------|
| **List images in a group** | `GET https://sg30p0.familysearch.org/service/records/rms/group-service/artifact/group/{groupId}/children/names` |
| **Bare number → apid** (unsplit form only) | `GET https://sg30p0.familysearch.org/service/records/rms/group-service/group/{imageGroupNumber}/apid` |

`{groupId}` is either a natural group id (`M99P-2TQ`) or an apid
(`TH-1942-27199-5790-22`).

### Headers (both calls)

| Header | Value | Notes |
|--------|-------|-------|
| `Authorization` | `Bearer <token>` | From `getValidToken()` |
| `Accept` | `application/json` | The `children/names` call returns JSON |
| `User-Agent` | `BROWSER_USER_AGENT` | From `src/constants.ts` — FS sits behind Imperva, which 403s non-browser UAs |
| `FS-User-Agent-Chain` | `chesworth` | Hard-coded identifier so the FamilySearch team knows who to contact |

> **Note:** the apid endpoint returns a **plain-text** body (e.g.,
> `TH-1942-27199-5790-22`), not JSON. Read it as text and trim
> whitespace.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `imageGroupNumber` | string | **Yes** | An image group number from `volume_search` — either a split Natural Group `groupName` (`007621224_005_M99P-2TQ`) or a bare/unsplit number (`007621224`). |

No other parameters. (Filters will be added in a later version.)

---

## Resolution logic

```
if imageGroupNumber contains "_":
    groupId = last "_"-separated segment        # e.g. "M99P-2TQ"
else:
    apid = GET /group/{imageGroupNumber}/apid    # plain-text response, trimmed
    groupId = apid                               # e.g. "TH-1942-27199-5790-22"

images = GET /artifact/group/{groupId}/children/names
```

---

## API response shape

The `children/names` endpoint returns a flat JSON object mapping each
image's **apid** to its **image ID**:

```json
{
  "TH-1951-22159-52423-62": "004884748_02613",
  "TH-1951-22159-52571-81": "004884748_02614",
  "TH-1942-22159-53144-63": "004884748_02615"
}
```

The tool keeps the **values** (the image IDs), discards the apid keys,
and sorts the values ascending (the trailing 5-digit sequence yields
page order).

> **Verify during implementation:** the observed responses are a single
> flat object with no pagination cursor, so the tool treats one call as
> returning **all** images. Confirm this holds for a **large** volume
> (thousands of images); if the endpoint paginates, add cursor handling.

---

## Output

A single, deliberately minimal object — just the sorted image IDs, to
keep the token cost low:

| Field | Type | Description |
|-------|------|-------------|
| `imageIds` | string[] | All image IDs in the group, each `{prefix}_{imageNumber}` (e.g., `"004884748_02613"`), sorted ascending. Empty array when the group has no images. |

### Output example

```json
{
  "imageIds": [
    "004884748_02613",
    "004884748_02614",
    "004884748_02615",
    "004884748_02616"
  ]
}
```

Downstream: pass an `imageId` straight to `image_read` to view it. A
separate PR updates `image_read` to accept an `imageId` and build the
DGS URL (`https://familysearch.org/das/v2/dgs:{imageId}/dist.jpg`)
internally — the caller no longer constructs the URL.

---

## Tool schema

```typescript
{
  name: "image_search",
  description:
    "List the images in a single FamilySearch image group (a digitized " +
    "volume — one microfilm roll or book scan). Provide an imageGroupNumber " +
    "(from volume_search) and get back the sorted list of image IDs in that " +
    "volume, each of the form '004884748_02613'. To view an image, pass its ID " +
    "to image_read. Use volume_search " +
    "first to find which image groups cover a place and date range. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      imageGroupNumber: {
        type: "string",
        description:
          "The image group number to list, from volume_search — either a " +
          "split Natural Group name like '007621224_005_M99P-2TQ' or a bare " +
          "number like '007621224'.",
      },
    },
    required: ["imageGroupNumber"],
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
| `imageGroupNumber` not provided | Throw: `"image_search requires an imageGroupNumber."` |
| apid lookup (unsplit form) returns non-OK | Throw: `"Could not resolve image group number {imageGroupNumber} to an image group."` |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error |
| `children/names` returns 401 | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` |
| `children/names` returns 403 | Throw: `"FamilySearch image search API error: 403 Forbidden."` |
| `children/names` other non-OK | Throw: `"FamilySearch image search API error: {status} {statusText}."` |
| Network error (either call) | Throw: `"Could not reach FamilySearch image search API: {message}."` |
| Group has no images (empty/`{}` response) | Return `{ imageIds: [] }` (not an error) |

---

## Caching

No caching. A volume's image set can change as new images are digitized.

---

## Files

| File | Action |
|------|--------|
| `src/types/image-search.ts` | Rewrite — reduce to `ImageSearchInput` (`{ imageGroupNumber: string }`), `ImageSearchResult` (`{ imageIds: string[] }`), and the `children/names` response type (`Record<string, string>`). Remove the old RMS-search and places-lookup types. |
| `src/tools/image-search.ts` | Rewrite — resolution logic (split vs. apid), `children/names` fetch, value extraction + sort, schema export. Remove `placeIdToRepIds` (relocated to `place-search.ts` for `volume_search`) and `repIdToPlaceId` (deleted — no consumers). |
| `src/tool-schemas.ts` | Keep `imageSearchSchema` in `allToolSchemas` (now the image lister). |
| `src/index.ts` | Update the `image_search` handler to the new I/O. |
| `manifest.json` | Keep `{ "name": "image_search" }`. |
| `dev/try-image-search.ts` | Rewrite — `npx tsx dev/try-image-search.ts <imageGroupNumber>`. |
| `tests/tools/image-search.test.ts` | Rewrite for the new behavior. |

---

## Testing

### `tests/tools/image-search.test.ts`

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Split form → uses last segment as groupId, calls `children/names` directly | Split-group path |
| 2 | Bare form → calls apid endpoint, then `children/names` with the apid | Unsplit-group path |
| 3 | Reads the apid endpoint's plain-text body (not JSON) and trims it | apid parsing |
| 4 | Returns image-ID **values** (not apid keys), sorted ascending | Output mapping + sort |
| 5 | Throws when `imageGroupNumber` is missing | Required-input validation |
| 6 | Throws when apid lookup fails | apid failure path |
| 7 | Returns `{ imageIds: [] }` for an empty/`{}` response | Zero-image path |
| 8 | Throws auth error when not authenticated | Auth propagation |
| 9 | Throws on 401 with re-login guidance | Token-expired path |
| 10 | Throws on network error | Connectivity failure |
| 11 | Sends correct headers (Authorization, Accept, User-Agent, FS-User-Agent-Chain) | Header contract |

### Smoke test

```bash
cd packages/engine/mcp-server
npx tsx dev/try-image-search.ts 007621224_005_M99P-2TQ   # split form
npx tsx dev/try-image-search.ts 007621224                # bare form (apid path)
```

> No confirmed live examples yet — verifying the live request/response
> (including whether `children/names` paginates for large volumes) is
> part of implementation. `M922-722` (from `image-search.txt`) and
> `007621224_005_M99P-2TQ` are reasonable starting fixtures.

---

## Design notes

### Why the output is just `imageIds`

A volume can contain thousands of images. Returning a list of bare
strings — rather than `{apid, imageId, url}` objects — keeps the payload
small. The apid keys from the `children/names` map are dropped because
`image_read` consumes the `imageId` (the DGS identifier) directly once
the separate `image_read` PR lands; the apid (ARK identifier) is not
needed for that path.

### Resolution rule, restated

- Underscores present → it's a split Natural Group; the last segment is
  the natural group id the endpoint accepts directly.
- No underscores → it's a bare/unsplit image group number; convert to an
  apid first.

This mirrors how `volume_search` derives `imageGroupPrefix` (substring
before the first `_`): a value with no `_` is already its own prefix and
takes the apid path; a 3-segment value carries its natural id in the
last segment.
