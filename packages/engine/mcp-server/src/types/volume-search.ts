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
  /**
   * Record-type group names from RECORD_TYPE_GROUP_NAMES. OR-ed; an empty array
   * means no filter, matching the upstream behaviour for an empty id list.
   */
  recordTypeGroups?: string[];
  pageToken?: string;
}

// ---------- RMS request ----------

export interface MetadataRmsCoverageRequest {
  // Numeric rep IDs — the RMS API's expected wire format. The resolver returns
  // them as strings; the tool maps them to numbers for the request body.
  placeRepIds: number[];
  fromDateString?: string;
  toDateString?: string;
  /**
   * Record-type filter. Undocumented upstream; matches by hierarchy containment
   * and ORs the array. Must sit inside `coverage` — at the top level of the
   * request body it is silently ignored.
   */
  recordTypeConceptIds?: number[];
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
  /** Stable key for the record type; `recordTypeOrig` is display text. */
  recordTypeConceptId?: number;
  /** Ancestor chain, root first, ending in `recordTypeConceptId`. */
  recordTypeConceptIdHierarchy?: number[];
  /** ISO-shaped span start, e.g. `"1683-01-01T00:00:00"`. */
  fromdateString?: string;
  /** ISO-shaped span end, e.g. `"1700-12-31T23:59:59.999"`. */
  todateString?: string;
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
  /**
   * The concept id behind `recordType`, and the stable key of the pair:
   * `recordType` is locale- and collection-specific display text, absent on ~18%
   * of coverages and sometimes an unusable `concept-id:` placeholder.
   */
  recordTypeConceptId?: number;
  /** First year covered, from `fromdateString`. */
  startYear?: number;
  /** Last year covered, from `todateString`. */
  endYear?: number;
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
    recordTypeGroups?: string[];
  };
  totalResults: number;
  nextPageToken?: string;
  results: VolumeGroup[];
}
