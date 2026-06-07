// FamilySearch Search API Response Types
// GET https://www.familysearch.org/service/search/hr/v2/personas

import type { SimplifiedGedcomX } from "./gedcomx.js";

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
}
