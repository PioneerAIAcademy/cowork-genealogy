// FamilySearch Collections API Response Types
// GET https://www.familysearch.org/service/search/hr/v2/collections

export interface FSCollectionEntry {
  id: string;
  title: string;
  collectionType?: string;
  recordCount?: number;
  personCount?: number;
  imageCount?: number;
  placeId?: string; // chain like "1-33"
  coverageSpatial?: string;
  coverageTemporal?: string;
}

export interface FSCollectionsResponse {
  collections?: FSCollectionEntry[];
  total?: number;
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
  placeIds: number[];
  matchingCollections: number;
  collections: Collection[];
}
