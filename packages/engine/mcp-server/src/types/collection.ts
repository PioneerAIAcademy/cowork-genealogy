// FamilySearch Collections API Response Types
// GET https://www.familysearch.org/service/search/hr/v2/collections

export interface FSContentCount {
  completeness?: number;
  count: number;
  resourceType: string;
}

export interface FSSearchMetadata {
  imageCount?: number;
  recordCount?: number;
  lastUpdated?: number;
  typeFacet?: string;
  startYear?: number;
  endYear?: number;
  region?: string;
  placeIds?: number[];
}

export interface FSCollectionData {
  id: string;
  title: string;
  content?: FSContentCount[];
  searchMetadata?: FSSearchMetadata[];
}

export interface FSCollectionEntry {
  content?: {
    gedcomx?: {
      collections?: FSCollectionData[];
      id?: string;
    };
  };
}

export interface FSCollectionsResponse {
  results?: number;
  index?: number;
  entries?: FSCollectionEntry[];
}

// Tool Output Types

/** One collection's indexed counts from FamilySearch's catalog: `personCount` as `collections_search` reports it, and the `/Record` count it does not return. */
export interface CollectionCounts {
  personCount: number;
  recordCount: number;
}

/** Reads FamilySearch's collection catalog as counts by id. */
export type CollectionCatalogLoader = () => Promise<ReadonlyMap<string, CollectionCounts>>;

/** One row of a `collections_search` answer, the same for every caller. The
 *  record and image counts and the per-row link are left out: only
 *  locality-guide read them, and they took Italy's answer past the budget. A
 *  link is `collectionUrl` with the id; `collectionCountsById` still derives
 *  the `/Record` count for `research_append`'s stamp. */
export interface Collection {
  id: string;
  title: string;
  dateRange: string;
  personCount: number;
}

export interface CollectionsSearchResult {
  // A collection's FamilySearch page: replace `{id}` with the row's id.
  collectionUrl: string;
  // The derived FamilySearch collection scope the titles were matched at — the
  // jurisdiction the tool actually served (a county input is matched at the
  // state level). The collections analog of the level-served signal the
  // wiki/population tools report.
  scope: string;
  // Collections matching the scope BEFORE the optional date filter. results: []
  // with totalForPlace: 8 reads as "8 collections cover this place, none in
  // your window." Equals results.length when no years are passed and the
  // answer is not truncated.
  totalForPlace: number;
  results: Collection[];
  // Present, as true, only when the answer was over its character budget and
  // rows were left out (see `fitToBudget`).
  truncated?: true;
  // Present only with `truncated`: the rows the place and year filter matched,
  // before any were left out. Not `totalForPlace` (before the year filter) and
  // not `results.length` (after truncation).
  matched?: number;
}
