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

## Auth

Uses `getValidToken()` from `src/auth/refresh.ts`. Passes the token as
`Authorization: Bearer {token}`. Do not re-implement token logic.

## What NOT to return

- Do not return the preservation image — those are multi-gigabyte TIFFs.
  The `dist.jpg` path is the distribution copy.
- Do not cache images — they are per-user and potentially large.

## Downstream use

The primary downstream consumer is the Image OCR comparison task (Issue #28),
which passes the image to Gemini Flash, Mistral, and Claude 3.5 Sonnet for
OCR evaluation. The `image` content type is required for that pipeline.
