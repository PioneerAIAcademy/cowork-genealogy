# Image Reader Tool Spec

## What it does

Fetches a FamilySearch distribution image (≥200 DPI) by URL and returns
the image data so Claude can display it or pass it to OCR models.
Requires FamilySearch authentication.

## Input

```typescript
{
  url: string   // A FamilySearch image URL in one of the two supported formats
}
```

### Supported URL formats

**ARK format** (DeepZoom cloud endpoint):
```
https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/{ARK_ID}/$dist
```

**DGS format** (direct JPEG endpoint):
```
https://familysearch.org/das/v2/dgs:{DGS_NUMBER}_{IMAGE_NUMBER}/dist.jpg
```

Both formats require a valid FamilySearch bearer token.

## Output

The tool returns two content blocks:

1. **Image block** (`type: "image"`) — base64-encoded image bytes + MIME type.
   Claude and downstream OCR models (Gemini, Mistral) can consume this directly.

2. **Metadata block** (`type: "text"`) — JSON with:

```typescript
{
  url: string         // The URL that was fetched
  mimeType: string    // e.g. "image/jpeg"
  sizeBytes: number   // Size of the image in bytes
}
```

## Errors

| Condition | Message |
|-----------|---------|
| Not logged in | "Not authenticated. Call the login tool first." |
| Invalid URL format | "Unrecognized FamilySearch image URL. Expected an ARK or DGS URL." |
| FamilySearch returns non-2xx | "FamilySearch image fetch failed: {status} {statusText}" |
| Response is not an image | "Expected an image response but got content-type: {type}" |

## Auth

Uses `getValidToken()` from `src/auth/refresh.ts`. Passes the token as
`Authorization: Bearer {token}`. Do not re-implement token logic.

## What NOT to return

- Do not return the preservation image — those are multi-gigabyte TIFFs.
  The `/$dist` suffix and `dist.jpg` path are the distribution copies.
- Do not cache images — they are per-user and potentially large.

## Downstream use

The primary downstream consumer is the Image OCR comparison task (Issue #28),
which passes the image to Gemini Flash, Mistral, and Claude 3.5 Sonnet for
OCR evaluation. The `image` content type is required for that pipeline.
