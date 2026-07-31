// FamilySearch Search API Response Types
// GET https://www.familysearch.org/service/search/hr/v2/personas

import type { SimplifiedGedcomX } from "./gedcomx.js";
import type { RankSearchMatchesResult } from "./rank-search-matches.js";
import type { JurisdictionCandidate } from "../utils/marriage-jurisdictions.js";

export interface FSDisplay {
  name?: string;
  gender?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  role?: string;
}

export interface FSFact {
  type: string;
  date?: { original?: string };
  place?: { original?: string };
  value?: string;
}

export interface FSNameForm {
  fullText?: string;
}

export interface FSName {
  nameForms?: FSNameForm[];
}

export interface FSPerson {
  principal?: boolean;
  id?: string;
  display?: FSDisplay;
  names?: FSName[];
  gender?: { type?: string };
  facts?: FSFact[];
  identifiers?: Record<string, string[]>;
}

export interface FSSourceTitle {
  value?: string;
}

export interface FSSourceDescription {
  resourceType?: string;
  about?: string;
  titles?: FSSourceTitle[];
  identifiers?: Record<string, string[]>;
}

export interface FSGedcomx {
  persons?: FSPerson[];
  sourceDescriptions?: FSSourceDescription[];
}

export interface FSEntryContent {
  gedcomx?: FSGedcomx;
}

export interface FSHint {
  id?: string;
  stars?: number;
}

export interface FSSearchEntry {
  id?: string;
  score?: number;
  confidence?: number;
  hints?: FSHint[];
  content?: FSEntryContent;
}

export interface FSLink {
  href?: string;
}

export interface FSSearchResponse {
  results?: number;
  index?: number;
  links?: { next?: FSLink };
  entries?: FSSearchEntry[];
}

// Tool I/O Types

export type Sex = "Male" | "Female" | "Unknown";

export type MaritalStatus = "Married" | "Single" | "Divorced" | "Widowed";

export type RecordType =
  | "birth"
  | "marriage"
  | "death"
  | "census"
  | "immigration"
  | "military"
  | "probate"
  | "other";

export interface RecordSearchInput {
  // When set, the tool stages its verbatim response to results/.staging/ and
  // returns a `staged` handle (search-result-staging-spec.md). Purely additive:
  // omitting it leaves behavior identical to before.
  // When set, results are staged host-side AND the inline per-result `gedcomx`
  // is dropped (unconditionally) so a broad search can't overflow the model's
  // context — the staged file (read by rank_search_matches / research_log_append)
  // carries the full gedcomx; the inline stubs keep the flat fields. An
  // un-staged (no projectPath) search returns full gedcomx inline as before.
  projectPath?: string;
  // A `persons[].id` in the project's tree.gedcomx.json. When supplied together
  // with `projectPath`, the tool ranks the staged candidates against that
  // subject host-side and returns them match-ranked — the work that used to
  // require a separate `rank_search_matches` call the model had to remember.
  //
  // It is a tool contract rather than a documented step because a documented
  // step decays: measured over one real session, "always call
  // rank_search_matches" held at 77% while the skill body was resident and fell
  // to 3% once compaction evicted it, whereas every rule with a structural
  // anchor held at 100% (docs/plan/research-performance-2026-07-27.md §5.3).
  //
  // Ranking is best-effort and never fails the search: on any ranking error the
  // results come back unranked with `rankingError` set.
  subjectId?: string;
  surname?: string;
  givenName?: string;
  surnameAlt?: string;
  givenNameAlt?: string;
  sex?: string;
  surnameExact?: boolean;
  givenNameExact?: boolean;

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

  anyYearFrom?: number;
  anyYearTo?: number;
  anyYearExact?: boolean;
  anyPlace?: string;
  anyPlaceExact?: boolean;

  spouseGivenName?: string;
  spouseSurname?: string;
  spouseGivenNameExact?: boolean;
  spouseSurnameExact?: boolean;
  fatherGivenName?: string;
  fatherSurname?: string;
  fatherGivenNameExact?: boolean;
  fatherSurnameExact?: boolean;
  motherGivenName?: string;
  motherSurname?: string;
  motherGivenNameExact?: boolean;
  motherSurnameExact?: boolean;
  parentGivenName?: string;
  parentSurname?: string;
  parentGivenNameExact?: boolean;
  parentSurnameExact?: boolean;
  otherGivenName?: string;
  otherSurname?: string;
  otherGivenNameExact?: boolean;
  otherSurnameExact?: boolean;

  collectionId?: string;
  imageGroupNumber?: string;
  recordCountry?: string;
  recordSubdivision?: string;
  recordType?: string;
  maritalStatus?: string;
  isPrincipal?: boolean;

  // Results per page. Default 50 when `subjectId` is supplied (ranking is
  // active, so a deep pool is worth fetching — the re-ranker cuts it back);
  // otherwise 20. The two are deliberately coupled: a deep pool without
  // ranking is 50 raw stubs for the model to triage by hand, which is the
  // waste this default exists to avoid, not create.
  count?: number;
  offset?: number;
}

export interface RecordSearchEvent {
  type: string;
  date?: string;
  place?: string;
  value?: string;
}

export interface TreeMatch {
  treePersonId: string;
  stars: number;
}

export interface RecordSearchResult {
  // The record-persona ARK in canonical form, e.g.
  // "ark:/61903/1:1:QPRC-WPBZ". Feed directly to record_read's `recordId`,
  // the record-match tools' `id`, or source_attachments' `uris`.
  recordId: string;
  personName?: string;
  score?: number;
  confidence?: number;
  sex?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  events: RecordSearchEvent[];
  collectionId?: string;
  collectionTitle?: string;
  collectionUrl?: string;
  recordTitle?: string;
  // The source record/image ARK (the 1:2: entry), e.g.
  // "ark:/61903/1:2:HSJG-CLNF". Canonical ARK form.
  recordArk?: string;
  treeMatches: TreeMatch[];
  // Simplified-GedcomX document for this entry, derived from the raw
  // GedcomX FamilySearch returned. Pass it straight to `same_person`
  // as gedcomx1/gedcomx2 — no hand-reconstruction needed.
  gedcomx?: SimplifiedGedcomX;
  // The `id` of the focus person inside `gedcomx.persons[]`. Pass it to
  // `same_person` as primaryId1/primaryId2.
  primaryId?: string;
}

export interface RecordSearchToolResponse {
  query: Partial<RecordSearchInput>;
  totalMatches: number;
  paginationCappedAt: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  results: RecordSearchResult[];
  // collectionId → collectionTitle for every collection in `results`, present
  // only on a STAGED response. The per-result `collectionTitle` repeats one of a
  // handful of strings on every row (9.4% of inline row bytes, measured); hoisting
  // it here says the same thing once. The staged sidecar keeps the per-row copy.
  collections?: Record<string, string>;
  // Present only when `subjectId` was supplied and ranking succeeded: the
  // candidates re-ordered by FamilySearch match score against the subject,
  // carrying `matchScore` / `matchRank` / `searchRank`. `results` is left in
  // FamilySearch's own search order so nothing that reads it changes meaning.
  ranked?: RankSearchMatchesResult;
  // Set only when ranking was requested and failed — the search itself
  // succeeded, and `results` is usable unranked. Ranking degrading must never
  // take the search down with it (the reason the two stayed separate tools).
  rankingError?: string;
  // Present only when `projectPath` was supplied. The host-staged handle to pass
  // to research_log_append as `stagedResultsRef`; null for a nil search or when
  // staging failed (see `stagingError`).
  staged?: { resultsRef: string; returnedCount: number } | null;
  // Set only when staging was attempted and failed — the search still succeeded.
  stagingError?: string;
  // Present only on a marriage search that did not find the subject — no hits, or
  // ranking reporting `subjectResolvable: false` — made with `projectPath` +
  // `subjectId`, and scoped to something narrower than a country. Carries the
  // other jurisdictions these people are on record as having been, ordered by
  // distance from the search's own marriage date window (NOT earliest-first; that
  // ordering was measured harmful, see the spec). A marriage is filed where the
  // wedding happened, not where the couple later lived, so a miss in one place is
  // a prompt to try the others, not a finding. Advisory only; nothing downstream
  // depends on it.
  jurisdictionHints?: {
    searchedPlace?: string;
    candidates: JurisdictionCandidate[];
    note: string;
  };
}
