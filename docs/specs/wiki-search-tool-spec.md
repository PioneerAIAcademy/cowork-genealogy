# Wiki Search Tool — Implementation Spec

## Overview

`wiki_search` calls the `wiki-query-api` FastAPI server's `POST /search` and
returns the FamilySearch Wiki sections that match a question, most relevant
first. The retrieval pipeline (embed → Milvus hybrid → VoyageAI rerank → 0.5
threshold) lives in the upstream API; this tool is an HTTP wrapper that shapes
the answer.

The server is hosted. By default the tool calls `DEFAULT_WIKI_API_URL`
(`src/auth/config.ts`), a publicly reachable host every install reaches, with no
authentication. `wikiApiUrl` in `~/.familysearch-mcp/config.json` overrides it —
`http://localhost:8000` points it at a local development instance.

By default each result is a **reference** — page title, section heading and
URL. `includeText: true` adds each section's text, cleaned and bounded (see
**Answer compaction**).

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | A natural-language genealogy question |
| `includeText` | boolean | No | `true` adds each section's text as `chunk_text`. Default: references only. Only boolean `true` opts in. |

Example:
```json
{ "query": "How do I find Italian birth records?", "includeText": true }
```

`includeText` is the tool's own parameter; it is never sent to the server, whose
request body stays `{ "query": "..." }`.

---

## Output

The server's envelope, with each result cut down:

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | The query as the server ran it |
| `total_chunks_searched` | number | Total chunks in the index |
| `results` | array | Matching wiki sections, most relevant first (up to 20, filtered by the 0.5 reranker threshold) |
| `query_time_ms` | number | End-to-end latency |
| `timing` | object | `embed_ms`, `search_ms`, `rerank_ms` |

Each `results[]` entry:

| Field | Type | When | Description |
|-------|------|------|-------------|
| `page_title` | string | always | Wiki page title |
| `section_heading` | string | always | The H1/H2/H3 heading the section came from |
| `source_url` | string | always | Direct link to the wiki page (with anchor when available) |
| `source` | string | when the server's `source` is not `"wiki"` | The corpus the result came from |
| `chunk_text` | string | `includeText`, and the text fit | The section's text, cleaned |
| `same_text_as` | number | `includeText`, and the text repeats an earlier result's | 0-based index in the returned `results` of the earlier result carrying that text |

A result never carries both `chunk_text` and `same_text_as`. Under
`includeText`, a result with neither is one whose text did not fit under the cap.

The server's `rank`, `relevance_score` and `source_subtype` are dropped in both
shapes. Position in `results` is the rank.

Example, references (the default):
```json
{
  "query": "How do I find Italian birth records?",
  "total_chunks_searched": 1229322,
  "results": [
    {
      "page_title": "Italy Civil Registration",
      "section_heading": "Birth Records",
      "source_url": "https://www.familysearch.org/en/wiki/Italy_Civil_Registration#Birth_Records"
    }
  ],
  "query_time_ms": 612.4,
  "timing": { "embed_ms": 84.1, "search_ms": 412.7, "rerank_ms": 115.6 }
}
```

Example, `includeText: true`, where result 2 repeats result 0's text and result 3
did not fit:
```json
{
  "query": "How do I find Italian birth records?",
  "total_chunks_searched": 1229322,
  "results": [
    {
      "page_title": "Italy Civil Registration",
      "section_heading": "Birth Records",
      "source_url": "https://www.familysearch.org/en/wiki/Italy_Civil_Registration#Birth_Records",
      "chunk_text": "Civil registration of births in Italy began..."
    },
    {
      "page_title": "Italy Church Records",
      "section_heading": "Baptisms",
      "source_url": "https://www.familysearch.org/en/wiki/Italy_Church_Records#Baptisms",
      "chunk_text": "Parish priests recorded baptisms..."
    },
    {
      "page_title": "Italy Civil Registration",
      "section_heading": "Birth Records",
      "source_url": "https://www.familysearch.org/en/wiki/Italy_Civil_Registration#Birth_Records",
      "same_text_as": 0
    },
    {
      "page_title": "Italy Genealogy",
      "section_heading": "Research Tips",
      "source_url": "https://www.familysearch.org/en/wiki/Italy_Genealogy#Research_Tips"
    }
  ],
  "query_time_ms": 612.4,
  "timing": { "embed_ms": 84.1, "search_ms": 412.7, "rerank_ms": 115.6 }
}
```

---

## Answer compaction

**Why references by default.** The server returns up to 20 sections of up to a
few thousand characters each, so a text answer can run to tens of thousands of
characters. The agent that calls this tool most, `locality-guide`, mostly uses the
page URLs and reads the page it needs with `wiki_read`. References keep that use
cheap; the two agents that synthesize from the section text
(`search-familysearch-wiki`, `historical-context`) pass `includeText: true`
(lead, 2026-11-09). The other holders (`gps-mentor`, `search-records`,
`search-full-text`) get references with no body change; `gps-mentor` holds no
`wiki_read`, so it cites the URLs (session owner, 2026-11-12).

`compactWikiSearchAnswer(answer, includeText)` in `src/tools/wiki-search.ts` is
the whole rule. It is a pure exported function (it never mutates its input),
called by the tool on the server's answer and by the eval harness on a canned
fixture (`eval/harness/harness/mock_mcp.py`, `_compact_wiki_search`, through the
compiled build, with the call's own `includeText`), so a unit run sees the shape
production sends. In order:

1. **The envelope** is copied as the server sent it; `results` is rebuilt.
2. **Each result** becomes `{ page_title, section_heading, source_url }`, plus
   `source` when it is a string other than `"wiki"`. Server order is kept. Without
   `includeText` the answer stops here; references are not capped.
3. **Text cleaning** (`cleanWikiSearchText`), on each result's `chunk_text`:
   1. The wiki's navigation sidebar is removed with `stripWikiSidebar`
      (`src/utils/wiki-sidebar.ts`), the rule `wiki_read` and `wiki_place_page`
      use (`wiki-page-tool-spec.md`, "The sidebar").
   2. **Image links** are removed. An image link is markdown image syntax
      `![alt](src)` whose `src` ends in an image extension (`png`, `jpg`,
      `jpeg`, `gif`, `svg`, `webp`, `bmp`, `tif`, `tiff`; any case), with an
      optional title. When a link wraps it — the wiki's
      `[![alt](…/img_auth.php/…/X.jpg)](…/index.php?title=File:X.jpg&… "alt")` —
      the whole wrapping link goes. An `![alt](x.pdf)`, or an image with no
      extension, stays; so does an ordinary text link to a `File:` page.
   3. **Link titles** are removed: `[text](url "Title")` becomes `[text](url)`.
      The link text and URL stay.

   The patterns, from `src/tools/wiki-search.ts`:
   ```ts
   const IMAGE_EXT = "(?:png|jpe?g|gif|svg|webp|bmp|tiff?)";
   const DEST = String.raw`(?:[^\s()]|\([^\s()]*\))*`;   // one level of parentheses: wiki URLs carry them
   const TITLE = String.raw`(?:\s+"[^"\n]*")?`;
   const IMAGE = String.raw`!\[[^\]\n]*\]\(${DEST}\.${IMAGE_EXT}${TITLE}\)`;
   const LINKED_IMAGE_RE = new RegExp(String.raw`\[${IMAGE}\]\(${DEST}${TITLE}\)`, "gi");
   const IMAGE_RE = new RegExp(IMAGE, "gi");
   const LINK_TITLE_RE = new RegExp(String.raw`(\]\(${DEST})\s+"[^"\n]*"\)`, "g");
   ```
   Applied linked images first, then bare images, then link titles. Nothing is
   reflowed: a line left empty by a removed image stays empty.
4. **Repeated text.** Walking in server order, a result whose cleaned text is
   exactly the cleaned text of an earlier result carries `same_text_as: <that
   index>` instead of `chunk_text`. The index is 0-based into the returned
   `results`: `rank` is dropped, so position is the only handle, and no other
   field in the answer is 1-based. A result with no text from the server comes
   back a reference.
5. **The cap.** While `JSON.stringify(answer).length` — the compact
   serialization `server.ts` sends — exceeds `WIKI_SEARCH_TEXT_BUDGET`
   (24,000), the lowest-placed result still carrying `chunk_text` loses it, and
   any later result whose `same_text_as` pointed at it loses that too, so a
   `same_text_as` always points at a result carrying text. Results keep their
   order and count; every `source_url` is returned. There is no envelope
   `truncated` flag: the tool description says that a result with no text under
   `includeText` did not fit.

`WIKI_SEARCH_TEXT_BUDGET` is its own constant beside `WIKI_SEARCH_TIMEOUT_MS`,
a design limit for this one answer, deliberately below the shared
`TOOL_RESULT_CHAR_BUDGET` (`src/constants.ts`) that bounds other tools' answers.
The tool description names it, which is why
`tests/packaging/measured-figures.test.ts` exempts that one figure for this file.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| No `wikiApiUrl` in config | Not an error: `getWikiApiUrl` returns `DEFAULT_WIKI_API_URL` |
| Non-2xx from API | Throw: `"wiki-query-api error: {status}"` |
| Network failure | Throw: `"Could not reach wiki-query-api at {url} ({cause})."` — `{cause}` from `describeFetchError` (`src/utils/http.ts`) |

Match the LLM-instruction error pattern used by `getValidToken(principal)` in
`src/auth/refresh.ts` — error messages must tell Claude what to do next.

### Timeout

`WIKI_SEARCH_TIMEOUT_MS` = **60s**, passed as `fetchWithRetry`'s third
argument, rather than the shared 30s default. RAG retrieval over the wiki
corpus is slower than a plain JSON read. The call is retried by `fetchWithRetry`
(up to 3 attempts, 10s budget), but a 60s timeout exhausts the budget on the
first attempt, so timeouts are effectively single-attempt — a slow success
becomes a hard failure at the default with nothing behind it. Across the committed e2e run logs, 5 of 47 calls ran past 30s, the
slowest at 56s. Re-measure rather than re-guess if the sidecar's retrieval
changes; the method is in `image-transcribe-tool-spec.md`'s timeout-budget
section.

---

## wiki-query-api Endpoint Reference

**Endpoint:**
```
POST {WIKI_API_URL}/search
Content-Type: application/json

{ "query": "..." }
```

`top_k` is not a request parameter — the server returns up to 20 results
filtered by reranker threshold. Each result carries `rank`, `relevance_score`,
`chunk_text`, `page_title`, `section_heading`, `source_url`, and usually
`source` and `source_subtype`. See `wiki-query-api/CLAUDE.md` for the upstream
pipeline details.

`{WIKI_API_URL}` is `DEFAULT_WIKI_API_URL` unless `wikiApiUrl` overrides it. For
local development the upstream server is started with
`python scripts/wiki/30_serve.py` from the `wiki-query-api/` repo and reached at
`http://localhost:8000`.

---

## Files

### `packages/engine/mcp-server/src/types/wiki-search.ts`

Two shapes, kept apart:

- `WikiSearchAPIResponse` / `WikiSearchAPIResultItem` — the server's answer,
  unchanged. `wiki_place_page` reads the same endpoint with this type.
- `WikiSearchResult` / `WikiSearchResultItem` — what the tool returns.

### `packages/engine/mcp-server/src/tools/wiki-search.ts`

- `wikiSearchSchema` — the MCP schema (name, description, inputSchema).
- `wikiSearch(input, principal)` — reads the URL from config, POSTs to
  `/search`, returns `compactWikiSearchAnswer(data, input.includeText === true)`.
- `compactWikiSearchAnswer`, `cleanWikiSearchText`, `WIKI_SEARCH_TEXT_BUDGET`,
  `WIKI_SEARCH_TIMEOUT_MS`.

### `packages/engine/mcp-server/dev/try-wiki-search.ts`

One-shot live check: `npx tsx dev/try-wiki-search.ts ["question"] [--include-text]`
prints the answer and its JSON length.

### `packages/engine/mcp-server/tests/tools/wiki-search.test.ts`

Vitest with mocked `fetch`: the request, both answer shapes, the cleaning, the
cap, `same_text_as`, purity, the schema, missing URL, non-2xx, network failure.

### Wiring

`src/auth/config.ts` — `getWikiApiUrl(principal)`, the single source of the
server URL (`wikiApiUrl`, else `DEFAULT_WIKI_API_URL`). `src/server.ts` —
the `wiki_search` dispatch arm in `createServer`. `src/tool-schemas.ts` —
`wikiSearchSchema` in `allToolSchemas`.

---

## Tool Schema

```typescript
{
  name: "wiki_search",
  description: "Search the FamilySearch Wiki for genealogy guidance. Use this when the user asks how to find records (birth, marriage, death, census, immigration, military, church), how to research ancestors from a specific country or region, or how to use FamilySearch resources. Returns up to 20 matching wiki sections, most relevant first, as references: page_title, section_heading and source_url. Pass includeText: true to also get each section's text as chunk_text. With includeText the answer is capped at 24,000 characters: a section whose text repeats an earlier one carries same_text_as (the 0-based position of that earlier result) instead, and the lowest-placed results that do not fit come back as references without chunk_text.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A natural-language genealogy question"
      },
      includeText: {
        type: "boolean",
        description: "Also return each section's text as chunk_text. Default false: references only."
      }
    },
    required: ["query"]
  }
}
```

The description string is the trigger Claude reads to decide when to call
this tool, and the only place the model learns what a text-less result under
`includeText` means.

---

## Patterns to Follow

Match the style of `packages/engine/mcp-server/src/tools/wikipedia.ts`:

- `const` for constants where applicable.
- POST with `Content-Type: application/json`.
- Parse response as JSON and map to the result type.
- Throw descriptive errors that tell Claude what went wrong + what to do.

For config, match `src/auth/config.ts`'s `getClientId()` pattern — read
from `~/.familysearch-mcp/config.json`, no env-var fallbacks.

---

## Out of Scope

- **Authentication.** The server takes none. If it ever does, the MCP side
  needs an optional `wikiApiKey` config field.
- **A `top_k` parameter.** The server returns up to 20.
- **A `provider` parameter.** `CLAUDE.md` recommends generic tools
  (e.g. `search`) with a `provider` field, but `wiki_search` is a dedicated
  tool matching the `wikipedia_search` / `collections_search` precedent.
  Consolidate when a second search provider exists.
- **Response caching at the MCP layer.** The upstream FastAPI already has
  an in-memory query embed cache.
- **Streaming results.** The FastAPI returns the full response in one shot.
