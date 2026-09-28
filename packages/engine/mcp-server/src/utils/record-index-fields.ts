// record-index-fields — the per-persona index fields a FamilySearch record
// carries in its RAW GedcomX `fields[]`, lifted onto the staged sidecar so the
// code extractor can read them.
//
// WHY THIS EXISTS. `toSimplified` drops `fields[]` entirely (it maps persons,
// names, facts, sources and places and nothing else), and `fields[]` is where a
// census keeps the two things a role rule needs: which person is the head, and
// what order the household was enumerated in. Adding them to simplified GedcomX
// was rejected — that is a tree-schema change with its own multi-site edit list
// (CLAUDE.md, "Tree-schema (simplified-GedcomX) change") for data no tree person
// should ever carry. So they ride on the STAGED RESULT, beside `gedcomx`, the
// same way `record-search.ts` already lifts `batchNumber` and `role`.
//
// WHY ONLY `record_read` LIFTS THEM. A `record_search` response populates
// `fields[]` for the SEARCHED persona only — every co-resident comes back with
// names and facts and `fields: (none)`. Measured across three census collections
// in `dev/probe-census-persona-fields.ts`: 1 of 6, 1 of 8 and 1 of 4 personas
// carried fields from search, against 6/6, 8/8 and 4/4 from the raw
// `record_read` body. A search sidecar therefore cannot feed a per-person role
// rule, which is why the extractor takes a `record_read` sidecar (lead ruling
// 2026-09-28) and why there is no search-side lift.
//
// CASING: camelCase, matching its neighbours on the staged element (`recordId`,
// `primaryId`, `batchNumber`, `role`). The staged result is a tool response
// persisted verbatim, not a hand-authored project document — CLAUDE.md's
// snake_case rule covers `research.json` and simplified GedcomX, and a lone
// snake_case key among camelCase neighbours is the mistake that rule exists to
// prevent.

/** The raw-GedcomX label ids this module reads. Each is a `labelId` on a
 *  `fields[].values[]` entry hanging off a PERSON (not the root, not a fact).
 *
 *  Presence is per collection and NOT uniform — the whole reason the census
 *  year table is hard-coded rather than read. Measured presence, one household
 *  per collection (`dev/probe-census-persona-fields.ts`):
 *
 *    label                      US 1880   US 1850   E&W 1861
 *    PR_RELATIONSHIP_TO_HEAD      6/6       0/8       4/4
 *    SOURCE_PERSON_NBR_ORIG       6/6       0/8       0/4
 *    PR_EXT_LINE_NBR_ORIG         6/6       0/8       0/4
 *    SOURCE_HOUSEHOLD_ID_ORIG     6/6       8/8       4/4
 *    FS_SORT_KEY                  6/6       8/8       4/4
 */
const LABELS = {
  relationshipToHead: ["PR_RELATIONSHIP_TO_HEAD", "PR_RELATIONSHIP_TO_HEAD_ORIG"],
  sortKey: ["FS_SORT_KEY"],
  personNbr: ["SOURCE_PERSON_NBR_ORIG", "SOURCE_PERSON_NBR"],
  lineNbr: ["PR_EXT_LINE_NBR_ORIG", "PR_EXT_LINE_NBR"],
  householdId: ["SOURCE_HOUSEHOLD_ID_ORIG", "SOURCE_HOUSEHOLD_ID"],
  age: ["PR_AGE", "PR_AGE_ORIG"],
  fatherBirthPlace: ["PR_FTHR_BIR_PLACE", "PR_FTHR_BIR_PLACE_ORIG"],
  motherBirthPlace: ["PR_MTHR_BIR_PLACE", "PR_MTHR_BIR_PLACE_ORIG"],
} as const;

/**
 * One persona's index fields. Every field is optional: no collection carries
 * all of them, and a consumer that assumes otherwise is reading a US-1880 shape
 * onto an 1850 record.
 */
export interface PersonaIndexFields {
  /** The relationship-to-head string AS INDEXED, normalized spelling preferred
   *  (`Dau` → `Daughter`; the probe observed both on one record).
   *
   *  **Presence does NOT mean the schedule had a relationship column.** The
   *  1870 US census has no such column, yet FamilySearch's index supplies
   *  `"Head"` on 8 of 8 probed records. Whether the column existed is decided
   *  by jurisdiction and year, never by reading this field — see the year table
   *  in `record-extract.ts`. */
  relationshipToHead?: string;
  /** The enumeration order key. Present on every probed record (24/24 across US
   *  1850/1860/1870), where `personNbr` and `lineNbr` are not. Ends in a
   *  zero-padded person ordinal. */
  sortKey?: string;
  /** Person number within the source page. US 1880 only, of the probed set. */
  personNbr?: string;
  /** Line number on the schedule. US 1880 only, of the probed set. */
  lineNbr?: string;
  /** Groups co-residents. A record can hold more than one household, so roles
   *  are assigned per household and not per record. */
  householdId?: string;
  age?: string;
  fatherBirthPlace?: string;
  motherBirthPlace?: string;
}

/** Read one label off a raw person's `fields[]`, first match wins. */
function readLabel(person: unknown, labels: readonly string[]): string | undefined {
  const fields = (person as { fields?: unknown })?.fields;
  if (!Array.isArray(fields)) return undefined;
  for (const label of labels) {
    for (const field of fields) {
      const values = (field as { values?: unknown })?.values;
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const v = value as { labelId?: unknown; text?: unknown };
        if (v?.labelId === label && typeof v.text === "string" && v.text.trim() !== "") {
          return v.text;
        }
      }
    }
  }
  return undefined;
}

/** Lift one raw person's index fields, or `undefined` when it carries none.
 *  Returning `undefined` rather than `{}` keeps the staged envelope free of
 *  empty objects for the persona-less majority of record types. */
export function personaIndexFields(person: unknown): PersonaIndexFields | undefined {
  const out: PersonaIndexFields = {};
  let any = false;
  for (const [key, labels] of Object.entries(LABELS)) {
    const v = readLabel(person, labels);
    if (v !== undefined) {
      (out as Record<string, string>)[key] = v;
      any = true;
    }
  }
  return any ? out : undefined;
}

/**
 * Lift every persona's index fields off a RAW GedcomX body, keyed by the
 * person's `id` so the result joins straight onto `gedcomx.persons[].id` in the
 * simplified document staged beside it.
 *
 * Returns `undefined` when no person carried anything, so a record type with no
 * index fields stages exactly what it staged before this existed.
 */
export function recordIndexFields(
  rawBody: unknown,
): Record<string, PersonaIndexFields> | undefined {
  const persons = (rawBody as { persons?: unknown })?.persons;
  if (!Array.isArray(persons)) return undefined;
  const out: Record<string, PersonaIndexFields> = {};
  let any = false;
  for (const p of persons) {
    const id = (p as { id?: unknown })?.id;
    if (typeof id !== "string" || id === "") continue;
    const fields = personaIndexFields(p);
    if (fields) {
      out[id] = fields;
      any = true;
    }
  }
  return any ? out : undefined;
}
