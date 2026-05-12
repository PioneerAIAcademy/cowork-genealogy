# Collection Detail Tool — Implementation Spec

## Overview

Extends the existing `collections` MCP tool with a third call mode: **detail
mode**, triggered by passing an `id` parameter. Detail mode returns the
FamilySearch search API response for a single collection **as-is**, with
HTML-bearing string fields converted to markdown.

This is a single-tool extension, not a new tool. The schema gains one
optional property (`id`); the return shape switches based on which input
mode was used. List-mode behavior is unchanged.

### Design rationale (stakeholder transcript, 2026-05-12)

> *Dallan:* "Let's just have it come back with the JSON. ... what if we
> return ... so return the JSON, just like this is? Except ... take that
> HTML content, and convert it to Markdown."

This is a thin adapter, not a curated client. No LLM enhancement, no field
selection, no structural flattening, no pre-parsing of GEDCOMX timestamps.
The upstream API response shape is the contract; the tool's only job is to
fetch it and convert HTML strings to markdown before returning.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | No* | Place name to search collection titles (list mode) |
| `placeIds` | number[] | No* | Internal collection place IDs (list mode) |
| `id` | string | No* | FamilySearch collection ID for single-collection detail (detail mode) |

*Exactly one of `query`, `placeIds`, or `id` must be provided.

### Input precedence

1. `id` — takes precedence; runs detail mode, silently ignores `query`/`placeIds`.
2. `query` — takes precedence over `placeIds` (existing behavior).
3. `placeIds` — used when neither `id` nor `query` is set.

Example:

```json
{ "id": "1473181" }
```

---

## Output

### List mode (unchanged)

When `id` is absent, the output is the existing `CollectionsResult`.

### Detail mode

When `id` is present, the output is the **raw FamilySearch response** from
`GET /service/search/hr/v2/collections/{id}?embedWikiAboutCollection=true`,
with exactly one modification applied:

- Every `documents[*]` whose `textType === "html"` has its `text` field
  converted to markdown AND its `textType` flipped to `"markdown"`.

**No other transformations.** Citations are left as-is (HTML tags
preserved). Per stakeholder direction (Dallan, 2026-05-12 meeting), only
the `documents` section is touched. Top-level keys, nesting, field names,
and data types match the FS response exactly. The TypeScript type is:

```typescript
export type CollectionDetailResult = FSCollectionDetailResponse;
```

### Example output for `id: "1473181"` (US Census 1860)

```json
{
  "sourceDescriptions": [
    {
      "id": "1473181",
      "about": "https://www.familysearch.org/platform/records/collections/1473181",
      "modified": "2026-04-21T13:18:12.810+00:00",
      "descriptions": [{ "value": "Name index and images...", "lang": "en_US" }],
      "citations": [
        { "value": "\"United States, Census, 1860.\" Database with images. <i>FamilySearch</i>. http://FamilySearch.org : 29 April 2026. ..." }
      ],
      "titles": [{ "value": "United States, Census, 1860", "lang": "en_US" }],
      "rights": ["http://familysearch.org/records/permissionGroup/FamilySearch"],
      "coverage": [
        {
          "spatial": { "original": "United States", "description": "1" },
          "temporal": { "original": "1860", "formal": "+1860" },
          "recordType": "http://gedcomx.org/Census"
        }
      ],
      "identifiers": {
        "http://gedcomx.org/Primary": ["https://www.familysearch.org/platform/records/collections/1473181"]
      }
    }
  ],
  "documents": [
    {
      "id": "1473181",
      "text": "# United States, Census, 1860\n\n## What is in This Collection?\n\nAn index of population schedules...",
      "textType": "markdown",
      "extracted": false
    }
  ],
  "collections": [
    {
      "id": "1473181",
      "title": "United States, Census, 1860",
      "content": [
        { "completeness": 0.99, "count": 27176265, "resourceType": "http://gedcomx.org/Record" },
        { "completeness": 0.99, "count": 28747506, "resourceType": "http://gedcomx.org/Person" },
        { "count": 703834, "resourceType": "http://gedcomx.org/DigitalArtifact#FamilySearch" }
      ],
      "searchMetadata": [
        {
          "imageCount": 703834,
          "recordCount": 27176265,
          "lastUpdated": 1776777492810,
          "typeFacet": "CENSUS",
          "startYear": 1860,
          "endYear": 1860,
          "region": "UNITED_STATES",
          "placeIds": [1]
        }
      ]
    }
  ],
  "description": "#1473181",
  "id": "1473181",
  "links": {
    "collection": { "href": "https://www.familysearch.org/service/search/hr/v2/collections/1473181?..." },
    "waypoints": { "href": "https://www.familysearch.org/service/cds/recapi/collections/1473181/waypoints" }
  }
}
```

Note that this shape **preserves GEDCOMX conventions**: the top-level
`description` is a `#id` ref, not text. Consumers of the tool resolve
that ref themselves when needed.

---

## Tool Schema

```typescript
{
  name: "collections",
  description:
    "List FamilySearch record collections for a place, OR get detailed " +
    "information about a single collection. Pass `query` (a place name) to " +
    "list, or `id` (a collection ID like \"1743384\") to get the FS API " +
    "response for that collection, with HTML strings (citations, Research " +
    "Wiki page) converted to markdown. Requires authentication — call the " +
    "login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      query:    { type: "string", description: "..." },
      placeIds: { type: "array",  items: { type: "number" }, description: "..." },
      id:       { type: "string", description: "..." }
    }
  }
}
```

---

## Authentication

Detail mode requires the same authentication as list mode. Calls
`getValidToken()` from `src/auth/refresh.js`. If the user is not logged in,
the LLM-instruction error propagates.

---

## FamilySearch API Reference

**Endpoint:**

```
GET https://www.familysearch.org/service/search/hr/v2/collections/{id}?embedWikiAboutCollection=true
Authorization: Bearer <access_token>
User-Agent: <browser-like user agent string>
```

User-Agent is required (FS WAF). Reuses the existing `USER_AGENT` constant.

The `?embedWikiAboutCollection=true` query parameter triggers FS to embed
the FamilySearch Research Wiki "about" page as HTML in `documents[0].text`.
Without the flag, `documents` is absent.

---

## HTML → Markdown Conversion

Uses [`turndown`](https://www.npmjs.com/package/turndown) (MIT, ~600K
weekly downloads). Single module-level instance:

```typescript
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});
turndown.remove(["head", "title", "style", "script"]);
turndown.addRule("dropHidden", {
  filter: (node) => /display\s*:\s*none/i.test(
    (node as HTMLElement).getAttribute?.("style") ?? ""
  ),
  replacement: () => "",
});
```

The `remove` and `dropHidden` rules neutralize four quirks observed in
live wiki HTML:

| Quirk | Without the rule | With the rule |
|-------|------------------|---------------|
| `<title>` hoisted out of `<head>` by DOM normalization | Title duplicated above the H1 | Dropped |
| `<style>` CSS rendered as plain text | Long CSS preamble | Dropped |
| `<script>` content rendered as plain text | Code visible | Dropped |
| MediaWiki `{{{CID*}}}` placeholders inside `<div style="display: none">` | Visible noise | Dropped |

### `htmlToMarkdown(html)` helper

- Returns `null` for null/undefined/empty input.
- Returns `null` when conversion yields only whitespace.
- Otherwise returns the trimmed markdown string.

### `convertHtmlToMarkdown(response)` helper

Walks the response and produces a new object with:

- Each `documents[*]` with `textType === "html"` has its `text` replaced by markdown and `textType` flipped to `"markdown"`.
- All other fields passed through unchanged, including `sourceDescriptions[*].citations[*].value` (citations stay as raw HTML).

---

## Caching

Detail-mode calls are **not** cached. Single HTTP call per `id`.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| None of `query`, `placeIds`, `id` provided | Throw existing error from list mode (unchanged) |
| Not authenticated | Let `getValidToken()` throw |
| 404 from upstream | Throw: `"No FamilySearch collection found with id \"{id}\". Use collections({ query: ... }) to list available collections."` |
| Non-OK status other than 404 | Throw: `"FamilySearch collection detail API error: {status} {statusText}"` |
| Upstream 200 but malformed JSON | Throw: `"FamilySearch collection detail API returned malformed response."` |

---

## Files

### `mcp-server/package.json` (MODIFIED)

Adds `turndown` to `dependencies` and `@types/turndown` to `devDependencies`.

### `mcp-server/src/types/collection.ts` (MODIFIED)

Adds API types for the detail response. `CollectionDetailResult` is a
type alias for `FSCollectionDetailResponse` — no curated shape.

### `mcp-server/src/tools/collections.ts` (MODIFIED)

- Add `id?: string` to `CollectionsToolInput`.
- Detail-mode branch in `collectionsTool()`: fetch + convert + return.
- Module-level `turndown` instance with rules above.
- Exported helpers (for testing):
  - `fetchCollectionDetail(token, id)` — HTTP call with the embed flag.
  - `htmlToMarkdown(html)` — single-string conversion.
  - `convertHtmlToMarkdown(response)` — walks the response per the rules.
- Update `collectionsToolSchema` to add the `id` property.

### `mcp-server/dev/try-collection-detail.ts` (NEW)

```bash
npx tsx dev/try-collection-detail.ts 1473181        # US Census 1860 (wiki present)
npx tsx dev/try-collection-detail.ts 1743384        # Alabama Marriages
npx tsx dev/try-collection-detail.ts 9999999        # 404 message
```

### `mcp-server/dev/probe-collection-detail.ts` (CANONICAL)

Documents the endpoint investigation and the RESULTS table.

---

## Testing

### Helper-level tests

- `htmlToMarkdown`: emphasis conversion, headings/links, null cases, head/style/script removal, hidden-element removal.
- `convertHtmlToMarkdown`: citation conversion, document conversion (textType flip), non-html docs unchanged, preserves all other fields.

### Integration tests (`collectionsTool` detail mode)

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns FS response shape, no `{ collection: ... }` wrapper | Pass-through shape |
| 2 | Citation HTML inside sourceDescriptions converted | `<i>` → `*` |
| 3 | documents[0].text converted; textType flipped | wiki content as markdown |
| 4 | Container-parent SD preserved (no stripping) | Faithful pass-through |
| 5 | searchMetadata preserved inside collections[0] | Nested data intact |
| 6 | Single HTTP call | No list-cache dual-fetch |
| 7 | Friendly 404 error | Exact message |
| 8 | Generic API error on non-404 | Status in message |
| 9 | Auth error propagates; no fetch | Defensive |
| 10 | Malformed response throws | Defensive |
| 11 | `id` wins over `query` | Input precedence |

### Smoke

```bash
cd mcp-server
npx tsx dev/try-collection-detail.ts 1473181
npx tsx dev/try-collection-detail.ts 1743384
npx tsx dev/try-collection-detail.ts 9999999
npx tsx dev/try-collections.ts Alabama
```

---

## Verification

### Automated

```bash
cd mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)

- `collections({ id: "1473181" })` → returns FS pass-through with markdown wiki
- `collections({ id: "9999999" })` → friendly 404
- `collections({ query: "Alabama" })` → list mode unchanged
- `collections({ id, query })` → detail returned, query dropped

### Manual Layer 2 (Cowork)

Natural-language prompts:

- *"Tell me more about FamilySearch collection 1473181"*
- *"What's the citation for collection 1743384?"*
- *"Show me the wiki page for collection 1473181"*

Layer 2 testing inside this dev repo is unreliable — Claude finds
`dev/try-collection-detail.ts` and runs it via Bash. Run Layer 2 in Cowork.

---

## Out of Scope

- Lifting `USER_AGENT` into a shared `src/util/userAgent.ts` module.
- Per-id detail caching.
- Curating the response shape (handpicking fields, flattening, parsing
  GEDCOMX timestamps) — explicitly rejected per stakeholder direction.
- A separate `collection` (singular) tool — single-tool extension chosen
  per the `places` precedent.
