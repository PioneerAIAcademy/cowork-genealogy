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
      "description": "Search within name fields only. Same operator syntax as keywords. Recognized English given names are automatically expanded with historical diminutives (e.g. Elizabeth also matches Betty, Bess, Eliza). The response includes a nameExpansion field showing what was expanded and which variants matched."
    },
    "place": {
      "type": "string",
      "description": "Search within place fields. Same operator syntax. Note: place matches against collection metadata, which can cause false positives. Prefer using place as a post-filter rather than in the query."
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
    "nlQuery": {
      "type": "string",
      "description": "A natural-language query, or a FamilySearch tree person ID (e.g. \"Search for John Doe born in Austria\" or \"KD96-TV2\"). Mapped to the upstream `nlQuery` parameter; an alternative to the Lucene-style `keywords`. Supplying it also sends the feature header (see Query parameter mapping)."
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
| `nlQuery` | `nlQuery` |
| `name` | `q.fullName` |
| `place` | `q.recordPlace` |
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
  /** The full AI-transcribed page. STRIPPED from every result once the
   *  response is staged (see Result staging) — it lives in the sidecar. Only
   *  present on an un-staged (no `projectPath`) exploratory search. */
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
  /** Present when the name input contained a recognized given name and was
   *  expanded with historical diminutives/variants. Precedes `results` so
   *  it survives a size-bound trim. */
  nameExpansion?: {
    original: string;
    expanded: string;
    expansions: Record<string, string[]>;
    variantsInResults: string[];
  };
  results: FulltextResult[];
  facets?: FulltextFacet[];
  /** Present only when `projectPath` was supplied. `null` if staging failed. */
  staged?: { resultsRef: string; returnedCount: number } | null;
  /** Present only when staging was attempted and threw. */
  stagingError?: string;
}
```

## Given-name diminutive expansion

When the `name` parameter contains a recognized English given name (formal
or variant), the tool automatically expands it with historical diminutives
from the bundled variant table (`config/given-name-variants.json`). This
addresses the hard exclusion caused by `m.queryRequireDefault=on`: without
expansion, a search for "Elizabeth Martin" cannot match a page transcribed
as "Betty Martin" because every term is required.

### Mechanism

Each recognized given name token is replaced with a Lucene OR group:

- Input: `name: "Elizabeth Martin"`
- Sent to API: `q.fullName=(Elizabeth OR Betty OR Betsy OR Beth OR Liz OR Lizzy OR Eliza OR Lisa OR Bess OR Eliz) Martin`

The OR group is required as a whole (any member matching satisfies it)
while `m.queryRequireDefault=on` keeps the remaining tokens required.

### Bidirectional

Expansion is bidirectional: searching for a variant form (e.g. "Betty")
also expands to include the formal name and all other variants. The
variant table is keyed by formal name but lookup works from any member.

### Excluded from expansion

- Tokens starting with `+`, `-`, or containing `"` / `*` (explicit
  operator syntax — do not interfere).
- Period-containing scribal abbreviations (e.g. `Eliz.`, `Thos.`) are
  excluded from the Lucene OR group because periods risk field-access
  parse errors. They are included in `image_transcribe`'s VLM prompt
  expansion, where the context is natural language.

### Response field

When expansion occurs, the response includes `nameExpansion`:

```typescript
nameExpansion?: {
  original: string;            // the caller's input.name
  expanded: string;            // the Lucene query actually sent
  expansions: Record<string, string[]>;  // formal name → variant forms added
  variantsInResults: string[]; // variant forms found in result names/highlights
};
```

The `query` echo always reflects the **original** input.name — the
expansion metadata lives separately in `nameExpansion`.

### Scope

English only. The variant table covers 21 formal names with diminutives
and scribal abbreviations, seeded from
`search-records/references/name-search-mechanics.md` and
`search-full-text/references/search-strategies.md`. Three pairs are
attested by measurement (Betty→Elizabeth, Peggy→Margaret, Polly→Mary);
the rest are present because they appear in the cited seed tables.

`keywords` and `place` are not expanded — only `name` (which maps to
`q.fullName`, a name-field query).

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
`src/constants.ts` (Imperva WAF requirement).

## Implementation notes

1. **Response mapping**: The upstream API likely returns a different
   shape than the indexed search. The implementation must probe the
   actual response and map it to the output schema above. The types
   above are a starting point — adjust based on the actual API response.

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
