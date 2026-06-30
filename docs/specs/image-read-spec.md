# Image Reader Tool Spec

## What it does

Fetches a FamilySearch distribution image (≥200 DPI) by imageId and
returns the image data so Claude can display it or pass it to OCR
models. Requires FamilySearch authentication.

## Input

```typescript
{
  imageId: string   // An Image Group Number of the form NUMBER_NUMBER
}
```

### imageId format

An `imageId` is an Image Group Number of the form `NUMBER_NUMBER` — an
image group number, an underscore, and an image sequence number (e.g.
`004884748_02613`). It matches `/^\d+_\d+$/`. An `imageId` returned by
`image_search` feeds this tool directly.

The tool builds the distribution-image URL internally:

```
https://familysearch.org/das/v2/dgs:{imageId}/dist.jpg
```

The caller never constructs the URL. Fetching requires a valid
FamilySearch bearer token.

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
| Invalid imageId format | "Unrecognized imageId. Expected an Image Group Number of the form NUMBER_NUMBER (e.g. 004884748_02613)." |
| FamilySearch returns non-2xx | "FamilySearch image fetch failed: {status} {statusText}" |
| Response is not an image | "Expected an image response but got content-type: {type}" |
| Image exceeds the inline size cap | "FamilySearch image {imageId} is {N} MB — too large to return inline. The MCP transport caps a single response near 1 MB and base64 encoding inflates the image by ~33%, so returning it would crash the session. Read the indexed record for this image with record_read / record_search instead of fetching the page scan, or choose a more specific image." |

## Auth

Uses `getValidToken()` from `src/auth/refresh.ts`. Passes the token as
`Authorization: Bearer {token}`. Do not re-implement token logic.

## Size cap

The MCP stdio transport decodes one JSON message at a time behind a hard
~1 MiB (1,048,576-byte) buffer. Base64 encoding inflates the image ~33%, so
a raw `dist.jpg` much above ~780 KB yields a response message that overflows
that buffer and crashes the **entire session** — an uncatchable transport
error, not a per-tool failure. (This was observed killing an e2e run when the
agent browsed a 1950 census page scan.)

The tool therefore refuses any image whose raw bytes exceed
`MAX_INLINE_IMAGE_BYTES` (**700 KB** → ~933 KB of base64, under the cap with
envelope headroom), throwing the "too large to return inline" error above
instead of returning the bytes. The check runs **before** base64-encoding, so
an oversized image is never materialized.

This is a refuse-not-degrade guard: a large scan becomes unreadable via this
tool rather than crashing the run. Making large scans readable would mean
downscaling/re-encoding to fit, which needs an image-processing dependency
(e.g. `sharp`/`jimp`) bundled into the cross-platform `.mcpb`. That is a
deliberate packaging decision deferred until reading large images is actually
required.

## What NOT to return

- Do not return the preservation image — those are multi-gigabyte TIFFs.
  The `dist.jpg` path is the distribution copy.
- Do not cache images — they are per-user and potentially large.

## Downstream use

The primary downstream consumer is the Image OCR comparison task (Issue #28),
which passes the image to Gemini Flash, Mistral, and Claude 3.5 Sonnet for
OCR evaluation. The `image` content type is required for that pipeline.
