/**
 * Types for the place_external_links tool.
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

export interface PlaceExternalLinksResult {
  standardPlace: string;
  place: string | null;
  totalResults: number;
  matchedCount: number;
  results: PlaceExternalLink[];
}
