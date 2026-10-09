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
  record_type?: string;
  cost?: string;
  content_type?: string;
  // recordTypeId and source_url also exist in the response; the tool drops them.
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
  // Distinct curated resources for the place (after dedupe) BEFORE the year
  // filter. The single non-derivable count: results: [] with totalForPlace: 12
  // reads as "resources exist here, just not in your years".
  totalForPlace: number;
  // Number of links in `results` after year + host filtering and the inline
  // cap. Equal to `results.length`; surfaced explicitly so a capped/filtered
  // response is self-describing alongside `totalForPlace`.
  returned: number;
  // Set when this project holds staged search responses with no research.json log
  // entry (issue #2056). Advisory — refuses nothing.
  unloggedSearches?: string;
  // Set when the PRE-FILTER link set was empty on a `projectPath` search — a genuine
  // nil for that place and year window, not merely a host filter that matched none.
  nilSearchNeedsLog?: string;
  results: PlaceExternalLink[];
  // True when INLINE_CAP cut `results`. The stored list and the staged sidecar
  // hold the full set; page it with research_query or narrow with `host`.
  inlineCapped?: true;
  // Present when `projectPath` named a project: the file and the places whose
  // entries this fetch wrote.
  stored?: { file: string; places: string[] };
  // Why the stored list could not be written. The search itself succeeded.
  collectionsError?: string;
  // Host-side staging handle (search-result-staging-spec.md). Present only when
  // `projectPath` was supplied and the pre-filter set was non-empty. The staged
  // sidecar holds the FULL year-filtered set (before any host filter or inline
  // cap), so the complete link list is retained on disk for the research record
  // and feedback bundles even when `results` is narrowed. `null` when staging
  // was attempted but failed; absent when `projectPath` was not supplied.
  staged?: { resultsRef: string; returnedCount: number } | null;
  stagingError?: string;
}
