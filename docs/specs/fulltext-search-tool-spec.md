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
      "description": "Number of results to return. Default 20, max 100."
    },
    "offset": {
      "type": "number",
      "description": "Pagination offset. Default 0."
    },
    "includeFacets": {
      "type": "boolean",
      "description": "When true, include facet counts for collection, place, year, and record type. Default false."
    }
  },
  "required": []
}
```

At least one of `keywords`, `name`, or `place` must be provided.

## Query parameter mapping

The tool maps its input to the upstream API query parameters:

| Tool input | API parameter |
|-----------|--------------|
| `keywords` | `q.text` |
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

## Output schema

```typescript
interface FulltextSearchResult {
  /** The record's ARK in canonical form (a 3:1: or 3:2: entry, e.g.
   *  "ark:/61903/3:1:3Q9M-CSNL-S98H-M"). Feed to source_attachments' uris. */
  id: string;
  /** Relevance score */
  score?: number;
  /** Collection title */
  collectionTitle?: string;
  /** Collection ID */
  collectionId?: string;
  /** Record title */
  recordTitle?: string;
  /** URL to the record page */
  recordUrl?: string;
  /** URL to the document image */
  imageUrl?: string;
  /** Transcript snippet with search term highlights */
  snippet?: string;
  /** Names found in the record */
  names?: string[];
  /** Places found in the record */
  places?: string[];
  /** Dates found in the record */
  dates?: string[];
  /** Record type */
  recordType?: string;
}

interface FulltextFacet {
  value: string;
  count: number;
}

interface FulltextSearchResponse {
  query: Record<string, string | number | boolean>;
  totalResults: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  results: FulltextSearchResult[];
  facets?: {
    collections?: FulltextFacet[];
    places?: FulltextFacet[];
    years?: FulltextFacet[];
    recordTypes?: FulltextFacet[];
  };
}
```

## Given-name diminutive expansion (issue #607)

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

English only. The variant table covers 22 formal names with diminutives
and scribal abbreviations, seeded from
`search-records/references/name-search-mechanics.md` and
`search-full-text/references/search-strategies.md`. Three pairs are
attested by measurement (Betty→Elizabeth, Peggy→Margaret, Polly→Mary);
the rest are present because they appear in the cited seed tables.

`keywords` and `place` are not expanded — only `name` (which maps to
`q.fullName`, a name-field query).

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

2. **Snippet extraction**: FTS results should include transcript
   snippets showing where the search terms appear. This is the key
   differentiator from indexed search.

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
