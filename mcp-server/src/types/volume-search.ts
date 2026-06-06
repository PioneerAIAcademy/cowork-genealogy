// Types for the volume_search tool.
//
// Searches FamilySearch's Records Management Service (RMS) for digitized
// volumes (image groups: microfilm rolls, book scans) covering a place and
// year range. Returns coverage metadata plus two searchability signals:
// recordSearchablePercent and fulltextSearchable.
// See docs/specs/volume-search-tool-spec.md.

// ---------- Tool input ----------

export interface VolumeSearchInput {
  standardPlace: string;
  startYear?: number;
  endYear?: number;
  pageToken?: string;
}

// ---------- RMS request ----------

export interface MetadataRmsCoverageRequest {
  // Numeric rep IDs — the RMS API's expected wire format. The resolver returns
  // them as strings; the tool maps them to numbers for the request body.
  placeRepIds: number[];
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

export interface VolumeGroup {
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

export interface VolumeSearchResult {
  query: {
    standardPlace: string;
    startYear?: number;
    endYear?: number;
  };
  totalResults: number;
  nextPageToken?: string;
  results: VolumeGroup[];
}
