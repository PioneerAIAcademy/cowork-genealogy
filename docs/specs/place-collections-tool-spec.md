# Place Collections Tool — Implementation Spec

## Overview

An MCP tool that returns FamilySearch record collections for a place
(list mode), or detailed information about a single collection (detail
mode). Requires authentication (OAuth tokens obtained via the `login`
tool).

The tool has two input modes:

- **List mode** — Pass `query` (a place name string like `"Alabama"`).
  Returns the matching collections with record, person, and image
  counts.
- **Detail mode** — Pass `id` (a FamilySearch collection ID like
  `"1473181"`). Returns the FamilySearch search API response for that
  collection **as-is**, with HTML-bearing string fields converted to
  markdown.

Detail mode is a thin adapter, not a curated client. The upstream API
response shape is the contract; the tool's only job in detail mode is
to fetch it and convert HTML strings to markdown before returning.

### Place ID mismatch (design note)

The FamilySearch Places API (`/platform/places/`) and the Collections
API (`/service/search/hr/v2/collections`) use **different place ID
systems**. Alabama is 351 in the Places API but 33 in the Collections
API. These IDs are not interchangeable.

The `query` parameter was added to work around this — Claude passes
the place name (e.g., `"Alabama"`) directly to the collections tool
and filters by collection title. The `place_search` tool is still
useful for disambiguation (e.g., which "Madison"?) but its IDs are
not passed to `place_collections`.

### Detail-mode design rationale (stakeholder transcript, 2026-05-12)

> *Dallan:* "Let's just have it come back with the JSON. ... what if we
> return ... so return the JSON, just like this is? Except ... take that
> HTML content, and convert it to Markdown."

No LLM enhancement, no field selection, no structural flattening, no
pre-parsing of GEDCOMX timestamps.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | No* | Place name to search collection titles (list mode) |
| `id` | string | No* | FamilySearch collection ID for single-collection detail (detail mode) |

*Exactly one of `query` or `id` must be provided. (The former `placeIds`
list-mode input — a separate collections-internal id-space — has been removed;
use `query` with a place name.)

### Input precedence

1. `id` — takes precedence; runs detail mode, silently ignores `query`.
2. `query` — used when `id` is not set; runs list mode.

`query` is the only list-mode input.

Examples:

```json
{ "query": "Alabama" }        // list mode
{ "id": "1473181" }           // detail mode
```

---

## Output

### List mode

When `id` is absent:

| Field | Type | Description |
|-------|------|-------------|
| `query` | string? | Echo of the query input (present when supplied) |
| `matchingCollections` | number | Total count of matching collections |
| `collections` | Collection[] | The matching collection objects |

Each `Collection` object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | FamilySearch collection identifier |
| `title` | string | Human-readable collection name |
| `dateRange` | string | Time period the collection covers (e.g., `"1809-1950"`) |
| `recordCount` | number | Number of records in the collection |
| `personCount` | number | Number of persons in the collection |
| `imageCount` | number | Number of images in the collection |
| `url` | string | Link to the collection on FamilySearch |

Example:
```json
{
  "query": "Alabama",
  "matchingCollections": 29,
  "collections": [
    {
      "id": "1743384",
      "title": "Alabama County Marriages, 1711-1992",
      "dateRange": "1711-1992",
      "recordCount": 6049744,
      "personCount": 22361103,
      "imageCount": 1231203,
      "url": "https://www.familysearch.org/search/collection/1743384"
    }
  ]
}
```

### Detail mode

When `id` is present, the output is the **raw FamilySearch response**
from `GET /service/search/hr/v2/collections/{id}?embedWikiAboutCollection=true`,
with exactly one modification applied:

- Every `documents[*]` whose `textType === "html"` has its `text` field
  converted to markdown AND its `textType` flipped to `"markdown"`.

**No other transformations.** Citations are left as-is (HTML tags
preserved). Per stakeholder direction (Dallan, 2026-05-12 meeting),
only the `documents` section is touched. Top-level keys, nesting,
field names, and data types match the FS response exactly. The
TypeScript type is:

```typescript
export type CollectionDetailResult = FSCollectionDetailResponse;
```

Example output for `id: "1473181"` (US Census 1860):

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

Note: the response **preserves GEDCOMX conventions** — the top-level
`description` is a `#id` ref, not text. Consumers resolve that ref
themselves when needed.

---

## Tool Schema

```typescript
{
  name: "place_collections",
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
      query: {
        type: "string",
        description: "Place name to search for in collection titles (e.g., \"Alabama\", \"England\"). Use the place_search tool first to disambiguate if needed."
      },
      id: {
        type: "string",
        description: "FamilySearch collection ID (e.g., \"1473181\"). Returns detailed information about that collection."
      }
    }
  }
}
```

---

## Authentication

Both list mode and detail mode require a valid FamilySearch access
token. The tool must call `getValidToken()` from `src/auth/refresh.ts`
— the single entry point for all authenticated tools. Do not
re-implement token plumbing.

If the user is not authenticated, `getValidToken()` throws an
LLM-instruction error directing the user to call the `login` tool. The
tool handler should let this error propagate.

---

## FamilySearch API Reference

### List mode endpoint

```
GET https://www.familysearch.org/service/search/hr/v2/collections
Authorization: Bearer <access_token>
User-Agent: <browser-like user agent string>
```

**Important:** The `User-Agent` header is required. FamilySearch's WAF
(Imperva/Incapsula) blocks requests without a browser-like user agent,
returning a 403 with `"This request was blocked by our security service"`.

**Query parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `count` | `5000` | Return all collections in a single call |
| `offset` | `0` | Pagination offset |
| `facets` | `OFF` | Disable facet aggregation |

**API response shape (GEDCOMX-wrapped):**

The response is NOT a flat array. Each entry is wrapped in GEDCOMX format:

```
response.entries[].content.gedcomx.collections[0]
```

Each collection object contains:
- `id` — collection identifier
- `title` — human-readable name (e.g., `"Alabama County Marriages, 1711-1992"`)
- `content[]` — array of counts by `resourceType` (`/Record`, `/Person`, `/DigitalArtifact`)
- `searchMetadata[0]` — contains `placeIds` (number array), `startYear`, `endYear`, `imageCount`, `recordCount`

**Key API details:**

- The lower-level API (`/service/search/hr/v2/collections`) was chosen
  over the platform API (`/platform/records/collections`) because the
  platform API does not include counts — it would require N+1 calls.
- Place IDs in `searchMetadata.placeIds` are internal to the collections
  system and do NOT match the Places API IDs.
- Some collections have access restrictions (church membership,
  FamilySearch Center access). The API respects these based on the
  user's session.

### Detail mode endpoint

```
GET https://www.familysearch.org/service/search/hr/v2/collections/{id}?embedWikiAboutCollection=true
Authorization: Bearer <access_token>
User-Agent: <browser-like user agent string>
```

User-Agent is required for the same WAF reason; reuses the shared
`BROWSER_USER_AGENT` constant.

The `?embedWikiAboutCollection=true` query parameter triggers FS to
embed the FamilySearch Research Wiki "about" page as HTML in
`documents[0].text`. Without the flag, `documents` is absent.

---

## Filtering Logic (list mode)

**Query mode:** Case-insensitive substring match against collection
titles. `"Alabama"` matches any collection whose title contains
"Alabama" (e.g., `"Alabama, County Marriages, 1711-1992"`).

---

## HTML → Markdown Conversion (detail mode)

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

## Error Handling

### List mode

| Condition | Behavior |
|-----------|----------|
| Neither `query` nor `id` provided | Throw error with usage instructions |
| Not authenticated | Let `getValidToken()` throw its LLM-instruction error ("User is not logged in to FamilySearch. Call the login tool to authenticate.") |
| API returns non-OK status | Throw error: `"FamilySearch collections API error: {status} {statusText}"` |
| API returns empty/malformed response | Return `{ matchingCollections: 0, collections: [] }` |

### Detail mode

| Condition | Behavior |
|-----------|----------|
| Not authenticated | Let `getValidToken()` throw |
| 404 from upstream | Throw: `"No FamilySearch collection found with id \"{id}\". Use place_collections({ query: ... }) to list available collections."` |
| Non-OK status other than 404 | Throw: `"FamilySearch collection detail API error: {status} {statusText}"` |
| Upstream 200 but malformed JSON | Throw: `"FamilySearch collection detail API returned malformed response."` |

---

## Caching

**List mode:** The full collection list (~3400 entries) changes
infrequently. Cache the API response for 1 hour to avoid re-fetching
on every call. The cache is keyed on the access token (different users
may see different collections due to access restrictions).

**Detail mode:** Not cached. Single HTTP call per `id`.

---

## Files

### `mcp-server/package.json`

Adds `turndown` to `dependencies` and `@types/turndown` to
`devDependencies` (detail mode dependency).

### `mcp-server/src/types/collection.ts`

API response types (`FSCollectionEntry`, `FSCollectionsResponse`,
`FSCollectionDetailResponse`, etc.) and output types (`Collection`,
`CollectionsResult`, `CollectionDetailResult`). `CollectionDetailResult`
is a type alias for `FSCollectionDetailResponse` — no curated shape.

### `mcp-server/src/tools/place-collections.ts`

- `placeCollectionsToolSchema` — MCP tool schema (with `id` property)
- `placeCollectionsTool(input)` — main function (routes by input mode)
- `fetchAllCollections(token)` — cached list-mode API call
- `fetchCollectionDetail(token, id)` — detail-mode API call (with the embed flag)
- `filterByQuery(entries, query)` — case-insensitive title matching
- `htmlToMarkdown(html)` — single-string HTML→markdown conversion
- `convertHtmlToMarkdown(response)` — walks the detail response per the rules
- Module-level `turndown` instance with the rules above
- `clearCollectionsCache()` — for testing

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools, CallTool).

### `mcp-server/dev/try-place-collections.ts`

Smoke-test script for list mode.

### `mcp-server/dev/try-collection-detail.ts`

Smoke-test script for detail mode:

```bash
npx tsx dev/try-collection-detail.ts 1473181        # US Census 1860 (wiki present)
npx tsx dev/try-collection-detail.ts 1743384        # Alabama Marriages
npx tsx dev/try-collection-detail.ts 9999999        # 404 message
```

### `mcp-server/dev/probe-collection-detail.ts` (CANONICAL)

Documents the endpoint investigation and the RESULTS table for detail mode.

---

## Testing

### `tests/tools/place-collections.test.ts`

**List-mode integration tests:**

| # | Test case | What it verifies |
|---|-----------|------------------|
| 1 | Returns collections matching a place name query | Query happy path |
| 2 | Query matching is case-insensitive | Case handling |
| 3 | Returns empty array when query matches no titles | Query zero-match |
| 4 | Query matches anywhere in the title | Substring matching |
| 5 | Throws auth error when not authenticated | Auth propagation |
| 6 | Throws on non-OK API response | HTTP error handling |
| 7 | Handles malformed API response gracefully | Empty/null response |
| 8 | Throws when neither query nor id provided | Input validation |
| 9 | Maps API response fields to Collection shape | Field mapping |

**Detail-mode helper tests:**

- `htmlToMarkdown`: emphasis conversion, headings/links, null cases, head/style/script removal, hidden-element removal.
- `convertHtmlToMarkdown`: citation conversion, document conversion (textType flip), non-html docs unchanged, preserves all other fields.

**Detail-mode integration tests (`placeCollectionsTool` detail mode):**

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
npx tsx dev/try-place-collections.ts Alabama
npx tsx dev/try-place-collections.ts England
npx tsx dev/try-collection-detail.ts 1473181
npx tsx dev/try-collection-detail.ts 1743384
npx tsx dev/try-collection-detail.ts 9999999
```

---

## Verification

### Automated
```bash
cd mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)
```bash
npx @modelcontextprotocol/inspector node build/index.js
```

- `place_collections({ query: "Alabama" })` — returns 29 Alabama collections
- `place_collections({ query: "England" })` — returns England collections
- `place_collections({ query: "xyznonexistent" })` — returns empty list
- `place_collections({ id: "1473181" })` — returns FS pass-through with markdown wiki
- `place_collections({ id: "9999999" })` — friendly 404
- `place_collections({ id, query })` — detail returned, query dropped
- `place_collections` without logging in — returns auth error message

### Manual Layer 2 (Claude Code / Cowork)

- "What FamilySearch collections cover Alabama?" — Claude should call `place_collections` with query `"Alabama"` and present the results.
- "Tell me more about FamilySearch collection 1473181" — Claude should call `place_collections` with `id: "1473181"` and present the wiki + citation.
- "What's the citation for collection 1743384?" — same pattern with the citation field highlighted.
- "Show me the wiki page for collection 1473181" — Claude should call `place_collections` with `id` and present `documents[0].text`.

Layer 2 testing inside this dev repo is unreliable — Claude finds
`dev/try-collection-detail.ts` and runs it via Bash. Run Layer 2 in Cowork.

---

## Out of Scope

- A separate `collection` (singular) tool — detail mode is a single-tool
  extension of `place_collections`, per the `place_search` precedent.
- Per-id detail caching.
- Curating the detail response shape (handpicking fields, flattening,
  parsing GEDCOMX timestamps) — explicitly rejected per stakeholder
  direction.
