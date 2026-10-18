# Wikipedia Search Tool — Implementation Spec

## Overview

Replace the `hello` tool with a `wikipedia_search` tool that fetches article summaries from Wikipedia.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | The topic to search for on Wikipedia |

Example:
```json
{ "query": "Albert Einstein" }
```

`query` may be an exact article title or a descriptive phrase
(`"Luo people Kenya Western Kenya ethnic group history"`).

---

## Lookup order

1. Fetch the summary of `query` as a title. An exact title is answered here,
   in one request.
2. If that returns **404**, search Wikipedia for `query`, asking for 5 hits,
   and take the first hit whose title matches the query (below).
3. Fetch that title's summary. The result's `title` is the real article title
   (`"Luo people"`), not the query.

**A hit matches when every significant word of its title appears in the
query.** Both are compared as words: case-folded, diacritics stripped (a
stroked letter counts as its bare letter, so `ø` reads as `o`), and split on
anything that is not a letter or digit. A trailing parenthetical is dropped
from the title first, and these small words in it need not appear in the
query: of, the, and, in, on, at, a, an, de, la, le, du, des, von, van, der. A
title made only of those words never matches. Search ranks by relevance, not
meaning, so without the rule a query for a place with no article of its own
gets another article back as its answer: `"Maddock North Dakota history"` got
`"List of governors of North Dakota"`, and `"Hollow Creek Settlement"` got
`"Swede Hollow, Saint Paul"`. Under it both are not found, while `"History of
Schuylkill County Pennsylvania"` still resolves to `"Schuylkill County,
Pennsylvania"` and `"Saint Etienne history"` to `"Saint-Étienne"`. The cost is
that a right hit whose title carries a word the query lacks is not found
(`"Skåne Sweden history"` misses `"Scania"`).

The not-found error is kept when no hit matches, or the matched hit's summary
also 404s. Any other status ends the lookup with an error (below).

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | The article title |
| `extract` | string | The article summary (1-2 paragraphs) |
| `url` | string | Link to the full Wikipedia article |

Example:
```json
{
  "title": "Albert Einstein",
  "extract": "Albert Einstein was a German-born theoretical physicist...",
  "url": "https://en.wikipedia.org/wiki/Albert_Einstein"
}
```

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| The summary 404s and no search hit matches the query, or the matched hit's summary also 404s | Throw error: `"No Wikipedia article found for '{query}'"` |
| A summary returns any other non-2xx | Throw error: `"Wikipedia API error: {status}"` |
| The search returns non-2xx | Throw error: `"Wikipedia search API error: {status}"` — not the not-found error, which would claim an absence nobody checked |
| Less than a second of the deadline (below) is left for the search or the matched hit's summary | Throw error: `"Wikipedia lookup for '{query}' timed out: it is not an exact article title, and too little of the 55s limit was left to search for it. Retry, or pass the exact article title."` — not the not-found error, for the same reason |

### Timeout

`WIKIPEDIA_DEADLINE_MS` = **55s**, one deadline the summary, the search and
the second summary share. Each request's timeout, passed as `fetchWithRetry`'s
third argument, is what is left of it, rather than the shared 30s default. Each
call is retried by `fetchWithRetry` (up to 3 attempts, its 10s budget also
capped at what is left), but a timeout that long exhausts the budget on the
first attempt, so timeouts are effectively single-attempt. A slow success
becomes a hard failure at the default with nothing behind it. Across the committed e2e run logs, 2 of 19 calls ran past
30s, at 33.7s and 35.2s. Re-measure rather than re-guess; the method is in
`image-transcribe-tool-spec.md`'s timeout-budget section. The deadline sits
under the 60s at which Cowork's device bridge aborts any MCP call, and when
less than a second of it is left for the search or the matched hit's summary,
the call fails with a timeout error rather than the not-found error.

---

## Wikipedia API Reference

**Summary endpoint** (steps 1 and 3):
```
GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}
```

**Example response** (relevant fields only):
```json
{
  "title": "Albert Einstein",
  "extract": "Albert Einstein was a German-born theoretical physicist...",
  "content_urls": {
    "desktop": {
      "page": "https://en.wikipedia.org/wiki/Albert_Einstein"
    }
  }
}
```

**Search endpoint** (step 2, the MediaWiki REST search):
```
GET https://en.wikipedia.org/w/rest.php/v1/search/page?q={query}&limit=5
```

**Example response** (relevant fields only). No hit is `{ "pages": [] }`.
```json
{
  "pages": [
    { "key": "Luo_people", "title": "Luo people" }
  ]
}
```

Every request sends the same `User-Agent`,
`genealogy-mcp-server/<version> (https://github.com/PioneerAIAcademy/cowork-genealogy)`,
where `<version>` is the engine's package version. The contact URL is not
optional: Wikimedia throttles every agent without contact details in one shared
bucket. Every request URL-encodes the query or title with `encodeURIComponent()`.

---

## Files to Create

### 1. `packages/engine/mcp-server/src/types/wikipedia.ts`

Define three types:

- `WikipediaAPIResponse` — shape of the summary endpoint's response
- `WikipediaPageSearchResponse` — shape of the search endpoint's response
- `WikipediaSearchResult` — shape of what our tool returns

### 2. `packages/engine/mcp-server/src/tools/wikipedia.ts`

Contains:

- `wikipediaSearchSchema` — MCP tool schema (name, description, inputSchema)
- `wikipediaSearch(input)` — async function that fetches from Wikipedia and returns result

---

## Files to Modify

### `packages/engine/mcp-server/src/index.ts`

The index.ts is the MCP server entry point that registers all tools. Update it to use the new wikipedia tool instead of hello:

| Current | Change to |
|---------|-----------|
| `import { helloTool, helloToolSchema } from "./tools/hello.js"` | `import { wikipediaSearch, wikipediaSearchSchema } from "./tools/wikipedia.js"` |
| `tools: [helloToolSchema, placeSearchToolSchema]` | `tools: [wikipediaSearchSchema, placeSearchToolSchema]` |
| `if (request.params.name === "hello")` | `if (request.params.name === "wikipedia_search")` |
| `helloTool(...)` | `await wikipediaSearch(...)` |

---

## Tool Schema

```typescript
{
  name: "wikipedia_search",
  description: "Search Wikipedia and return an article summary. Use this when the user wants to look up information about a topic on Wikipedia.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The topic to search for on Wikipedia"
      }
    },
    required: ["query"]
  }
}
```

---

## Testing

`tests/tools/wikipedia.test.ts`, with `fetch` mocked:

| # | Test case |
|---|-----------|
| 1 | An exact title is answered by the summary alone — one request, no search |
| 2 | A descriptive query that 404s as a title resolves through search; the result carries the hit's real title |
| 3 | A search with no hit keeps the not-found error |
| 4 | Hits none of whose titles the query spells out keep the not-found error (`"Maddock North Dakota history"`, `"Hollow Creek Settlement"`, on their live hit lists) |
| 5 | Hits that match still resolve, through diacritics, a stroked letter, small words and a parenthetical (`"Luo people"`, `"Schuylkill County, Pennsylvania"`, `"Saint-Étienne"`, `"Hamre, Osterøy"`, `"History of Georgia (U.S. state)"`) |
| 6 | A matching second hit is taken over a first that does not match; a title made only of small words is never taken |
| 7 | A summary error other than 404 is reported without searching |
| 8 | A failed search is reported as a search error, not as no article |
| 9 | Each request's timeout is what is left of the one 55s deadline, and a retried request stays inside it |
| 10 | With too little of the deadline left for the search or the matched hit's summary, the call fails as a timeout, not as no article |

`dev/smoke-calls.ts` runs one exact title (`"Genealogy"`) and one descriptive
query (`"Luo people Kenya ethnic group history"`) live; both must return
without an error.

---

## Patterns to Follow

Match the style of the existing `places.ts`:

- Use `const` for API base URL
- Use `encodeURIComponent()` for the query in the URL
- Include `User-Agent` header in fetch requests
- Parse response as JSON and map to output type
- Throw descriptive errors that help Claude understand what went wrong
