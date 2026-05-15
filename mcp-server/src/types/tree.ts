// Tree tool I/O types and FS-extended GEDCOMX response types.
// See docs/specs/tree-tool-spec.md.
//
// The tree tool returns *simplified* GEDCOMX (per the shared
// docs/specs/simplified-gedcomx-spec.md), but the FamilySearch API
// returns FS-extended GEDCOMX which has a few fields beyond what the
// shared `GedcomX` type models — notably `person.living` and the
// `childAndParentsRelationships[]` array. Those FS-specific shapes
// live here.

import type {
  GedcomXFact,
  GedcomXPerson,
  GedcomXRelationship,
  GedcomXSourceDescription,
} from "./gedcomx.js";

// ─── Tool I/O ─────────────────────────────────────────────────────────────

export interface TreeToolInput {
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
  type: string;
  date?: string;
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

export interface TreeResult {
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

export interface FSSourceDescription extends GedcomXSourceDescription {
  notes?: Array<{ value?: string }>;
  resourceType?: string;
}

export interface FSTreeResponse {
  persons?: FSPerson[];
  relationships?: GedcomXRelationship[];
  childAndParentsRelationships?: FSChildAndParentsRelationship[];
  sourceDescriptions?: FSSourceDescription[];
}
