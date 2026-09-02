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
      "description": "Start of year range filter. Must be provided together with yearTo, and must be <= yearTo."
    },
    "yearTo": {
      "type": "number",
      "description": "End of year range filter. Must be provided together with yearFrom, and must be >= yearFrom."
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
      "description": "Absolute path to the active project. When supplied, the tool stages its verbatim response host-side and returns a `staged` handle (see Result staging below); pass `staged.resultsRef` to `research_log_append`. Omit only for a throwaway exploratory search that will not be logged."
    }
  },
  "required": []
}
```

At least one of `keywords`, `name`, `place`, `nlQuery`, or `imageGroupNumber` must be provided (`validateInput`).

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

When — and only when — `nlQuery` is supplied, the request also carries the
header `X-FS-Feature-Tag: search_naturalLanguageSupport`. Every other search
omits it.

## Output schema

The output types are the source in `src/types/fulltext-search.ts`; this
mirrors them. The upstream API sends **no relevance score** (confirmed live
2026-08-27 — the raw entry carries only `content`, `id`, `sourceUrl`,
`collectionId`, `collectionTitle`), so results preserve upstream order and no
`score` field exists.

```typescript
interface FulltextResult {
  /** The record's ARK in canonical form (a 3:1: or 3:2: entry, e.g.
   *  "ark:/61903/3:1:3Q9M-CSNL-S98H-M"). Feed to source_attachments' uris. */
  id: string;
  /** URL to the record on familysearch.org (upstream `sourceUrl`). */
  sourceUrl?: string;
  collectionId?: string;
  collectionTitle?: string;
  /** Record title (upstream `content.title`). */
  title?: string;
  recordDate?: string;
  recordType?: string;
  recordPlace?: string;
  /** The full AI-transcribed page. Present whenever nothing was staged —
   *  either `projectPath` was not supplied, or staging failed (`staged: null`
   *  with `stagingError` set). Once staged, it is stripped unconditionally
   *  from every result (see Result staging below for the strip/reachability
   *  contract) — it lives in the sidecar. */
  textDocument?: string;
  /** Names / places / dates extracted from the transcript (upstream
   *  `content.entities`, bucketed by type). */
  names?: string[];
  places?: string[];
  dates?: string[];
  /** The upstream `content.highlightTexts`: the matched terms and phrases,
   *  as BARE strings (e.g. ["Patrick", "Flynn", "Flynn Patrick"] — confirmed
   *  live 2026-08-27), NOT marked-up snippets. They confirm which query terms
   *  hit; they do not carry surrounding context. */
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
  /** Present only when this project holds staged search responses that no
   *  research.json log entry accounts for. Advisory — refuses nothing.
   *  Serialized before `results` and withheld from the staged payload;
   *  contract and rationale in record-search-tool-spec-v2.md. */
  unloggedSearches?: string;
  /** Present only when `projectPath` was supplied AND the upstream total
   *  (`data.results`) is 0. Not keyed on `results.length` alone: that is the
   *  post-`mapEntry` set, and `mapEntry` drops an entry with no `entry.id`, so
   *  a page that fails mapping empties `results` while `totalResults` is
   *  non-zero. What distinguishes this tool from external_links_search is only
   *  that no host filter narrows the inline copy — the mapping path is shared. */
  nilSearchNeedsLog?: string;
  results: FulltextResult[];
  facets?: FulltextFacet[];
  /** Present only when `projectPath` was supplied. `null` if staging failed.
   *  See "Result staging" below for the strip/reachability contract. */
  staged?: { resultsRef: string; returnedCount: number } | null;
  /** Present only when staging was attempted and threw. */
  stagingError?: string;
}
```

## Result staging

When `projectPath` is supplied (the normal case — the skill makes it
mandatory), the tool stages its verbatim response to `results/.staging/` and
returns a `staged` handle, per
[`search-result-staging-spec.md`](./search-result-staging-spec.md). Staging is
purely additive and best-effort: a staging failure never fails a successful
search (it sets `staged: null` and `stagingError`).

Once staged, the heavy inline `textDocument` is **dropped from every result**
— unconditionally, so the overflow protection cannot be forgotten (the full
text is already serialized in the sidecar). The remaining flat fields
(`names`, `places`, `dates`, `highlightTerms`, `title`, `recordType`,
`recordPlace`, `recordDate`) are the triage stubs the agent works from. Note
`record_read` cannot re-read a fulltext sidecar (it matches on `recordId` +
`gedcomx`, which a fulltext result has neither of), so **no MCP tool** reads a
staged fulltext result's transcript back. It is still on disk at
`staged.resultsRef` — staging serializes the response before the strip runs —
and `Read` is not gated, so an agent can open it. Doing so pulls the whole page
(79–136 KB) back into context, which is the reason to triage from the stubs and
verify against the original image, not an inability to reach it.

`projectPath` is not forwarded to the upstream API; it only drives staging.

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

2. **Matched terms, not snippets**: the upstream `content.highlightTexts`
   are bare matched terms/phrases (`highlightTerms`), not marked-up snippets
   with surrounding context. The full transcript is `textDocument`, which is
   stripped once staged. There is no context-bearing snippet field; do not
   document one.

3. **Facets**: When `includeFacets` is true, send `m.defaultFacets=on`
   and extract facet data from the response. Facets help users narrow
   broad searches.

4. **No fuzzy matching**: Unlike indexed search, FTS does exact text
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
