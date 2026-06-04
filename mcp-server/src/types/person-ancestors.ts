// FamilySearch Read Ancestry API response + tool I/O types.
// GET https://api.familysearch.org/platform/tree/ancestry
//
// Only the fields the tool reads directly are declared with precision; the
// names/gender/facts/sources/identifiers are otherwise passed straight to
// `toSimplified` (cast to GedcomX), which reads the full runtime structure.

import type { SimplifiedPerson, SimplifiedRelationship } from "./gedcomx.js";

// ─── Upstream (FS) response shapes ──────────────────────────────────────────

export interface FSAncestryDisplay {
  // Ahnentafel position — a STRING ("1", "2", "1-S"); the only field that
  // encodes the pedigree. `toSimplified` ignores the whole display block, so
  // the tool re-attaches this onto each converted person.
  ascendancyNumber?: string;
  name?: string;
  lifespan?: string;
}

export interface FSAncestryPerson {
  id?: string;
  living?: boolean;
  gender?: { type?: string };
  names?: unknown[];
  facts?: unknown[];
  sources?: unknown[];
  identifiers?: Record<string, string[]>;
  display?: FSAncestryDisplay;
}

export interface FSAncestryResponse {
  persons?: FSAncestryPerson[];
  relationships?: unknown[];
}

// ─── Tool I/O ───────────────────────────────────────────────────────────────

export interface PersonAncestorsInput {
  personId: string;
  generations?: number;
  spouse?: string;
  personDetails?: boolean;
  marriageDetails?: boolean;
  descendants?: boolean;
}

// A simplified person plus the one ancestry-specific field. `ascendancyNumber`
// has no slot in standard simplified GedcomX, so it is added here.
export interface AncestorPerson extends SimplifiedPerson {
  ascendancyNumber: string;
}

// The pedigree as a simplified GedcomX graph, returned directly (no envelope),
// the same shape `person_read` returns. `relationships` is present only when
// `marriageDetails` is requested.
export interface PersonAncestorsResult {
  persons: AncestorPerson[];
  relationships?: SimplifiedRelationship[];
}
