# Search Wiki Tool — Implementation Spec

## Overview

Add a `search_wiki` tool that calls the locally-running `wiki-query-api`
FastAPI server and returns ranked FamilySearch Wiki sections with source
URLs. The retrieval pipeline (embed → Milvus hybrid → VoyageAI rerank →
0.5 threshold) is already implemented in the upstream API; this tool is a
thin HTTP wrapper.

For v1, the tool runs against the local FastAPI server only — no
authentication. Adding auth (and pointing at a deployed URL) is a future
follow-up; the MCP code does not need to change for that — only the
configured URL.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | A natural-language genealogy question |

Example:
```json
{ "query": "How do I find Italian birth records?" }
```

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | Echoes the input |
| `total_chunks_searched` | number | Total chunks in the index |
| `results` | array | Ranked wiki sections (up to 20, filtered by 0.5 reranker threshold) |
| `query_time_ms` | number | End-to-end latency |
| `timing` | object | `embed_ms`, `search_ms`, `rerank_ms` |

Each `results[]` entry:

| Field | Type | Description |
|-------|------|-------------|
| `rank` | number | 1-indexed rank in this response |
| `relevance_score` | number | VoyageAI reranker score (0–1) |
| `chunk_text` | string | The wiki section body |
| `page_title` | string | Wiki page title |
| `section_heading` | string | The H1/H2/H3 heading the chunk came from |
| `source_url` | string | Direct link to the wiki page (with anchor when available) |

Example:
```json
{
  "query": "How do I find Italian birth records?",
  "total_chunks_searched": 1229322,
  "results": [
    {
      "rank": 1,
      "relevance_score": 0.8612,
      "chunk_text": "Civil registration of births in Italy began...",
      "page_title": "Italy Civil Registration",
      "section_heading": "Birth Records",
      "source_url": "https://www.familysearch.org/en/wiki/Italy_Civil_Registration#Birth_Records"
    }
  ],
  "query_time_ms": 612.4,
  "timing": { "embed_ms": 84.1, "search_ms": 412.7, "rerank_ms": 115.6 }
}
```

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Missing `wikiApiUrl` in config | Throw LLM-instruction error: `"wiki-query-api MCP not configured. Create ~/.familysearch-mcp/config.json with { \"wikiApiUrl\": \"http://localhost:8000\" } and start the wiki-query-api server."` |
| 5xx from API | Throw: `"wiki-query-api error: {status}"` |
| Network failure | Throw: `"Could not reach wiki-query-api at {url}. Is the server running?"` |

Match the LLM-instruction error pattern used by `getValidToken()` in
`src/auth/refresh.ts` — error messages must tell Claude what to do next.

---

## wiki-query-api Endpoint Reference

**Endpoint:**
```
POST {WIKI_API_URL}/search
Content-Type: application/json

{ "query": "..." }
```

`top_k` is not a request parameter — the server returns up to 20 results
filtered by reranker threshold. See `wiki-query-api/CLAUDE.md` for the
upstream pipeline details.

`{WIKI_API_URL}` is `http://localhost:8000` for local development. The
upstream server is started with `python scripts/wiki/30_serve.py` from
the `wiki-query-api/` repo.

---

## Files to Create

### 1. `mcp-server/src/types/searchWiki.ts`

Define two types:

- `WikiSearchAPIResponse` — the FastAPI endpoint's response shape.
- `WikiSearchResult` — what the tool returns to Claude (identical to
  `WikiSearchAPIResponse` for v1; separate type leaves room for trimming
  later if context size becomes an issue).

### 2. `mcp-server/src/tools/searchWiki.ts`

Contains:

- `searchWikiSchema` — MCP tool schema (name, description, inputSchema).
- `searchWiki(input)` — async function that reads URL from config, POSTs
  to `/search`, returns parsed JSON.

### 3. `mcp-server/scripts/try-search-wiki.ts`

One-shot smoke script matching `try-wikipedia.ts`. Bypasses the MCP
harness for fast iteration.

### 4. `mcp-server/tests/tools/search-wiki.test.ts`

Vitest unit tests with mocked `fetch`. Covers happy path, missing URL,
non-2xx response, and network failure.

---

## Files to Modify

### `mcp-server/src/types/auth.ts`

Add one optional field to `AppConfig`:

```typescript
wikiApiUrl?: string;
```

### `mcp-server/src/auth/config.ts`

Add a `getWikiApiUrl()` helper modeled on `getClientId()`:

```typescript
export async function getWikiApiUrl(): Promise<string>
```

Throws an LLM-instruction error if the field is missing. This is the
single source of wiki-query-api connection info — `searchWiki()` must use
it instead of hardcoding the URL.

### `mcp-server/src/index.ts`

Three additions, mirroring `wikipedia_search`:

1. Import `searchWiki`, `searchWikiSchema`, `SearchWikiInput`.
2. Add `searchWikiSchema` to the `tools` array in `ListToolsRequestSchema`.
3. Add the `if (request.params.name === "search_wiki")` block in
   `CallToolRequestSchema`.

---

## Tool Schema

```typescript
{
  name: "search_wiki",
  description: "Search the FamilySearch Wiki for genealogy guidance. Use this when the user asks how to find records (birth, marriage, death, census, immigration, military, church), how to research ancestors from a specific country or region, or how to use FamilySearch resources. Returns up to 20 wiki sections with source URLs.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A natural-language genealogy question"
      }
    },
    required: ["query"]
  }
}
```

The description string is the trigger Claude reads to decide when to call
this tool — sharpening it later does not require code changes anywhere
else.

---

## Patterns to Follow

Match the style of `mcp-server/src/tools/wikipedia.ts`:

- `const` for constants where applicable.
- POST with `Content-Type: application/json`.
- Parse response as JSON and map to the result type.
- Throw descriptive errors that tell Claude what went wrong + what to do.

For config, match `src/auth/config.ts`'s `getClientId()` pattern — read
from `~/.familysearch-mcp/config.json`, no env-var fallbacks.

---

## Out of Scope for v1

- **Authentication.** v1 talks to a local server; no auth needed. When
  the wiki-query-api is deployed publicly, add API-key auth on both
  sides as a separate follow-up. The MCP code only needs a new optional
  `wikiApiKey` config field at that point.
- **A `top_k` parameter.** Server returns up to 20; filter client-side
  later if needed.
- **A `provider` parameter.** `CLAUDE.md` recommends a generic `search`
  tool with a `provider` field, but this v1 ships a dedicated
  `search_wiki` matching the `wikipedia_search` / `collections`
  precedent. Consolidate when a second search provider exists.
- **Response caching at the MCP layer.** The upstream FastAPI already has
  an in-memory query embed cache.
- **Streaming results.** The FastAPI returns the full response in one shot.
