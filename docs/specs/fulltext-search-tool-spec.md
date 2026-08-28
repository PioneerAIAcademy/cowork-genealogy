# Full-Text Search Tool — Implementation Spec

## Overview

An MCP tool that searches FamilySearch's full-text search API — a
separate system from the indexed Records search (`search` tool). FTS
searches AI-transcribed text from ~1.95 billion historical document
images. It surfaces mentions of people anywhere in a document
(witnesses, neighbors, heirs, appraisers), not just indexed principals.

Wraps the endpoint:
`GET https://www.familysearch.org/service/search/fulltext/search`

Requires authentication (OAuth tokens via the `login` tool). Uses the
same auth flow as the existing `search` tool (`getValidToken()` from
`src/auth/refresh.ts`).

### Why a separate tool

The existing `search` tool wraps the indexed persona search API
(`/service/search/hr/v2/personas`), which searches structured fields
(name, date, place) with fuzzy matching. FTS searches raw transcript
text with Lucene-style operators. They are completely different systems
with different query syntax, different result shapes, and different
use cases. A separate tool keeps the interface clean and the
descriptions distinct so Claude picks the right one.

## Tool name

`fulltext_search`

## Input schema

```json
{
  "type": "object",
  "properties": {
    "keywords": {
      "type": "string",
      "description": "Full-text search query using Lucene-style operators. Use + to require a term, - to exclude, \"...\" for phrase search, * for wildcard (min 3 chars). Default is OR across terms — always use + for required terms. Example: \"+Patrick +Flynn\", \"+\\\"Last Will and Testament\\\" +Flynn\""
    },
    "name": {
      "type": "string",
      "description": "Search within name fields only. Same operator syntax as keywords. Use when searching for a person by name without matching body text."
    },
    "place": {
      "type": "string",
      "description": "Search within place fields. Same operator syntax. Note: place matches against collection metadata, which can cause false positives. Prefer using place as a post-filter rather than in the query."
    },
    "nlQuery": {
      "type": "string",
      "description": "Natural language search query or a FamilySearch tree person ID (e.g. \"Search for John Doe born in Austria\" or \"KD96-TV2\"). Sends the X-FS-Feature-Tag: search_naturalLanguageSupport header — see Auth."
    },
    "collectionId": {
      "type": "string",
      "description": "Filter to a specific FamilySearch collection by ID."
    },
    "imageGroupNumber": {
      "type": "string",
      "description": "Filter to a specific digitized volume by Image Group Number."
    },
    "yearFrom": {
      "type": "number",
      "description": "Start of year range filter."
    },
    "yearTo": {
      "type": "number",
      "description": "End of year range filter."
    },
    "recordType": {
      "type": "string",
      "description": "Filter by record type."
    },
    "recordPlace0": {
      "type": "string",
      "description": "Filter by region."
    },
    "recordPlace1": {
      "type": "string",
      "description": "Filter by country (or state within US/Mexico/Canada/UK)."
    },
    "recordPlace2": {
      "type": "string",
      "description": "Filter by county."
    },
    "recordPlace3": {
      "type": "string",
      "description": "Filter by city."
    },
    "count": {
      "type": "number",
      "description": "Number of results to return. Default 5, max 100."
    },
    "offset": {
      "type": "number",
      "description": "Pagination offset. Default 0."
    },
    "includeFacets": {
      "type": "boolean",
      "description": "When true, include facet counts for collection, place, year, and record type. Default false."
    },
    "projectPath": {
      "type": "string",
      "description": "Absolute path to the active project directory. When supplied, the tool stages its raw response host-side and returns a `staged` handle (`search-result-staging-spec.md`) — pass `staged.resultsRef` to `research_log_append` as `stagedResultsRef`. Once staged, the inline `textDocument` field is stripped from every result (see Output schema)."
    }
  },
  "required": []
}
```

At least one of `keywords`, `name`, `place`, `nlQuery`, or `imageGroupNumber`
must be provided.

## Query parameter mapping

The tool maps its input to the upstream API query parameters:

| Tool input | API parameter |
|-----------|--------------|
| `keywords` | `q.text` |
| `name` | `q.fullName` |
| `place` | `q.recordPlace` |
| `nlQuery` | `nlQuery` |
| `collectionId` | `f.collectionId` |
| `imageGroupNumber` | `q.groupName` |
| `yearFrom` | `f.recordYear0` |
| `yearTo` | `f.recordYear1` |
| `recordType` | `f.recordType0` |
| `recordPlace0` | `f.recordPlace0` |
| `recordPlace1` | `f.recordPlace1` |
| `recordPlace2` | `f.recordPlace2` |
| `recordPlace3` | `f.recordPlace3` |
| `count` | `count` |
| `offset` | `offset` |
| `includeFacets` | `m.defaultFacets` (set to `on` when true) |

Additionally, `m.queryRequireDefault=on` is always sent.

## Output schema

```typescript
interface FulltextSearchResult {
  /** The record's ARK in canonical form (a 3:1: or 3:2: entry, e.g.
   *  "ark:/61903/3:1:3Q9M-CSNL-S98H-M"). Feed to source_attachments' uris. */
  id: string;
  /** Resolver URL for the record */
  sourceUrl?: string;
  /** Collection ID */
  collectionId?: string;
  /** Collection title */
  collectionTitle?: string;
  /** Record title */
  title?: string;
  /** Record date */
  recordDate?: string;
  /** Record type */
  recordType?: string;
  /** Record place */
  recordPlace?: string;
  /**
   * The full AI-transcribed page text. Present whenever nothing was staged —
   * either `projectPath` was not supplied, or staging failed (`staged: null`
   * with `stagingError` set), since the strip is guarded on `staged`.
   * Once staged, this field is stripped unconditionally from every result —
   * the overflow driver, 79-136 KB across a result set — and does not
   * survive round-trip through record_read (its sidecar path requires
   * `gedcomx`, which a fulltext-staged result never has). See
   * search-result-staging-spec.md §2 "Inline-payload strip".
   */
  textDocument?: string;
  /** Names found in the record */
  names?: string[];
  /** Places found in the record */
  places?: string[];
  /** Dates found in the record */
  dates?: string[];
  /**
   * Bare terms the query matched on (e.g. ["Flynn", "witness"]) — NOT
   * marked-up transcript fragments, confirmed against a live upstream
   * response. Survives the textDocument strip, so it is the primary
   * post-strip triage signal.
   */
  highlightTerms?: string[];
}

interface FulltextFacet {
  name: string;
  count: number;
  items: { name: string; count: number; filterParam: string }[];
}

interface FulltextSearchResponse {
  query: Record<string, string | number | boolean>;
  totalResults: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  results: FulltextSearchResult[];
  facets?: FulltextFacet[];
  /**
   * Present only when `projectPath` was supplied — search-result-staging-spec.md.
   * Unlike a record_search staged handle, `resultsRef` here cannot currently be
   * read back through `record_read`: its sidecar reader requires a `gedcomx`
   * field, which a fulltext-staged entry never has.
   */
  staged?: { resultsRef: string; returnedCount: number } | null;
  stagingError?: string;
}
```

## Error handling

| Status | Behavior |
|--------|----------|
| 401 | Throw: "FamilySearch session expired; call the login tool to re-authenticate." |
| 403 | Throw: "FamilySearch blocked the request. Check that the MCP server is running an unmodified build." |
| 400 | Parse error body if available, throw with detail. Likely caused by invalid query syntax. |
| Other | Throw with status code and text. |

## Auth

Uses `getValidToken()` from `src/auth/refresh.ts` — same as the
existing `search` tool. Requires the `BROWSER_USER_AGENT` from
`src/constants.ts` (Imperva WAF requirement). When `nlQuery` is set, an
additional `X-FS-Feature-Tag: search_naturalLanguageSupport` header is sent
(the `nlQuery` branch in `fulltextSearchTool`) — omitted for every other
query shape.

## Implementation notes

1. **Response mapping**: the upstream response is mapped to the output
   schema above by `mapEntry` (`fulltext-search.ts`). Confirmed against a
   live upstream response: the upstream entry carries no relevance `score`,
   and its `content.highlightTexts` are bare matched terms, not marked-up
   snippets — both are reflected in the output schema above, not left as an
   open question.

2. **Facets**: When `includeFacets` is true, send `m.defaultFacets=on`
   and extract facet data from the response. Facets help users narrow
   broad searches.

3. **No fuzzy matching**: Unlike indexed search, FTS does exact text
   matching only. The tool description must make this clear so Claude
   constructs appropriate queries.

## Files to create/modify

| File | Action |
|------|--------|
| `src/types/fulltext-search.ts` | Create — input/output types |
| `src/tools/fulltext-search.ts` | Create — tool implementation |
| `src/index.ts` | Modify — register tool |
| `dev/try-fulltext-search.ts` | Create — smoke test |
| `tests/tools/fulltext-search.test.ts` | Create — unit tests |

## Testing

1. **Smoke test**: `npx tsx dev/try-fulltext-search.ts "+Patrick +Flynn"`
2. **MCP Inspector**: Verify tool registers, test with sample queries
3. **Cowork**: Trigger via the `search-full-text` skill
