// FamilySearch Tree Search API response + tool I/O types
// GET https://api.familysearch.org/platform/tree/search

import type { SimplifiedGedcomX } from "./gedcomx.js";

// ─── Upstream (FS) response shapes ──────────────────────────────────────
// Only the fields the tool reads directly are declared. The matched person
// is otherwise passed straight to `toSimplified` (cast to GedcomX), which
// reads the full runtime structure (names, facts, gender, identifiers).

export interface FSTreeSearchPerson {
  id?: string;
  identifiers?: Record<string, string[]>;
}

export interface FSTreeSearchGedcomx {
  id?: string;
  description?: string;
  persons?: FSTreeSearchPerson[];
  relationships?: unknown[];
}

export interface FSTreeSearchEntry {
  id?: string;
  title?: string;
  score?: number;
  confidence?: number;
  content?: { gedcomx?: FSTreeSearchGedcomx };
}

export interface FSTreeSearchResponse {
  results?: number;
  index?: number;
  links?: { next?: { href?: string } };
  entries?: FSTreeSearchEntry[];
}

// ─── Tool I/O ───────────────────────────────────────────────────────────

export interface PersonSearchInput {
  givenName?: string;
  surname?: string;
  sex?: string;
  givenNameExact?: boolean;
  surnameExact?: boolean;

  birthYearFrom?: number;
  birthYearTo?: number;
  birthYearExact?: boolean;
  birthPlace?: string;
  birthPlaceExact?: boolean;

  deathYearFrom?: number;
  deathYearTo?: number;
  deathYearExact?: boolean;
  deathPlace?: string;
  deathPlaceExact?: boolean;

  marriageYearFrom?: number;
  marriageYearTo?: number;
  marriageYearExact?: boolean;
  marriagePlace?: string;
  marriagePlaceExact?: boolean;

  residenceYearFrom?: number;
  residenceYearTo?: number;
  residenceYearExact?: boolean;
  residencePlace?: string;
  residencePlaceExact?: boolean;

  spouseGivenName?: string;
  spouseSurname?: string;
  spouseGivenNameExact?: boolean;
  spouseSurnameExact?: boolean;

  fatherGivenName?: string;
  fatherSurname?: string;
  fatherGivenNameExact?: boolean;
  fatherSurnameExact?: boolean;
  fatherBirthPlace?: string;
  fatherBirthPlaceExact?: boolean;

  motherGivenName?: string;
  motherSurname?: string;
  motherGivenNameExact?: boolean;
  motherSurnameExact?: boolean;
  motherBirthPlace?: string;
  motherBirthPlaceExact?: boolean;

  parentGivenName?: string;
  parentSurname?: string;
  parentGivenNameExact?: boolean;
  parentSurnameExact?: boolean;
  parentBirthPlace?: string;
  parentBirthPlaceExact?: boolean;

  count?: number;
  offset?: number;
}

export interface PersonSearchResult {
  // Bare Family-Tree person ID (e.g. "LZJW-C31"); the handle for person_read.
  personId: string;
  // Search-relevance metadata — not part of any GedcomX.
  score?: number;
  confidence?: number;
  // The matched person only (id, ark, gender, names, facts). No relatives.
  gedcomx: SimplifiedGedcomX;
}

export interface PersonSearchToolResponse {
  query: Partial<PersonSearchInput>;
  totalMatches: number;
  paginationCappedAt: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  results: PersonSearchResult[];
}
