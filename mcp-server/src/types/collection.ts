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

// GET /service/search/hr/v2/collections/{id}?embedWikiAboutCollection=true

export interface FSSourceDescription {
  id?: string;
  about?: string;
  modified?: string;
  descriptions?: { lang?: string; value?: string }[];
  citations?: { value?: string }[];
  titles?: { lang?: string; value?: string }[];
  rights?: string[];
  coverage?: {
    spatial?: { original?: string; description?: string };
    temporal?: { original?: string; formal?: string };
    recordType?: string;
  }[];
}

export interface FSDocument {
  id?: string;
  text?: string;
  textType?: string;
  extracted?: boolean;
}

export interface FSCollectionDetailResponse {
  description?: string; // GEDCOMX "#id" ref into sourceDescriptions
  sourceDescriptions?: FSSourceDescription[];
  collections?: FSCollectionData[];
  documents?: FSDocument[];
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

export interface CollectionsResult {
  query?: string;
  matchingCollections: number;
  collections: Collection[];
}

// Detail mode is a pass-through of FSCollectionDetailResponse with two
// HTML-bearing string fields converted to markdown:
//   - sourceDescriptions[*].citations[*].value
//   - documents[*].text   (textType also flipped from "html" to "markdown")
export type CollectionDetailResult = FSCollectionDetailResponse;
