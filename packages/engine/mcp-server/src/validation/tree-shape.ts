// The simplified-GedcomX field allow-lists, one set per object type. Each set
// mirrors the matching `additionalProperties: false` subschema in
// tree-gedcomx.schema.json. Shared by the runtime validator (which REJECTS
// unknown keys at the tool boundary) and the read-time sanitizer (which HEALS
// legacy documents written before the shapes were closed) — one source of
// truth so the two can never disagree about what the format is.

export const TREE_TOP_LEVEL_FIELDS = new Set(["persons", "relationships", "sources"]);
export const TREE_PERSON_FIELDS = new Set(["id", "ark", "living", "gender", "names", "facts"]);
export const TREE_NAME_FIELDS = new Set([
  "id", "preferred", "given", "surname", "prefix", "suffix", "type", "sources",
]);
export const TREE_FACT_FIELDS = new Set([
  "id", "type", "primary", "date", "standard_date", "place",
  "standard_place", "value", "sources",
]);
// ParentChild/Couple sets include the other type's endpoint keys so the
// bespoke "should use 'parent'/'child'" style errors stay the single report
// for a swapped-endpoint mistake (no duplicate unknown-key error), and so the
// sanitizer never silently deletes an endpoint it cannot re-derive.
export const TREE_PARENT_CHILD_FIELDS = new Set([
  "id", "type", "parent", "child", "subtype", "notes", "sources",
  "person1", "person2",
]);
export const TREE_COUPLE_FIELDS = new Set([
  "id", "type", "person1", "person2", "facts", "notes", "sources",
  "parent", "child",
]);
export const TREE_SOURCE_FIELDS = new Set(["id", "title", "citation", "author", "url"]);
export const TREE_SOURCE_REF_FIELDS = new Set(["ref", "page", "quality"]);
