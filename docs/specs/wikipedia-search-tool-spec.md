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
| Article not found (404) | Throw error: `"No Wikipedia article found for '{query}'"` |
| Other API errors | Throw error: `"Wikipedia API error: {status}"` |

### Timeout

`WIKIPEDIA_TIMEOUT_MS` = **60s**, passed as `fetchWithTimeout`'s third
argument, rather than the shared 30s default. This is a single un-retried
summary fetch, so a slow success becomes a hard failure at the default with
nothing behind it. Across the committed e2e run logs, 2 of 19 calls ran past
30s, at 33.7s and 35.2s. Re-measure rather than re-guess; the method is in
`image-transcribe-tool-spec.md`'s timeout-budget section.

---

## Wikipedia API Reference

**Endpoint:**
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

---

## Files to Create

### 1. `packages/engine/mcp-server/src/types/wikipedia.ts`

Define two types:

- `WikipediaAPIResponse` — shape of the Wikipedia API response
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

## Files to Delete (after testing works)

- `packages/engine/mcp-server/src/tools/hello.ts`
- `packages/engine/mcp-server/src/types/greeting.ts`

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

## Patterns to Follow

Match the style of the existing `places.ts`:

- Use `const` for API base URL
- Use `encodeURIComponent()` for the query in the URL
- Include `User-Agent` header in fetch requests
- Parse response as JSON and map to output type
- Throw descriptive errors that help Claude understand what went wrong
