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
  /** First page only: also count every matching volume by record-type group. */
  summary?: boolean;
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
  /**
   * Undocumented, 1-based; matches the token pages exactly (probed 2026-10-22).
   * Used only by the rollup, which falls back to token paging if it stops working.
   */
  pageNumber?: number;
}

// ---------- RMS response ----------

export interface MetadataRmsCoverageEntry {
  place?: string;
  datesOrig?: string;
  recordTypeOrig?: string;
  /** Stable key for the record type; `recordTypeOrig` is display text. */
  recordTypeConceptId?: number;
  /**
   * The concept's ancestor chain, root-first, ending in `recordTypeConceptId`.
   * No shipped code reads it — it is how `dev/probe-record-type-groups.ts`
   * resolves a stray's real parent, which is the evidence behind the group
   * table, and it is listed here so this interface describes the whole coverage
   * row rather than only the parts the tool consumes.
   */
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
  /** Present when the input asked for `summary` and it could be computed. */
  summary?: VolumeRollup;
  /** Why `summary` is missing when it was asked for; the page is still complete. */
  summaryError?: string;
}

/**
 * Volumes in one record-type group. Of those with no name-indexed images,
 * `fulltextOnly` are full-text searchable and `browseOnly` are not; both are null
 * when the full-text check failed.
 */
export interface VolumeRollupBucket {
  group: string;
  volumes: number;
  browseOnly: number | null;
  fulltextOnly: number | null;
}

/**
 * Every matching volume counted by record-type group. A volume counts in every
 * group its coverages reach, ancestors included, so buckets can sum past
 * `totalVolumes`; `untyped` holds the volumes that reach no group. `complete` is
 * false when the volumes exceeded the rollup's page cap.
 */
export interface VolumeRollup {
  totalVolumes: number;
  complete: boolean;
  byRecordType: VolumeRollupBucket[];
  untyped: Omit<VolumeRollupBucket, "group">;
}
