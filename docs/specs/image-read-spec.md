# Image Reader Tool Spec

## What it does

Fetches a FamilySearch distribution image (≥200 DPI) by `imageId` or
`ark` and returns the image data so Claude can display it or pass it
to OCR models. Requires FamilySearch authentication.

## Input

```typescript
{
  imageId?: string   // An Image Group Number of the form NUMBER_NUMBER
  ark?: string       // A FamilySearch document-image ARK, resolver URL, or resolved distribution URL
}
```

Exactly one of `imageId` or `ark` must be provided.

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
- An already-resolved DeepZoomCloud ARK URL (ending in `/$dist`) or DGS
  distribution URL (`dgs:.../dist.jpg`), passed through unchanged —
  the pre-existing shapes from before `imageId` was introduced.

**Verified against a live session (2026-07-07):** fetching a `3:1:`/
`3:2:` ARK's resolver URL redirects straight to the image bytes
(confirmed: `image_read({ ark: "ark:/61903/3:1:3Q9M-CSBN-T9CV-F" })`
returned a 418,782-byte `image/jpeg`). Other FamilySearch ARK types
(e.g. a `1:2:` record ARK) do not resolve this way — their resolver
returns an HTML shell, not the image — so `ark` only accepts `3:1:`/
`3:2:` document-image ARKs; other ARK types are rejected with
`"Unrecognized ark"` rather than silently attempted.

### The `record_read` ↔ `image_read` ARK boundary (reciprocal)

The two tools split the ARK space by class and each **rejects** the
other's class rather than silently attempting it:

- `image_read` owns document images (`3:1:`/`3:2:`) and rejects record
  personas with `"Unrecognized ark"` (above).
- `record_read` owns record personas (`1:1:`/`1:2:`) and, symmetrically,
  rejects a `3:1:`/`3:2:` document-image ARK **before any fetch**,
  routing the caller to `image_read`. This guard exists because
  `record_read` would otherwise strip the ARK to a bare id and fetch the
  record recapi, which 404s/403s — a silent-attempt failure that led an
  agent to wrongly conclude "image-level ARKs are not resolvable through
  the available tools" (zabriskie-children e2e, 2026-07-21).

The shared `3:[12]:` matcher is `DOCUMENT_IMAGE_ARK_PATTERN` in
`src/utils/ark.ts`, consumed by both tools; `record_read` tests its
input through `toArk()` first so a bare `3:1:…`/`3:2:…` id is caught too.
`record_read`'s rejection error (pinned LLM-instruction contract):

> `'<ark>' is a document-image ARK (3:1:/3:2:), not a record persona.
> record_read reads record personas (1:1:); use the image_read tool with
> this ARK to fetch the image.`

Fetching requires a valid FamilySearch bearer token.

## Output

The tool returns two content blocks:

1. **Image block** (`type: "image"`) — base64-encoded image bytes + MIME type.
   Claude and downstream OCR models (Gemini, Mistral) can consume this directly.

2. **Metadata block** (`type: "text"`) — JSON with:

```typescript
{
  url: string         // The distribution URL that was built and fetched
  mimeType: string    // e.g. "image/jpeg"
  sizeBytes: number   // Size of the image in bytes
}
```

## Errors

| Condition | Message |
|-----------|---------|
| Not logged in | "Not authenticated. Call the login tool first." |
| Both imageId and ark provided | "Provide either imageId or ark, not both." |
| Neither imageId nor ark provided | "image_read requires either imageId or ark." |
| Invalid imageId format | "Unrecognized imageId. Expected an Image Group Number of the form NUMBER_NUMBER (e.g. 004884748_02613)." |
| Invalid ark format | "Unrecognized ark. Expected a FamilySearch document-image ARK (ark:/61903/3:1:... or 3:2:..., a bare 3:1:.../3:2:... id, or a resolver URL for one), a DeepZoomCloud ARK URL (ending in /$dist), or a DGS distribution URL (dgs:.../dist.jpg)." |
| FamilySearch returns non-2xx | "FamilySearch image fetch failed: {status} {statusText}" |
| Response is not an image | "Expected an image response but got content-type: {type}" |
| Image exceeds the inline size cap | "FamilySearch image {imageId or ark} is {N} MB — too large to return inline. The MCP transport caps a single response near 1 MB and base64 encoding inflates the image by ~33%, so returning it would crash the session. Read the indexed record for this image with record_read / record_search instead of fetching the page scan, or choose a more specific image." |

## Auth

Uses `getValidToken()` from `src/auth/refresh.ts`. Passes the token as
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

The accumulation fix is the **`image-reader` subagent**
(`packages/engine/plugin/agents/image-reader.md`, spec:
`docs/specs/image-reader-agent-spec.md`): callers that need a scan's text
(currently only `record-extraction`) delegate to it via `Task` instead of
calling `image_read` directly. The subagent reads the image in an isolated
context and returns only a text transcription, so the base64 never enters —
or accumulates in — the main transcript. `image_read` itself is unchanged; it
keeps the floor above.

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
