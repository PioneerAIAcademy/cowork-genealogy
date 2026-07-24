# Collection Read Tool — Implementation Spec

## Overview

`collection_read` fetches detailed information about a **single** FamilySearch
record collection by its collection `id` and returns the FamilySearch API
response with its HTML content converted to markdown.

It is the read half of the search/read pair `collections_search` /
`collection_read`, mirroring `record_search` / `record_read` and
`person_search` / `person_read`. It was split out of the detail-by-`id`
mode of the former `place_collections` tool (now `collections_search`) (see
`docs/specs/collections-search-tool-spec.md`); `collections_search` now lists
collections for a place (list mode only), and `collection_read` fetches one.

```
collections_search({ standardPlace })  →  lists collections (with their ids)
collection_read({ id })                →  full detail for one collection   ← this tool
```

Requires authentication (OAuth) — the same `getValidToken()` path every
authenticated tool uses.

## Endpoint

```
GET https://www.familysearch.org/service/search/hr/v2/collections/{id}?embedWikiAboutCollection=true
```

Sent with the shared `BROWSER_USER_AGENT` and the bearer token.

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **Yes** | FamilySearch collection ID (e.g., `"1743384"`). Discover it via `collections_search({ standardPlace })`. |

## Output

A pass-through of the FamilySearch collection-detail response
(`FSCollectionDetailResponse`) — `description`, `sourceDescriptions`,
`collections`, `documents` — with two adjustments:

- `documents[*].text` is converted from HTML to markdown when
  `textType === "html"`, and that document's `textType` is flipped to
  `"markdown"`. This is the embedded FamilySearch Research Wiki "about this
  collection" page.
- **Citations stay as HTML.** `sourceDescriptions[*].citations[*].value` is
  **not** converted (per stakeholder direction, Dallan 2026-05-12) — only
  `documents[*].text` is.

No wrapping envelope is added (no `{ collection: ... }`); the FS response shape
is returned as-is apart from the markdown conversion. Container-parent
`sourceDescriptions` and the inline `collections[0].searchMetadata` are
preserved untouched.

## Tool Schema

```typescript
export const collectionReadToolSchema = {
  name: "collection_read",
  description:
    "Get detailed information about a single FamilySearch record collection by " +
    "id (a collection ID like \"1743384\", from collections_search). Returns the " +
    "FamilySearch API response for that collection (sourceDescriptions, documents, " +
    "collections), with HTML content (the FS Research Wiki page in documents[*].text) " +
    "converted to markdown; the formal citation stays as HTML. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "FamilySearch collection ID (e.g., \"1743384\"). Returns the FS API " +
          "response for that collection (sourceDescriptions, documents, " +
          "collections), with the Research Wiki page converted to markdown. " +
          "Use collections_search (standardPlace) first to discover the ID.",
      },
    },
    required: ["id"],
  },
};
```

## Authentication

Required. `getValidToken()` (see `packages/engine/mcp-server/src/auth/`) loads/refreshes the
OAuth token and throws the login-instruction error when no valid session
exists.

## HTML → Markdown Conversion

Uses `turndown` (`headingStyle: "atx"`, `codeBlockStyle: "fenced"`,
`emDelimiter: "*"`), removing `head`/`title`/`style`/`script` and dropping
elements with `display: none` (MediaWiki template placeholders). `htmlToMarkdown`
returns `null` for empty/whitespace-only input. `convertHtmlToMarkdown` maps
only `documents[*]` where `textType === "html"`.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| `id` not provided | Throw: `"collection_read requires an id (a collection ID like \"1743384\"). Use collections_search({ standardPlace: ... }) to discover collection IDs."` |
| 404 from upstream | Throw: `"No FamilySearch collection found with id \"{id}\". Use collections_search({ standardPlace: ... }) to list available collections."` |
| Other non-OK status | Throw: `"FamilySearch collection detail API error: {status} {statusText}"` |
| Malformed JSON | Throw: `"FamilySearch collection detail API returned malformed response."` |
| Not authenticated | `getValidToken()` throws the login-instruction error before any fetch. |

## Files

| File | Action |
|------|--------|
| `packages/engine/mcp-server/src/tools/collection-read.ts` | Tool + schema; `collectionReadTool`, `collectionReadToolSchema`, plus the relocated `htmlToMarkdown` / `fetchCollectionDetail` / `convertHtmlToMarkdown` helpers (extracted out of `collections-search.ts`, formerly `place-collections.ts`). |
| `packages/engine/mcp-server/src/types/collection.ts` | Shared with `collections_search`; `CollectionDetailResult` (= `FSCollectionDetailResponse`) lives here. |
| `packages/engine/mcp-server/src/tool-schemas.ts` | Import + add `collectionReadToolSchema` to `allToolSchemas`. |
| `packages/engine/mcp-server/src/index.ts` | `if (request.params.name === "collection_read") { ... }` dispatch. |
| `packages/engine/mcp-server/manifest.json` | Add `{ "name": "collection_read" }`. |
| `packages/engine/mcp-server/dev/try-collection-read.ts` | Smoke test (`npx tsx dev/try-collection-read.ts 1743384`). |
| `packages/engine/mcp-server/tests/tools/collection-read.test.ts` | Unit tests (HTML→markdown, pass-through shape, 404/500/malformed/auth errors, missing id). |

## Testing

- `htmlToMarkdown` / `convertHtmlToMarkdown` unit cases (emphasis, headings,
  links, `display:none`/`<head>`/`<script>` stripping, citations untouched,
  textType flip, other top-level fields preserved).
- `collection_read` pass-through: returns the FS shape (no wrapper),
  preserves container-parent `sourceDescriptions` and inline
  `searchMetadata`, makes exactly one fetch (the detail endpoint).
- Errors: friendly 404 (pointing at `collections_search`), generic non-404,
  malformed JSON, auth, and missing `id`.

## Out of Scope

- Listing collections for a place — that is `collections_search`.
- Converting citation HTML — citations stay as HTML by design.
