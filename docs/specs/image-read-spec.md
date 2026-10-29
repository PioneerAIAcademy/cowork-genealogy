# Image Reader Tool Spec

## What it does

Fetches a FamilySearch distribution image (≥200 DPI) by `imageId` or
`ark` and returns the image data so Claude can display it or pass it
to OCR models. Requires FamilySearch authentication.

## Input

```typescript
{
  imageId?: string      // An Image Group Number of the form NUMBER_NUMBER
  ark?: string          // A FamilySearch document-image ARK, resolver URL, or resolved distribution URL
  imageArk?: string     // Another name for ark (not advertised); see below
  projectPath?: string  // Absolute project-folder path. When set, the fetched scan is saved
                         // under images/ and its project-relative path returned as imageRef.
}
```

Exactly one of `imageId` or `ark` must be provided. `projectPath` is optional
and independent of that choice.

**`imageArk` is read as `ark`.** It is the field `record_read` returns a page
image under and the key `research_log_append` logs an image entry by, so it is
the name callers carry forward. `foldImageArkInput` (`src/utils/fs-image-fetch.ts`)
folds it into `ark` before anything else reads the input — the resolver, the
image cap, the viewer link and the saved-image key all see `ark`. When both are
given and would fetch the same URL (one image in another spelling), `ark` is
used. When they are one ARK and only one side carries `i`/`cc`/`groupId` (a
bare `ark` beside `record_read`'s `ark:/61903/3:1:…?cc=2363041`), the side
carrying them is used, whichever key it came in on: on a multi-image waypoint
ARK `i=` picks the page, so the bare side could read another image. Two that
both carry those params and differ, and any other pair, are refused before any
fetch, and so is an `ark` that is not a string. An empty `imageArk` is not
folded, so the no-input error names it. It is accepted without being advertised
on the schema: `server.ts`'s unknown-argument guard lists it as an accepted
alias for this tool (`ACCEPTED_ALIASES`, `src/utils/unknown-args.ts`), unlike
`memoryArtifactUrl`, which the guard refuses here.

**`memoryArtifactUrl` is not advertised, and over MCP it is refused.**
`server.ts` refuses every argument key a tool's schema does not list
(`rejectUnknownArgs`), so an MCP call to `image_read` carrying
`memoryArtifactUrl` is refused before the handler runs, and the tool's own
errors name only `imageId` and `ark`. Memories pages go to `image_transcribe`,
as the description says (decided at review, 2026-10-26). `ImageReadInput
extends FsImageInput`, so a direct call can still carry it, and the tool forwards
`memoryShape` on purpose for that path. Advertising the parameter was declined
(lead, 2026-09-29): it adds an MCP parameter to every conversation, and this tool
refuses anything over `MAX_INLINE_IMAGE_BYTES` (700 KB raw), which turns away most
register photos regardless.

A Memories **page** URL (`photos/artifacts/<id>` or `/memories/<id>`) is a
different matter: it is not a bytes URL at all, and only `image_transcribe`
resolves one. Passing a page URL here is refused by the host check.
`image_transcribe` has no size cap because it returns text rather than bytes,
so it remains the right home for the class.

### imageId format

An `imageId` is an Image Group Number of the form `NUMBER_NUMBER` — an
image group number, an underscore, and an image sequence number (e.g.
`004884748_02613`). It matches `/^\d+_\d+$/`. An `imageId` returned by
`image_search` feeds this tool directly.

The tool builds the distribution-image URL internally:

```
https://familysearch.org/das/v2/dgs:{imageId}/dist.jpg
```

The caller never constructs the URL.

### ark format

`ark` is for callers that only have a document-image reference code,
not an `imageId` — e.g. `fulltext_search`'s `id` field (a `3:1:`/
`3:2:` document-image ARK).

Accepted forms:

- A canonical document-image ARK (`ark:/61903/3:1:...` / `3:2:...`) or
  a bare type-prefixed id (`3:1:...` / `3:2:...`) — normalized via
  `src/utils/ark.ts`'s `toArk`/`arkToUrl` and expanded to the full
  resolver URL (`https://www.familysearch.org/ark:/61903/...`), which
  is then fetched directly.
- A full resolver URL for one of the above, passed through unchanged.
- An **unprefixed** id of exactly the shape `XXXX-XXXX-XXXX-X` (uppercase
  letters and digits, trimmed), treated as `3:1:` and resolved like any other
  `3:1:` ARK. It exists because a delegating agent dropped the prefix from a
  pasted viewer URL in an alpha-feedback run. The shape is the only one
  accepted without a prefix. On `main` at `3cdfcb6a9`, 161 distinct prefixed ids of
  that shape are `3:1:` and 1 is `3:2:` (a test value), counted with
  `git grep -hoE "[0-9]:[0-9]:[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]\b" -- packages/engine docs eval | sort -u | cut -c1-4 | uniq -c`.
  Shorter ids collide with `1:1:` persona ids (`XXXX-XXX`, `XXXX-XXXX`) and `4:1:`
  tree ids (`XXXX-XXX`). The rule lives in `fs-image-fetch.ts`, not `ark.ts`'s
  `toArk`, which every ARK consumer shares. **Measured 2026-09-28 by the issue's
  review probe** on `3QS7-89Q6-89S6-Y`: the resolver ignores `i=` and `groupId`
  (four query forms return byte-identical images), and the `3:2:` form returns 400.
  On another login the same page returns 403 in every form, so the page is
  access-restricted per account.
- An already-resolved DeepZoomCloud ARK URL (ending in `/$dist`) or DGS
  distribution URL (`dgs:.../dist.jpg`), passed through unchanged —
  the pre-existing shapes from before `imageId` was introduced.

**A query string never decides the shape.** `record_read`'s `imageArk` carries
one (`ark:/61903/3:1:3Q9M-C9PT-V9Q2-2?cc=2363041`), and callers append one to
the other spellings as readily. Before the resolver runs,
`foldImageArkInput` respells only the forms a `?…` or `#…` suffix would
otherwise get refused as `Unrecognized ark`:

| `ark` as given | Read as |
|---|---|
| a `/$dist` or `dgs:…/dist.jpg` URL with a query | the same URL, query stripped |
| a bare `3:1:`/`3:2:` id with a query | its canonical `ark:/61903/…` ARK, query kept |
| an unprefixed `XXXX-XXXX-XXXX-X` id with a query | `ark:/61903/3:1:…`, query kept |
| a canonical ARK or resolver URL, with or without a query | unchanged |

The query is kept on an ARK because the resolver reads it the same way for
every spelling: only `i`/`cc`/`groupId` are forwarded, on the first attempt,
with the bare resolver URL as the fallback (below); anything else is dropped. A
spelling that was already accepted is never rewritten, so its saved-image key
(`images/<key>.jpg`) does not change.

**Verified against a live session (2026-07-07):** fetching a `3:1:`/
`3:2:` ARK's resolver URL redirects straight to the image bytes
(confirmed: `image_read({ ark: "ark:/61903/3:1:3Q9M-CSBN-T9CV-F" })`
returned a 418,782-byte `image/jpeg`). Other FamilySearch ARK types
(e.g. a `1:2:` record ARK) do not resolve this way — their resolver
returns an HTML shell, not the image — so `ark` only accepts `3:1:`/
`3:2:` document-image ARKs; other ARK types are rejected with
`"Unrecognized ark"` rather than silently attempted.

**Not every `3:1:`/`3:2:` ARK is self-sufficient.** Some are waypoints
into a multi-image film/register rather than a single page, and the
bare resolver redirect can land on an arbitrary image within that
group instead of the one the caller means — **observed live
(2026-08-03)**: a bare ARK for a multi-image entry returned a no-match
search page rather than the document, though the same ARK returned
`200` on later checks (08-05/07/10) — the resolver's behavior here is
not stable — while the browser's page URL for the same document carried `i=`
(image index), `cc=` (collection id), and `groupId=` (image group id)
query parameters that were required to reach the correct page. When
the caller's `ark` is a full URL carrying any of `i`/`cc`/`groupId`,
`arkToImageUrl` (`src/utils/fs-image-fetch.ts`) forwards them onto the
expanded resolver URL rather than discarding them — callers that only
have the bare ARK (no browser/citation URL) get the pre-existing
best-effort behavior, which may resolve to the wrong image for a
multi-image document. The tool's `ark` description tells callers to
pass the full URL when one is available, precisely to avoid this trap.

**Is there an autonomous route to the correct page?**
An autonomous run holds only what the tools give it for such a record —
the `1:1:` index ARK, `record_read`'s `sources[]`, and the bare `3:1:`
image ARK — never the browser page URL with its `i=`/`cc=`/`groupId=`.
**Investigated live (2026-08-07, re-verified 2026-08-10): the route exists,
but nothing reaches it yet — the bare ARK's own resolver metadata names a
clean `imageId` for the correct page, and no shipped tool fetches it (last
bullet).**

- Fetching the bare ARK's resolver URL (`ark:/61903/3:1:9392-9ZVZ-X`) with
  `Accept: application/json` (rather than `image/*`, which returns bytes)
  exposes structured metadata — `npx tsx dev/probe-image-read-ark-resolver.ts
  ark:/61903/3:1:9392-9ZVZ-X` returned
  `{"name":"004707850_00113","apid":"TH-1-18040-16514-50",
  "link":[…{"rel":"parents"}…]}`. `name` is a clean
  `{imageGroupNumber}_{sequence}` `imageId`, directly usable by `image_read`
  / `image_search`.
- That `imageId` is the **correct** page, not an arbitrary one:
  `image_transcribe 004707850_00113` returns the 1887 baptism-register
  spread containing the target entry (#44, 19 Oct 1887). The `i=`/`cc=`/
  `groupId=` values a browser URL carries are a *different* ID system (image
  index and collection/group ids), not the DGS `{group}_{sequence}` that
  names one image — so the two values differing is *expected*, not a mismatch.
  The JSON `name` route needs no browser URL; the bare-ARK **byte** path still
  needs the `i=`/`cc=`/`groupId=` forwarding `arkToImageUrl` does (above), so
  this is not licence to drop it. (Verified on this one reproduction ARK — a
  strong data point, not a proof for every multi-image ARK.)
- **The resolver is not stable over time.** The 2026-08-03 observation above
  (bare ARK → no-match page) did not reproduce on 08-05/07/10, when the same
  ARK returned `200` — but *which image those bytes were was not checked*. The
  fixture's own notes and a scored run show the bare-ARK bytes landing on the
  wrong (1881) page, which is exactly why the byte path needs the
  `i=`/`cc=`/`groupId=` forwarding above. The JSON `name` is the more reliable
  signal because it names the image explicitly rather than depending on redirect
  behavior.
- **No tool surfaces the JSON route today.** `image_read`/`arkToImageUrl`
  request `image/*` and get bytes only, never the JSON `name`/`parents`;
  `record_read`'s output carries no `imageGroupNumber`/`imageId`/`i=`/`cc=`/
  `groupId` (only the bare `3:1:` ARK); `image_search` takes an
  `imageGroupNumber` and returns *every* image in a group, with no ARK
  lookup and no page pointer; `volume_search` maps a place to groups but
  takes no ARK. `imageGroupNumber` is input-only on both search tools
  (`record-search.ts`, `fulltext-search.ts`), never returned.

**Bounded follow-up (a tool-contract change, not a skill edit):** have
`record_read` (or the resolver) read the ARK's JSON and surface `name` —
giving an autonomous run a direct, unambiguous `imageId` for the correct
page without the browser URL. It changes a tool's output shape and the
simplified-GedcomX surface, so it is a separate senior task. The instrument
for this finding is the live API plus a human reviewer; no CI check can
grade it (`docs/architecture.md` §9.4).

Fetching requires a valid FamilySearch bearer token.

## Output

The tool returns two content blocks:

1. **Image block** (`type: "image"`) — base64-encoded image bytes + MIME type.
   The calling agent sees this as a real image via its own vision (used by
   the retired `image-reader-opus` agent).

2. **Metadata block** (`type: "text"`) — JSON with:

```typescript
{
  url: string          // The distribution URL that was built and fetched
  viewerUrl?: string   // FamilySearch viewer URL for the image.
                        // Present for imageId and ark inputs; absent for memoryArtifactUrl.
                        // DGS: https://www.familysearch.org/search/film/<dgs>?i=<n-1> (zero-indexed).
                        // ARK: the resolver URL, preserving i=/cc=/groupId= context params.
  mimeType: string     // e.g. "image/jpeg"
  sizeBytes: number    // Size of the image in bytes
  imageRef?: string    // Project-relative saved path (images/<key>.jpg), present only
                        // when projectPath was supplied and the save succeeded
}
```

## Errors

| Condition | Message |
|-----------|---------|
| Not logged in | "Not authenticated. Call the login tool first." |
| More than one of imageId, ark and memoryArtifactUrl provided (a direct call; over MCP `server.ts` refuses `memoryArtifactUrl` first) | "Provide exactly one of imageId or ark." (`imageArk` counts as `ark`) |
| None of them provided | "image_read requires one of imageId or ark. Received keys: {each key passed, marked `(empty)` or `(not a string)` where so}." — or "Received no keys." |
| `ark` and `imageArk` both given, and they do not name the same image (see Input) | "image_read was given both ark ('{ark}') and imageArk ('{imageArk}'), which do not name the same image. imageArk is another name for ark: pass only one." — thrown before any fetch |
| `ark` is not a string | "image_read was given an ark that is not a string ({null, a number, an array, …}). Pass ark as a string: the ARK (ark:/61903/3:1:...) or page URL exactly as it was given." — thrown before any fetch, with or without `imageArk` |
| Invalid imageId format | "Unrecognized imageId. Expected an Image Group Number of the form NUMBER_NUMBER (e.g. 004884748_02613)." |
| Invalid ark format | "Unrecognized ark. Expected a FamilySearch document-image ARK (ark:/61903/3:1:... or 3:2:..., a bare 3:1:.../3:2:... id, an unprefixed XXXX-XXXX-XXXX-X id (treated as 3:1:), or a resolver URL for one), a DeepZoomCloud ARK URL (ending in /$dist), or a DGS distribution URL (dgs:.../dist.jpg). Pass the FamilySearch page URL or ARK exactly as the user gave it, including its 3:1:/3:2: prefix; do not build an imageId from a groupId or an i= index." |
| FamilySearch returns non-2xx | "FamilySearch image fetch failed: {status} {statusText}" (the `{statusText}` and its separating space are omitted when the response carries none). On a **400 or 404** for a `3:1:`/`3:2:` ark that is not a memory artifact, appends: the ark may not be a valid document-image identifier; directs to `record_read`'s `imageArk` field, and to passing the full page URL when the ark carries `i=`/`cc=`/`groupId=` context. It states that `image_search` returns image ids rather than arks. Every other status — including 401/403 (rights-restricted image) and 429 — keeps the bare message, because the ark is real and re-fetching it returns the same one. |
| Response is not an image | "Expected an image response but got content-type: {type}" |
| 21st distinct image in one image group in one project | "Image cap reached: 20 distinct images from image group {group} have already been read in this project, …" — thrown before the fetch. See §"Image cap" below. |
| Image exceeds the inline size cap | "FamilySearch image {imageId or ark} is {N} MB — too large to return inline. The MCP transport caps a single response near 1 MB and base64 encoding inflates the image by ~33%, so returning it would crash the session. OCR it with image_transcribe instead (it reads the scan host-side and returns text, with no size limit), or read the indexed record with record_read / record_search." |

## Image cap

`image_read` shares the hard image cap with `image_transcribe` and `volume_bisect`:
one count of distinct `imageId`s per image group per project, refused from the 21st,
checked before the fetch and recorded after it succeeds. The contract, the persisted
log and its limits are in `image-transcribe-tool-spec.md` §5.8; this tool follows it
unchanged. A `3:1:`/`3:2:` `ark` and a `memoryArtifactUrl` are not counted; a DGS
distribution URL passed as `ark` embeds its `imageId` and is.

## Auth

Uses `getValidToken(principal)` from `src/auth/refresh.ts`. Passes the token as
`Authorization: Bearer {token}`. Do not re-implement token logic.

## Size cap (a transport floor, not the primary defense)

The MCP stdio transport decodes one JSON message at a time behind a hard
~1 MiB (1,048,576-byte) buffer. Base64 encoding inflates the image ~33%, so
a raw `dist.jpg` much above ~780 KB yields a response message that overflows
that buffer and crashes the **entire session** — an uncatchable transport
error, not a per-tool failure.

The tool refuses any image whose raw bytes exceed `MAX_INLINE_IMAGE_BYTES`
(**700 KB** → ~933 KB of base64, under the cap with envelope headroom),
throwing the "too large to return inline" error above instead of returning
the bytes. The check runs **before** base64-encoding, so an oversized image
is never materialized. This is a refuse-not-degrade guard for a **single**
response.

**The per-image ceiling is a floor, not the accumulation fix.** The failure
that actually bites is base64 *accumulation*: blobs from successive
`image_read` calls pile up in the calling agent's context and are re-sent
every turn, so a later message overflows the 1 MiB buffer even when every
individual image is well under the ceiling. (Observed: an e2e run made **17**
`image_read` calls, each ≤458 KB raw, ~5.4 MB of base64 in total, then
crashed — no single image was near the ceiling.) Lowering the ceiling does
**not** fix this.

The accumulation fix is **`image_transcribe`**
(`docs/specs/image-transcribe-tool-spec.md`): callers that need a scan's text
call it instead of `image_read`. It OCRs the scan host-side, stages the page and
returns its ref (§5.5 there), so no base64 ever enters — or accumulates in — the
caller's transcript. (An `image-reader` subagent once wrapped it to the same
end; it was retired on 2026-10-16.) `image_read` itself is unchanged; it keeps the
floor above.

Making large scans **readable** (rather than refused) would mean
downscaling/re-encoding to fit, which needs an image-processing dependency
(e.g. `sharp`/`jimp`) bundled into the cross-platform `.mcpb`. That is a
deliberate packaging decision deferred until reading large images is actually
required — tracked as a follow-up.

## What NOT to return

- Do not return the preservation image — those are multi-gigabyte TIFFs.
  The `dist.jpg` path is the distribution copy.
- Do not cache images — they are per-user and potentially large.

## Downstream use

The primary downstream consumer is the Image OCR comparison task (Issue #28),
which passes the image to Gemini Flash, Mistral, and Claude 3.5 Sonnet for
OCR evaluation. The `image` content type is required for that pipeline.
