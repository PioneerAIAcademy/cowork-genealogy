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
  placeIds: number[];
  recordCount: number;
  personCount: number;
  imageCount: number;
  url: string;
}

export interface CollectionsResult {
  query?: string;
  placeIds?: number[];
  matchingCollections: number;
  collections: Collection[];
}
