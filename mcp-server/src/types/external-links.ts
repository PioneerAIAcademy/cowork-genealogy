/**
 * Types for the external_links tool.
 *
 * The FS endpoint returns a list of curated third-party genealogy
 * resource links per place. Year fields are strings (may be empty).
 */

export interface FSExternalCollection {
  url?: string;
  linkText?: string;
  place?: string;
  startYear?: string;
  endYear?: string;
  // Other fields (record_type, recordTypeId, cost, content_type,
  // source_url) exist in the response but the tool ignores them.
}

export interface FSExternalResponse {
  count?: number;
  offset?: number;
  totalResults?: number;
  collections?: FSExternalCollection[];
}

export interface ExternalLink {
  url: string;
  linkText: string;
}

export interface ExternalLinksResult {
  place: string | null;
  totalResults: number;
  matchedCount: number;
  results: ExternalLink[];
}
