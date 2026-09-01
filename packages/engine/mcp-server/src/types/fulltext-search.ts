// FamilySearch Full-Text Search API Response Types
// GET https://www.familysearch.org/service/search/fulltext/search

export interface FSFulltextEntity {
  type: string; // "NAME" | "PLACE" | "DATE"
  value: string;
}

export interface FSFulltextContent {
  recordDate?: string;
  recordType?: string;
  recordPlace?: string;
  title?: string;
  textDocument?: string;
  entities?: FSFulltextEntity[];
  highlightTexts?: string[];
}

export interface FSFulltextEntry {
  id?: string;
  sourceUrl?: string;
  collectionId?: string;
  collectionTitle?: string;
  content?: FSFulltextContent;
}

export interface FSFulltextFacetItem {
  count: number;
  displayCount?: string;
  displayName?: string;
  params?: string;
  facets?: FSFulltextFacetItem[];
}

export interface FSFulltextResponse {
  results?: number;
  index?: number;
  links?: { next?: { href?: string } };
  entries?: FSFulltextEntry[];
  facets?: FSFulltextFacetItem[];
}

// Tool I/O Types

export interface FulltextSearchInput {
  // When set, the tool stages its verbatim response to results/.staging/ and
  // returns a `staged` handle (search-result-staging-spec.md). Purely additive.
  projectPath?: string;
  keywords?: string;
  name?: string;
  place?: string;
  nlQuery?: string;
  collectionId?: string;
  imageGroupNumber?: string;
  yearFrom?: number;
  yearTo?: number;
  recordType?: string;
  recordPlace0?: string;
  recordPlace1?: string;
  recordPlace2?: string;
  recordPlace3?: string;
  count?: number;
  offset?: number;
  includeFacets?: boolean;
}

export interface FulltextResult {
  // The record's ARK in canonical form (a 3:1: or 3:2: entry, e.g.
  // "ark:/61903/3:1:3Q9M-CSNL-S98H-M"). Feed to source_attachments' `uris`.
  id: string;
  sourceUrl?: string;
  collectionId?: string;
  collectionTitle?: string;
  title?: string;
  recordDate?: string;
  recordType?: string;
  recordPlace?: string;
  textDocument?: string;
  names?: string[];
  places?: string[];
  dates?: string[];
  highlightTerms?: string[];
}

export interface FulltextFacet {
  name: string;
  count: number;
  items: { name: string; count: number; filterParam: string }[];
}

export interface NameExpansionInfo {
  /** The caller's original name input. */
  original: string;
  /** The Lucene query actually sent (with OR groups). */
  expanded: string;
  /** Which formal names were expanded and to which variant forms. */
  expansions: Record<string, string[]>;
  /** Variant forms that appear in result names or highlight terms. */
  variantsInResults: string[];
}

export interface FulltextSearchResponse {
  query: Record<string, string | number | boolean>;
  totalResults: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  // Set when this project holds staged search responses with no research.json
  // log entry. Advisory — refuses nothing. Serialized before `results` and
  // withheld from the staged payload.
  unloggedSearches?: string;
  // Set on a `projectPath` search whose upstream `totalResults` is 0 — NOT merely
  // an empty `results`, which is the post-`mapEntry` set. A nil search stages no
  // file, so `unloggedSearches` structurally cannot see it.
  nilSearchNeedsLog?: string;
  results: FulltextResult[];
  facets?: FulltextFacet[];
  /** Present when the name input contained a recognized given name and was
   *  expanded with historical diminutives/variants. */
  nameExpansion?: NameExpansionInfo;
  // Present only when `projectPath` was supplied — see RecordSearchToolResponse.
  staged?: { resultsRef: string; returnedCount: number } | null;
  stagingError?: string;
}
