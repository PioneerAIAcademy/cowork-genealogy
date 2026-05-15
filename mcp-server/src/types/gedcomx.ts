// GedcomX types — the subset of standard GedcomX that FamilySearch returns
// through `tree` and `cets` endpoints. See `docs/specs/gedcomx-convert-spec.md`.

export interface GedcomX {
  persons?: GedcomXPerson[];
  relationships?: GedcomXRelationship[];
  sourceDescriptions?: GedcomXSourceDescription[];
  places?: GedcomXPlaceDescription[];
}

export interface GedcomXPerson {
  id?: string;
  gender?: { type: string };
  names?: GedcomXName[];
  facts?: GedcomXFact[];
  sources?: GedcomXSourceReference[];
}

export interface GedcomXName {
  id?: string;
  type?: string;
  preferred?: boolean;
  nameForms?: GedcomXNameForm[];
  sources?: GedcomXSourceReference[];
}

export interface GedcomXNameForm {
  lang?: string;
  fullText?: string;
  parts?: GedcomXNamePart[];
}

export interface GedcomXNamePart {
  type?: string;
  value?: string;
}

export interface GedcomXFact {
  id?: string;
  type?: string;
  primary?: boolean;
  date?: { original?: string; formal?: string };
  place?: { original?: string; description?: string };
  sources?: GedcomXSourceReference[];
}

export interface GedcomXRelationship {
  id?: string;
  type?: string;
  person1?: { resource: string };
  person2?: { resource: string };
  facts?: GedcomXFact[];
  notes?: GedcomXNote[];
  sources?: GedcomXSourceReference[];
}

export interface GedcomXNote {
  subject?: string;
  text?: string;
  lang?: string;
}

export interface GedcomXSourceReference {
  description?: string;
  qualifiers?: GedcomXQualifier[];
}

export interface GedcomXQualifier {
  name: string;
  value?: string;
}

export interface GedcomXSourceDescription {
  id?: string;
  titles?: { value: string }[];
  citations?: { value: string }[];
  about?: string;
}

export interface GedcomXPlaceDescription {
  id?: string;
  names?: { value: string }[];
  latitude?: number;
  longitude?: number;
}

// SimplifiedGedcomX types — token-efficient format for LLM consumption.
// Normatively defined by `docs/specs/simplified-gedcomx-spec.md`.

export interface SimplifiedGedcomX {
  persons?: SimplifiedPerson[];
  relationships?: SimplifiedRelationship[];
  sources?: SimplifiedSourceDescription[];
  places?: SimplifiedPlaceDescription[];
}

export interface SimplifiedPerson {
  id?: string;
  gender?: string;
  names?: SimplifiedName[];
  facts?: SimplifiedFact[];
  sources?: SimplifiedSourceReference[];
}

export interface SimplifiedName {
  id?: string;
  type?: string;
  preferred?: boolean;
  prefix?: string;
  given?: string;
  surname?: string;
  suffix?: string;
  sources?: SimplifiedSourceReference[];
}

export interface SimplifiedFact {
  id?: string;
  type?: string;
  primary?: boolean;
  date?: string;
  place?: string;
  sources?: SimplifiedSourceReference[];
}

export interface SimplifiedRelationship {
  id?: string;
  type?: string;
  parent?: string;
  child?: string;
  subtype?: string;
  person1?: string;
  person2?: string;
  facts?: SimplifiedFact[];
  notes?: string[];
  sources?: SimplifiedSourceReference[];
}

export interface SimplifiedSourceReference {
  ref?: string;
  page?: string;
  quality?: string;
}

export interface SimplifiedSourceDescription {
  id?: string;
  title?: string;
  citation?: string;
  url?: string;
}

export interface SimplifiedPlaceDescription {
  id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
}
