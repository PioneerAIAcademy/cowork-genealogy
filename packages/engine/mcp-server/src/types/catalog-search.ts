/**
 * `catalog_search` I/O. Contract measured in `dev/probe-catalog.ts` (A–G) and,
 * for the `Accept` header and the `identifier.value` shape, section H.
 */

export interface CatalogSearchInput {
  /** Resolved to a place REP id. Not a place id — see the tool's doc comment. */
  standardPlace?: string;
  /** Excludes subordinate jurisdictions: Maine 3,902 hits -> 803. */
  exactPlace?: boolean;
  keywords?: string;
  surname?: string;
  title?: string;
  author?: string;
  subject?: string;
  /** Matches both the legacy microfilm number and the DGS. */
  filmNumber?: string;
  callNumber?: string;
  /** An exact year, not a decade: 1800 -> 22 hits, against a facet bucket of 185. */
  year?: number;
  /** Case-sensitive upstream: "Online" -> 472, "online" -> 0. */
  availability?: string;
  /** Hits to return. Default 25, max 200 (201 -> 400). */
  count?: number;
  /** Item calls to make. Default 10, max 25 — see the spec's Design section. */
  hydrate?: number;
}

/** One reel or digitization of an item. */
export interface CatalogFilmNote {
  /** Legacy microfilm number. */
  filmNumber?: string;
  /** DGS — feeds `image_search`/`fulltext_search` as their `imageGroupNumber`. */
  imageGroupNumber?: string;
  indexed?: string;
  shelf?: string;
  copyLocation?: string;
  /** What that reel covers. */
  text?: string;
  imageStartNumber?: string;
}

export interface CatalogHit {
  /** Last path segment of the item URL, e.g. "koha:3308785". Carried for
   *  citation; the request uses the URL itself, never a rebuild of this. */
  id?: string;
  title: string;
  creator?: string;
  /** Access signal: "Online", "FamilySearch Library", "Granite Mountain Record
   *  Vault", "HSB (Headquarters Storage Building)", and others. */
  repositoryCalls: string[];
  url?: string;
  /** False for four distinct reasons: the hit was past the first
   *  `hydrateRequested` hits and was never attempted, the item call failed,
   *  it was refused by the host check, or the budget did not reach it.
   *  Compare against `hydrateRequested` and `hydrationTimedOut` to tell
   *  "never tried" from "tried and has no detail". Never an error — one bad
   *  item must not fail the search. */
  hydrated: boolean;
  notes?: string[];
  authors?: string[];
  subjects?: string[];
  filmNotes?: CatalogFilmNote[];
  availableOnline?: boolean;
  /** FamilySearch Digital Library URL for a digitized book. Surfaced only; no
   *  tool here reaches the service behind it. */
  digitalLibraryUrl?: string;
}

export interface CatalogSearchResult {
  totalHits: number;
  returned: number;
  /** False when `standardPlace` could not be resolved to a rep id and the
   *  query fell back to matching the place by name. */
  placeResolved: boolean;
  /** True when the entry-anchored budget ran out before every requested hit
   *  was hydrated — including when the search leg spent it and hydration was
   *  never attempted at all. Means "retry later", not "no detail exists". */
  hydrationTimedOut: boolean;
  /** How many hits hydration was asked for (the `hydrate` input, default 10).
   *  Hits past this many are `hydrated: false` because they were never tried,
   *  which is not a failure and needs no retry of the whole search. */
  hydrateRequested: number;
  hits: CatalogHit[];
}
