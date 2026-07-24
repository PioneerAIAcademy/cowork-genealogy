/**
 * Types for the external_links_search tool.
 *
 * The FS endpoint returns a list of curated third-party genealogy
 * resource links per place. Year fields are strings (may be empty).
 */

export interface FSPlaceExternalCollection {
  url?: string;
  linkText?: string;
  place?: string;
  startYear?: string;
  endYear?: string;
  // Other fields (record_type, recordTypeId, cost, content_type,
  // source_url) exist in the response but the tool ignores them.
}

export interface FSPlaceExternalResponse {
  count?: number;
  offset?: number;
  totalResults?: number;
  collections?: FSPlaceExternalCollection[];
}

export interface PlaceExternalLink {
  url: string;
  linkText: string;
}

export interface ExternalLinksSearchResult {
  query: {
    standardPlace: string;
    startYear?: number;
    endYear?: number;
  };
  // Total curated resources for the place BEFORE the year filter. The single
  // non-derivable count: results: [] with totalForPlace: 12 reads as
  // "resources exist here, just not in your years". results.length is the
  // matched count, so there is no separate matchedCount field.
  totalForPlace: number;
  // Number of links in `results` after year + host filtering and the inline
  // cap. Equal to `results.length`; surfaced explicitly so a capped/filtered
  // response is self-describing alongside `totalForPlace`.
  returned: number;
  results: PlaceExternalLink[];
  // Host-side staging handle (search-result-staging-spec.md). Present only when
  // `projectPath` was supplied and the pre-filter set was non-empty. The staged
  // sidecar holds the FULL year-filtered set (before any host filter or inline
  // cap), so the complete link list is retained on disk for the research record
  // and feedback bundles even when `results` is narrowed. `null` when staging
  // was attempted but failed; absent when `projectPath` was not supplied.
  staged?: { resultsRef: string; returnedCount: number } | null;
  stagingError?: string;
}
