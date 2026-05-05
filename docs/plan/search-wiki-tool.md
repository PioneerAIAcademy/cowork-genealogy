# Search Wiki Tool — Implementation Plan

**Endpoint used:**

- `POST {WIKI_API_URL}/search` — local `wiki-query-api` FastAPI server
  (separate repo: `wiki-query-api/`). Started with
  `python scripts/wiki/30_serve.py`.

## Summary

Build a `search_wiki` MCP tool that calls the locally-running
`wiki-query-api` endpoint and returns ranked FamilySearch Wiki sections
with source URLs.

The hard work (RAG pipeline: embed → Milvus hybrid → VoyageAI rerank) is
already implemented upstream. This MCP tool is a thin HTTP wrapper.

For v1: local-only, no authentication. Future deployment work is its own
project — the MCP code does not change for that, only its configured URL.

## Endpoint shape

**Request:**
```
POST http://localhost:8000/search
Content-Type: application/json

{ "query": "How do I find Italian birth records?" }
```

**Response:**
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

Up to 20 results. No `top_k` parameter — filtering happens upstream by
reranker score >= 0.5.

## Implementation Approach

1. Add `wikiApiUrl` to `AppConfig` (file-backed config at
   `~/.familysearch-mcp/config.json`).
2. Add a `getWikiApiUrl()` helper in `src/auth/config.ts` that reads
   it. Throws an LLM-instruction error if missing.
3. Implement `searchWiki(input)` in `src/tools/searchWiki.ts`:
   - Read URL from config.
   - POST to `{url}/search` with the query in the body.
   - Parse JSON, return as-is.
   - Map common HTTP errors and network failures to descriptive messages.
4. Register schema + dispatch in `src/index.ts`.
5. Add `try-search-wiki.ts` smoke script for fast iteration.

Matches the `wikipedia.ts` shape almost line-for-line. The only
structural difference: this tool reads a URL from config (where
Wikipedia is unauthenticated and hardcodes its base URL).

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

## Response Type

```typescript
interface WikiSearchResultItem {
  rank: number;
  relevance_score: number;
  chunk_text: string;
  page_title: string;
  section_heading: string;
  source_url: string;
}

interface WikiSearchResult {
  query: string;
  total_chunks_searched: number;
  results: WikiSearchResultItem[];
  query_time_ms: number;
  timing: {
    embed_ms: number;
    search_ms: number;
    rerank_ms: number;
  };
}
```

## Files to Create / Modify

1. `mcp-server/src/types/auth.ts` — add `wikiApiUrl` to `AppConfig`.
2. `mcp-server/src/auth/config.ts` — add `getWikiApiUrl()`.
3. `mcp-server/src/types/searchWiki.ts` — response types.
4. `mcp-server/src/tools/searchWiki.ts` — tool implementation.
5. `mcp-server/src/index.ts` — register the tool.
6. `mcp-server/scripts/try-search-wiki.ts` — smoke script.
7. `mcp-server/tests/tools/search-wiki.test.ts` — vitest unit tests.

## Implementation Steps

1. Confirm the local `wiki-query-api` is reachable
   (`curl http://localhost:8000/health`).
2. Add `wikiApiUrl` to `AppConfig` and `getWikiApiUrl()` helper.
3. Define response types in `src/types/searchWiki.ts`.
4. Implement `searchWiki()` and `searchWikiSchema` in
   `src/tools/searchWiki.ts`.
5. Wire into `src/index.ts` (import, list, dispatch).
6. Build (`npm run build`).
7. Write `try-search-wiki.ts`; run against the local URL.
8. Write vitest tests with mocked `fetch`.
9. Layer the four-stage end-to-end test (Inspector → Claude Code →
   Cowork WSL2 → Cowork native Windows).
10. Write `docs/search-wiki-tool-testing-guide.md` mirroring
    `wikipedia-tool-testing-guide.md`.
11. Run `/update-project-doc` to refresh `README.md` and `CLAUDE.md`.
12. Build and ship `.mcpb` via `./scripts/build-mcpb.sh`.

## Edge Cases

- **No results past the 0.5 threshold.** Server returns
  `results: []` — tool returns an empty array, not an error. Claude
  should handle "I couldn't find a relevant wiki section" gracefully.
- **wiki-query-api server not running.** The fetch fails with a
  network error — surface as
  `"Could not reach wiki-query-api at {url}. Is the server running?"`.
- **Cache hits.** Repeat queries skip the OpenAI embedding roundtrip
  upstream — observable as a much smaller `embed_ms`. No client-side
  handling needed.
- **Schema drift.** Upstream `pipeline_version` may change. The tool
  should not validate the response shape strictly — pass through
  whatever the server returns.

## Test Commands

```bash
# Smoke test the local API directly:
curl -X POST http://localhost:8000/search \
  -H "Content-Type: application/json" \
  -d '{"query":"How do I find Italian birth records?"}'

# Bypass the MCP harness and run the tool function directly:
cd mcp-server && npx tsx scripts/try-search-wiki.ts "Italian birth records"

# Vitest unit tests:
cd mcp-server && npx vitest run tests/tools/search-wiki.test.ts

# MCP Inspector against the built server:
npx @modelcontextprotocol/inspector node mcp-server/build/index.js
```

## Decisions

- **Local-only for v1, no authentication.** The simplest possible build:
  one URL, no headers, no env vars on the FastAPI side. When the
  wiki-query-api is eventually deployed for shared use, a `wikiApiKey`
  config field gets added then; that work does not block v1.
- **Dedicated `search_wiki` over generic `search({ provider })`** — `CLAUDE.md`
  recommends generic tools, but the existing precedents (`wikipedia_search`,
  `collections`) are per-provider. Match precedent for v1; consolidate when a
  second search provider exists.
- **Config file over env vars** — matches the OAuth client-ID convention in
  `src/auth/config.ts`. No env-var fallbacks.
- **No `top_k` parameter for v1** — upstream filters by reranker threshold.
  Add if context-window pressure shows up.
- **No client-side response caching** — upstream FastAPI already has an
  in-memory query embed cache.
