// Types for the image_search tool.
//
// Searches FamilySearch's Records Management Service (RMS) for image groups
// (digitized volumes). Two query modes: place + date range, or image group
// number. See docs/specs/image-search-tool-spec.md.

// ---------- Tool input ----------

export interface ImageSearchInput {
  placeId?: string;
  fromDate?: string;
  toDate?: string;
  imageGroupNumber?: string;
}

// ---------- Places API lookup (placeId <-> placeRepId conversion) ----------

// GET https://api.familysearch.org/platform/places/{placeId} returns a list
// where the bare place entry (id === placeId, no `display`) is followed by its
// representation entries. Each representation has a top-level `place` pointing
// back to the parent placeId and a `Primary` identifier.
export interface FSPlaceLookupEntry {
  id: string;
  display?: { name: string; fullName: string; type: string };
  place?: { resource?: string; resourceId?: string };
  identifiers?: Record<string, string[]>;
}

export interface FSPlaceLookupResponse {
  places?: FSPlaceLookupEntry[];
}

// ---------- RMS request ----------

export interface RmsCoverageRequest {
  placeRepIds: number[];
  fromDateString?: string;
  toDateString?: string;
}

export interface RmsSearchRequest {
  coverage?: RmsCoverageRequest;
  name?: string;
  types: string[];
  returnChildCounts: boolean;
  active: boolean;
}

// ---------- RMS response ----------

export interface RmsCoverageEntry {
  place?: string;
  placeRepId?: number;
  datesOrig?: string;
  recordTypeOrig?: string;
  placeRelevance?: number;
}

export interface RmsGroup {
  id: string;
  groupName: string;
  active?: boolean;
  types?: string[];
  coverages?: RmsCoverageEntry[];
  creators?: string[];
  languages?: string[];
  title?: string;
  volumes?: string[];
  custodians?: string[];
}

export interface RmsSearchResponse {
  groups?: RmsGroup[];
  numberReturned?: number;
  totalCount?: number;
  nextPageToken?: string;
}

// ---------- Tool output ----------

export interface SimplifiedCoverage {
  place: string;
  placeId: string;
  dateRange?: string;
  recordType?: string;
  placeRelevance: number;
}

export interface ImageGroup {
  id: string;
  imageGroupNumber: string;
  title?: string;
  types: string[];
  creators: string[];
  languages: string[];
  custodians?: string[];
  volumes?: string[];
  coverages: SimplifiedCoverage[];
}

export interface ImageSearchResult {
  query: ImageSearchInput;
  totalGroups: number;
  returned: number;
  groups: ImageGroup[];
}
