# Image Search Tool — Implementation Spec

## Overview

An MCP tool that lists the **individual images within a single image
group** (a digitized volume — one microfilm roll or book scan). Given an
`imageGroupNumber`, it returns the volume's image count and its image IDs
as ranges: one inclusive `[firstId, lastId]` pair per unbroken run.

Each image ID has the form `{imageGroupPrefix}_{imageNumber}` — a
9-digit image group number, an underscore, and a 5-digit sequence
number (e.g., `004884748_02613`). An id not of the form
`{9 digits}_{5 digits}` is its own `[id, id]` pair. A **separate PR** updates `image_read`
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
image_search     →  counts ONE image group's images, ids as ranges      ← this tool
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
| **A film's image groups, in film order** (`item` only) | `GET https://sg30p0.familysearch.org/service/records/rms/group-service/group/{apid}/children` → JSON array of group ids |
| **One group's name and place** (`item` only) | `GET https://sg30p0.familysearch.org/service/records/rms/group-service/group/{groupId}` → `groupName`, `coverages[0].place`; 403 on restricted groups |

`{groupId}` is either a natural group id (`M99P-2TQ`) or an apid
(`TH-1942-27199-5790-22`).

### Headers (both calls)

| Header | Value | Notes |
|--------|-------|-------|
| `Authorization` | `Bearer <token>` | From `getValidToken(principal)` |
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
| `item` | integer ≥ 1 | No | Address one item of a bare film: the film's `item`-th image group, counted in film order among the groups that hold images. Requires a bare `imageGroupNumber`. |
| `itemImage` | integer ≥ 1 | No | With `item`: the image counted within that item, image 1 being the item's first (its start card). Returned as `imageId`. Requires `item`. |

`item` and `itemImage` take an integer or a numeric string (read through
`coerceJsonArg`, so `"5"` is 5). Any other value — `0`, a negative, `1.5`,
`"five"`, `true` — is an error.

### Within-item addressing

Genealogists cite an image as "DGS 004528134, Item 5, Image 10", counting
images within the item, while the image tools take the film-wide id
(`004528134_00632`). `item` and `itemImage` do the conversion inside this tool.

**Why `image_search` only (lead, 2026-09-29).** Adding the same pair to
`image_transcribe` would widen a second, paid-OCR contract and the
`image-reader` agent's input for the sake of one saved call. `image_search`
already branches on bare versus split group numbers, so the resolution lives
in one function, and the `imageId` it returns goes straight to
`image_transcribe` / `image_read`.

**What "Item N" counts.** `item` is the position among the film's image
groups (the RMS numbering), not the Catalog's item number. A Catalog item
often names a section of the film as it was before the film was split, while
image groups reflect the film after the split, so image groups are the more
current numbering. The probe (`dev/probe-dgs-items.ts`, measured 2026-09-29)
found the two agree on one of the three films probed, and diverge where the
group service holds more than one group per filmed item:

| Film | Image groups vs Catalog items |
|---|---|
| 004528134 | Diverge from position 5: the 5th group is 00623–00644 (the tester's "Item 5, Image 10" = 00632); Catalog Item 5 is Vianen marriages at 00701 |
| 004528112 | All 14 agree |
| 005852351 | Off by one |

Position is the only numbering an ordinary account can resolve without a
place: the metadata that would map Catalog items is refused (403). So the
result carries the item's `place` when its metadata is readable, and the
caller checks it against the place in the citation. When place is null the
item could not be checked: tell the user it was counted by image group and may
not be the Catalog's item.

**Misspelled parameters are errors, never ignored.** `server.ts` refuses
every key other than the three above (`rejectUnknownArgs`,
`src/utils/unknown-args.ts`), so an unrecognised key never silently returns
the whole film. A key whose name matches `/item|image|page|frame/i` and does
not name the group (`itemNumber`, `item_number`, `imageNumber`, `imageId`,
`page`, `frame`, but not `image_group_number` or `imageGroup`, a misspelled
`imageGroupNumber`) gets this tool's own message, pointing to `item` / `itemImage`; any other key,
`lookingFor` and `maxResults` included, gets the generic one naming the
nearest parameters.

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

With `item` (bare film only), under one 45 s deadline:

```
apid     = GET /group/{imageGroupNumber}/apid
children = GET /group/{apid}/children                 # film order
lists    = each child's children/names (6 at a time, defect retry as below)
target   = the item-th child whose list has ≥ 1 image, read in order
           # a child at or before it whose list was refused, failed, or came
           # back all-null makes every later position unknown → error
ids = target's sorted list;  ranges = toImageIdRanges(ids);  imageId = ids[itemImage - 1]
name     = GET /group/{target}   # readable → its groupName and place;
                                  # refused → {dgs}_{NNN}_{target}, NNN = position
```

Live, 004528134 (2026-10-02): 20 children; the first 11 hold images and tile
00001–02334; the last 9 (`MMXT-*`) are empty. The 5th, `M92M-53P`, holds
00623–00644, so item 5 image 10 is `004528134_00632`; its metadata is 403, so
its name comes back position-built.

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
page order). That sorted list is `listGroupImageIds`'s answer, the one
source of a group's full list: `image_search` folds it into ranges, and
`volume_bisect` indexes its positions against it in-process.

### Defective responses

The shape above is **asserted, not guaranteed**. Observed live 2026-08-25 on
group `M9SW-1CG` (Barsebäck, `004514823_003`): the endpoint returned its full
164 keys but sent `null` as the **value** of one of them, for image
`004514823_00672`. Nine other calls to the same group in the same session were
clean, and one returned only 163 keys — the flaky child missing outright — so
this is intermittent upstream behaviour, not a stable contract change.

Unfiltered, that null did two kinds of harm: it reached the caller as though it
were an image ID, and the real image dropped off the list, making that page
unbrowsable for the rest of the run.

The tool therefore:

1. keeps only values that are non-empty strings, so a defective value can never
   be returned as an image ID; and
2. re-requests the group **once** when it sees a defective value, taking the
   retry only when it carries more usable IDs, or the same number with fewer
   dropped, and never at the cost of failing outright when the retry errors.
   A retry is what recovers the lost image; filtering alone would serve a list
   one page short with no signal.

   The re-request can only improve the result. Whether the retry is defective
   too, or fails outright with a 500, a 401 or a timeout, the first attempt's
   surviving IDs are returned rather than raised as an error — a
   mostly-complete browse list is more useful to the caller than nothing. Making
   usable IDs the primary comparison and `dropped` only a tie-break is what stops
   a clean but shorter retry from displacing a longer defective one.

**This covers only the defect shape the tool can detect.** A response that omits
a child entirely — the 163-key case — is 163 valid strings and is
indistinguishable from a genuinely shorter volume from inside this tool. Noticing
that would require cross-checking `imageCount` against `volume_search`'s
`imageCount` for the same group, which this tool does not receive.

> **Verify during implementation:** the observed responses are a single
> flat object with no pagination cursor, so the tool treats one call as
> returning **all** images. Confirm this holds for a **large** volume
> (thousands of images); if the endpoint paginates, add cursor handling.
> The answer no longer grows with the group: a volume of any size that is
> one unbroken run answers in about 75 characters.

---

## Output

A single, deliberately small object — the image count and the image IDs as
ranges, to keep the token cost low whatever the group's size:

| Field | Type | Description |
|-------|------|-------------|
| `imageCount` | number | Every image in the group, each `{prefix}_{imageNumber}` (e.g., `"004884748_02613"`). Always the full count, including images in runs cut by `truncated`. `0` when the group has no images. With `item`, the item's images only. |
| `imageIdRanges` | `[firstId, lastId][]` | One inclusive pair per run of ids with the same 9-digit prefix whose 5-digit suffix rises by exactly 1, in id order. A lone image is `[id, id]`, and so is an id not of the form `{9 digits}_{5 digits}`. The image at offset k within a run is `firstId` with its suffix raised by k, zero-padded. At most 500 pairs. Empty when the group has no images. |
| `truncated` | `true` | Present only when the group has more than 500 runs; pairs past the 500th are left off. |
| `imageGroupNumber` | string | With `item` only. The item's group: its own `groupName` when readable (and starting with this film's number), else `{dgs}_{NNN}_{id}`. Pass it back to `image_search` (only the last segment is read). |
| `place` | string \| null | With `item` only. The item's coverage place, `null` when its metadata was refused. |
| `imageId` | string | With `itemImage` only. The `itemImage`-th image of the item. |

### Output example

```json
{
  "imageCount": 6295,
  "imageIdRanges": [["004884748_00001", "004884748_06295"]]
}
```

An empty group answers `{ "imageCount": 0, "imageIdRanges": [] }`.

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
    "Count the images in a single FamilySearch image group (a digitized " +
    "volume — one microfilm roll or book scan) and return their ids as ranges. " +
    "Provide an imageGroupNumber (from volume_search) and get back imageCount " +
    "and imageIdRanges: one inclusive [firstId, lastId] pair per unbroken run " +
    "of ids, each id of the form '004884748_02613'. The image at offset k " +
    "within a run is firstId with its 5-digit suffix raised by k, zero-padded. " +
    "Past 500 runs the list is cut and truncated: true is set; imageCount stays " +
    "the full count. To read an image, pass its id to image_transcribe or " +
    "image_read. Use volume_search first to find which image groups cover a " +
    "place and year range. " +
    "For a citation like 'DGS 004528134, Item 5, Image 10', pass the bare " +
    "film number with item and itemImage: you get that image's imageId " +
    "(and the item's imageCount, imageIdRanges, imageGroupNumber and place) " +
    "without paging through the film. " +
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
      item: {
        type: "integer",
        minimum: 1,
        description:
          "Bare film only: the film's Nth item, counted as FamilySearch's image " +
          "groups in film order (1 = the first). This is not always the " +
          "Catalog's item number; check the returned place against the citation. " +
          "When place is null the item could not be checked: tell the user it was " +
          "counted by image group and may not be the Catalog's item.",
      },
      itemImage: {
        type: "integer",
        minimum: 1,
        description:
          "With item: the image counted within that item (1 = the item's first " +
          "image). Returned as imageId, ready for image_read or image_transcribe.",
      },
    },
    required: ["imageGroupNumber"],
  },
}
```

---

## Authentication

Uses `getValidToken(principal)` from `src/auth/refresh.ts`. Same OAuth flow as
all other authenticated tools. Do not re-implement token plumbing.

---

## Error handling

| Condition | Behavior |
|-----------|----------|
| `imageGroupNumber` not provided | Throw: `"image_search requires an imageGroupNumber."` |
| apid lookup (unsplit form) returns non-OK | Throw: `"Could not resolve image group number {imageGroupNumber} to an image group."` |
| Not authenticated | Let `getValidToken(principal)` throw its LLM-instruction error |
| `children/names` returns 401 | Throw: `"FamilySearch session not accepted; call the login tool to re-authenticate."` In hosted mode, the hosted reconnect instruction (`HOSTED_REAUTH_INSTRUCTION`) instead, via `rejectedTokenMessage`, since `login` cannot open a sign-in page there. |
| `children/names` returns 403 | Throw: `"FamilySearch image search API error: 403 Forbidden."` |
| `children/names` other non-OK | Throw: `"FamilySearch image search API error: {status} {statusText}."` |
| Network error (either call) | Throw: `"Could not reach FamilySearch image search API: {cause}."` (`{cause}` from `describeFetchError`, `src/utils/http.ts`) |
| Group has no images (empty/`{}` response) | Return `{ imageCount: 0, imageIdRanges: [] }` (not an error) |
| `item` / `itemImage` not an integer ≥ 1 | Throw, naming the parameter and the value |
| `itemImage` without `item` | Throw |
| `item` with a split `imageGroupNumber` | Throw: the split form already is one item |
| A key not in the schema that looks like an address (see Within-item addressing) | Throw, naming the key: "image_search has no parameter `limit`; to address one item use `item` / `itemImage`, or drop it to get the whole group's image ranges." |
| `item` beyond the film's image groups | Throw, naming the range: `film {dgs} has {K} items with images; item must be 1–{K}` |
| Bare film with no image-bearing child group | Throw: `film {dgs} is not split into items; call image_search without item` |
| A child at or before the target refused, failed, or all-null | Throw, naming the child: positions after it are unknown |
| `itemImage` beyond the item | Throw, naming the range: `item {N} has {M} images; itemImage must be 1–{M}` |
| `itemImage` given, and the item's list is still missing entries after the defect retry | Throw: a gap shifts every later image, so counts within the item are unknown. Without `itemImage` the short list is returned, as a browse |
| 45 s deadline (or the caller's lower `timeoutMs`) passed on the `item` path (a request is not started with under 1 s left; a failure landing after the deadline counts as the deadline) | Throw, saying how far the resolution got |
| Group name lookup refused or failed | Not an error: position-built name, `place: null` |

---

## Caching

No caching. A volume's image set can change as new images are digitized.

---

## Files

| File | Action |
|------|--------|
| `src/types/image-search.ts` | Rewrite — reduce to `ImageSearchInput` (`{ imageGroupNumber: string }`), `ImageSearchResult` (`{ imageCount, imageIdRanges, truncated? }` plus the `item` fields), `ImageIdRange`, and the `children/names` response type (`Record<string, string>`). Remove the old RMS-search and places-lookup types. |
| `src/tools/image-search.ts` | Rewrite — resolution logic (split vs. apid), `children/names` fetch, value extraction + sort, schema export. Remove `placeIdToRepIds` (relocated to `place-search.ts` for `volume_search`) and `repIdToPlaceId` (deleted — no consumers). |
| `src/utils/image-group.ts` | The resolution (split vs. apid) and a group's metadata fetch, shared with `image_transcribe`, which reads its film's coverage place there (`image-transcribe-tool-spec.md` §5.5.1). |
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
| 4 | `listGroupImageIds` returns image-ID **values** (not apid keys), sorted ascending | Output mapping + sort |
| 5 | Throws when `imageGroupNumber` is missing | Required-input validation |
| 6 | Throws when apid lookup fails | apid failure path |
| 7 | Returns `{ imageCount: 0, imageIdRanges: [] }` for an empty/`{}` response | Zero-image path |
| 8 | Throws auth error when not authenticated | Auth propagation |
| 9 | Throws on 401 with re-login guidance | Token-expired path |
| 10 | Throws on network error | Connectivity failure |
| 11 | Sends correct headers (Authorization, Accept, User-Agent, FS-User-Agent-Chain) | Header contract |
| 12 | `item` 5 / `itemImage` 10 on a mocked 004528134 resolves `imageId`, the item's `imageCount` and `imageIdRanges`, name and place | Within-item path |
| 13 | Out-of-range `item` / `itemImage`, `item` 0, `1.5`, `"five"`, `true`; `"5"` coerced | Address validation |
| 14 | `itemImage` without `item`; `item` with a split name; not-split film | Address shape |
| 15 | `itemNumber`, `item_number`, `imageNumber`, `page: 10`, `frame: "632"` throw; `lookingFor` passes | Misspelling guard |
| 16 | A refused or all-null child before the target throws; one after it does not | Position reliability |
| 17 | Name 403 → position-built name, `place: null` | Name fallback |
| 18 | No `item` → output keys are exactly `imageCount`, `imageIdRanges` | Unchanged path |
| 19 | A synthetic 6,295-image group, one run: `JSON.stringify(result).length` ≤ 100 (measured 75) | Size bound |
| 20 | 6,295 images with every other page missing: ≤ 19,100 characters (measured 19,054), `truncated: true`, 500 pairs, `imageCount` 6295 | Worst-case bound |
| 21 | A gap and a film-prefix change each start a run; a lone image and a malformed id are `[id, id]` | Run definition |
| 22 | Exactly 500 runs carries no `truncated`; 501 does | Cap edge |
| 23 | An item list one image short answers two pairs around the gap | Item path ranges |

### Smoke test

```bash
cd packages/engine/mcp-server
npx tsx dev/try-image-search.ts 007621224_005_M99P-2TQ   # split form
npx tsx dev/try-image-search.ts 007621224                # bare form (apid path)
npx tsx dev/try-image-search.ts 004528134 5 10           # item 5, image 10 → 004528134_00632
```

> Live-confirmed 2026-10-02 for the bare, split and `item` paths on 004528134
> (see Resolution logic). Whether `children/names` paginates for very large
> volumes is still unverified.

---

## Design notes

### Why ranges, and why 500 pairs

A listed id costs 18 characters (`"004884748_02613",`), with no bound, so the
old answer (every id in one array under a 13-character key wrapper) for a
6,295-image group was 113,324 characters, and any
group past 2,778 images crossed the 50,000-character line above which Claude
Code saves a tool result to a file and hands the agent a preview
(`docs/specs/catalog-search-tool-spec.md`, "Answer size" → "Why"). The full list bought the agent
nothing: it may read at most `IMAGE_BROWSE_CAP` = 20 pages of a group per
project (`src/utils/browse-budget.ts`), and in every sample and fixture the ids
form one unbroken run. A run answers in about 75 characters whatever its
length, and an id inside it is computed, not looked up.

The cap bounds the worst case, a group with every other page missing, where
every image is its own run. 500 pairs is 19,054 characters for a 6,295-image
group, under 40% of the spill line, and still more pages than the agent may
read. `imageCount` stays whole when the list is cut, so a truncated answer
still says how big the group is.

Reproduce the figures:

```bash
# 113324: the old answer for a 6,295-image group (the id array plus its 13-character wrapper)
node -e 'const id=i=>"004884748_"+String(i).padStart(5,"0");console.log(JSON.stringify(Array.from({length:6295},(_,i)=>id(i+1))).length+13)'
# 2778 50018: the first group size past the spill line under the old answer
node -e 'const id=i=>"004884748_"+String(i).padStart(5,"0");const s=n=>JSON.stringify(Array.from({length:n},(_,i)=>id(i+1))).length+13;let n=1;while(s(n)<=50000)n++;console.log(n,s(n))'
```

The 75 and 19,054 are measured by tests 19 and 20.

The apid keys from the `children/names` map are dropped because
`image_read` and `image_transcribe` consume the `imageId` (the DGS
identifier) directly; the apid (ARK identifier) is not needed for that path.

### Resolution rule, restated

- Underscores present → it's a split Natural Group; the last segment is
  the natural group id the endpoint accepts directly.
- No underscores → it's a bare/unsplit image group number; convert to an
  apid first.

The bare image group number is the substring before the first `_`: a
value with no `_` is already that number and takes the apid path; a
3-segment value carries its natural id in the last segment.
