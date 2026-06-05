// Types for the metadata_search tool.
//
// Searches FamilySearch's Records Management Service (RMS) for image groups
// (digitized volumes) by place and date range. Returns coverage metadata plus
// two searchability signals: recordSearchablePercent and fulltextSearchable.
// See docs/specs/metadata-search-tool-spec.md.

// ---------- Tool input ----------

export interface MetadataSearchInput {
  standardPlace: string;
  fromDate?: string;
  toDate?: string;
  pageToken?: string;
}

// ---------- RMS request ----------

export interface MetadataRmsCoverageRequest {
  // placeRepIds come from the shared resolver as strings; the RMS API accepts
  // them JSON-serialized.
  placeRepIds: string[];
  fromDateString?: string;
  toDateString?: string;
}

export interface MetadataRmsSearchRequest {
  coverage: MetadataRmsCoverageRequest;
  types: string[];
  returnChildCounts: boolean;
  active: boolean;
  pageSize: number;
  nextPageToken?: string;
}

// ---------- RMS response ----------

export interface MetadataRmsCoverageEntry {
  place?: string;
  datesOrig?: string;
  recordTypeOrig?: string;
}

export interface MetadataRmsGroup {
  id: string;
  groupName: string;
  coverages?: MetadataRmsCoverageEntry[];
  languages?: string[];
  title?: string;
  volumes?: string[];
  // Populated inline when includeChildCounts: true is sent
  childCount?: number;
  indexedChildCount?: number;
  noIndexableDataChildCount?: number;
}

export interface MetadataRmsSearchResponse {
  groups?: MetadataRmsGroup[];
  numberReturned?: number;
  totalCount?: number;
  nextPageToken?: string;
}

// Response from the full-text searchability endpoint
export interface FulltextGroupNumberResponse {
  ids?: string[];
}

// ---------- Tool output ----------

export interface SimplifiedCoverage {
  place: string;
  dateRange?: string;
  recordType?: string;
}

export interface MetadataGroup {
  imageGroupNumber: string;
  imageGroupPrefix: string;
  imageCount: number | null;
  recordSearchablePercent: number | null;
  fulltextSearchable: boolean | null;
  title?: string;
  volumes?: string[];
  languages: string[];
  coverages: SimplifiedCoverage[];
}

export interface MetadataSearchResult {
  query: {
    standardPlace: string;
    fromDate?: string;
    toDate?: string;
  };
  totalGroups: number;
  returned: number;
  nextPageToken?: string;
  groups: MetadataGroup[];
}
