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

export interface FulltextSearchResponse {
  query: Record<string, string | number | boolean>;
  totalResults: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  results: FulltextResult[];
  facets?: FulltextFacet[];
}
