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
  results: PlaceExternalLink[];
}
