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

export interface Collection {
  id: string;
  title: string;
  dateRange: string;
  recordCount: number;
  personCount: number;
  imageCount: number;
  url: string;
}

export interface CollectionsSearchResult {
  // Echo of the input.
  query: {
    standardPlace: string;
    startYear?: number;
    endYear?: number;
  };
  // The derived FamilySearch collection scope the titles were matched at — the
  // jurisdiction the tool actually served (a county input is matched at the
  // state level). The collections analog of the level-served signal the
  // wiki/population tools report.
  scope: string;
  // Collections matching the scope BEFORE the optional date filter. results: []
  // with totalForPlace: 8 reads as "8 collections cover this place, none in
  // your window." Equals results.length when no years are passed.
  totalForPlace: number;
  results: Collection[];
}
