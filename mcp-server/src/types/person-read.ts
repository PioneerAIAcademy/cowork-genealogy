// person_read tool I/O types and FS-extended GEDCOMX response types.
// See docs/specs/person-read-tool-spec.md.
//
// The person_read tool returns *simplified* GEDCOMX (per the shared
// docs/specs/simplified-gedcomx-spec.md), but the FamilySearch API
// returns FS-extended GEDCOMX which has a few fields beyond what the
// shared `GedcomX` type models — notably `person.living` and the
// `childAndParentsRelationships[]` array. Those FS-specific shapes
// live here.

import type {
  GedcomXFact,
  GedcomXPerson,
  GedcomXSourceDescription,
} from "./gedcomx.js";

// ─── Tool I/O ─────────────────────────────────────────────────────────────

export interface PersonReadToolInput {
  personId: string;
  relatives?: boolean;
  sourceDescriptions?: boolean;
}

export interface TreeName {
  given: string;
  surname: string;
  prefix?: string;
  suffix?: string;
}

export interface TreeFact {
  id?: string;
  type: string;
  primary?: boolean;
  date?: string;
  standard_date?: string;
  place?: string;
  value?: string;
}

export interface TreePerson {
  id: string;
  gender: string;
  living: boolean;
  names: TreeName[];
  facts?: TreeFact[];
}

export interface TreeRelationship {
  type: "ParentChild" | "Couple";
  parent?: string;
  child?: string;
  subtype?: string;
  person1?: string;
  person2?: string;
  facts?: TreeFact[];
}

export interface TreeSource {
  id: string;
  title: string;
  citation?: string;
  url?: string;
  notes?: string[];
}

export interface PersonReadResult {
  persons: TreePerson[];
  relationships: TreeRelationship[];
  sources: TreeSource[];
}

// ─── FS-extended GEDCOMX (raw API response) ───────────────────────────────

export interface FSPerson extends GedcomXPerson {
  living?: boolean;
}

export interface FSFact extends GedcomXFact {
  value?: string;
}

export interface FSResourceRef {
  resource?: string;
  resourceId?: string;
}

export interface FSChildAndParentsRelationship {
  id?: string;
  parent1?: FSResourceRef;
  parent2?: FSResourceRef;
  child?: FSResourceRef;
  parent1Facts?: FSFact[];
  parent2Facts?: FSFact[];
}

// FS relationship entries in `relationships[]` (couples, bare
// ParentChild). Unlike standard GEDCOMX — whose person refs expose only
// `resource` — the FS tree API returns `resourceId`-only refs here, so
// `person1`/`person2` must reuse `FSResourceRef`.
export interface FSRelationship {
  id?: string;
  type?: string;
  person1?: FSResourceRef;
  person2?: FSResourceRef;
  facts?: FSFact[];
}

export interface FSSourceDescription extends GedcomXSourceDescription {
  notes?: Array<{ value?: string }>;
  resourceType?: string;
}

export interface FSTreeResponse {
  persons?: FSPerson[];
  relationships?: FSRelationship[];
  childAndParentsRelationships?: FSChildAndParentsRelationship[];
  sourceDescriptions?: FSSourceDescription[];
}
