// tree_gaps tool I/O + the FamilySearch descendancy/ancestry shapes it reads.
// GET /platform/tree/ancestry and /platform/tree/descendancy with
// personDetails=true. Spec: docs/specs/tree-gaps-tool-spec.md.

// ─── Upstream (FS) shapes — only what the tool reads ───────────────────────

export interface FSGapDisplay {
  ascendancyNumber?: string;
  descendancyNumber?: string;
  name?: string;
  gender?: string;
  lifespan?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  marriageDate?: string;
  marriagePlace?: string;
}

export interface FSGapName {
  nameForms?: { fullText?: string; parts?: { type?: string; value?: string }[] }[];
}

export interface FSGapPerson {
  id?: string;
  living?: boolean;
  display?: FSGapDisplay;
  names?: FSGapName[];
}

export interface FSGapResponse {
  persons?: FSGapPerson[];
}

// ─── Tool I/O ───────────────────────────────────────────────────────────────

export interface TreeGapsInput {
  // Omit to use the logged-in user's own tree person.
  personId?: string;
  // Generations of ancestors to read (1-8). Default 8.
  ancestorGenerations?: number;
  // Generations of the root's descendants to read (0-4). Default 4.
  descendantGenerations?: number;
  // Stop reading once this many holes have been found (1-50). Default 20.
  maxHoles?: number;
}

export type TreeGapType =
  | "missing_parents"
  | "no_children"
  | "child_gap"
  | "early_last_child"
  | "missing_surname"
  | "no_birth_info"
  | "no_spouse"
  | "no_death_date";

export interface TreeGapYearRange {
  start: number;
  end: number;
}

// How specific a place string is, by its comma-separated parts: "Ghana" is a
// country, "Central, Ghana" a region, a three-part place a county or district,
// anything longer a locality.
export type PlaceLevel = "country" | "region" | "county" | "locality";

// How many catalog collections could hold the record the hole needs. Scored
// from the cached collections catalog: title match on the place's collection
// scope, year overlap, and record-type facet. `null` on the hole when the
// catalog was unavailable or the hole has no place.
export interface TreeGapCoverage {
  collections: number;
  records: number;
  recordTypes: string[];
  // Census years inside the hole's window, from census collections the catalog
  // lists for the place (single-year collections only).
  censusYears: number[];
  placeLevel: PlaceLevel;
}

export interface TreeGap {
  type: TreeGapType;
  personId: string;
  name: string;
  // The other half of the couple, for couple-level holes.
  spouseId?: string;
  spouseName?: string;
  // FamilySearch's own lifespan string, e.g. "1809-1865".
  lifespan: string | null;
  // Signed generations from the root: positive = above (ancestors and their
  // collateral lines), 0 = the root's generation, negative = below.
  generation: number;
  // Plain-words description of the hole.
  detail: string;
  // The period and place to search; null when the tree gives neither.
  yearRange: TreeGapYearRange | null;
  place: string | null;
  coverage: TreeGapCoverage | null;
}

export interface TreeGapsResult {
  root: { personId: string; name: string };
  gaps: TreeGap[];
  scanned: {
    ancestorGenerations: number;
    descendantGenerations: number;
    persons: number;
    descendancyReads: number;
    // True when a read cap, the time budget or maxHoles stopped the walk early.
    stoppedEarly: boolean;
    stopReason: "maxHoles" | "readCap" | "timeBudget" | null;
  };
  notes: string[];
}
