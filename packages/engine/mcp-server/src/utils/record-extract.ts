// record-extract — the code extractor for a FamilySearch-indexed record.
//
// A PURE function over a sidecar-shaped document: no I/O, no network, no store.
// `extraction_append` reads the document out of a log entry's sidecar and hands
// it here; issue #2939 will add a second entry point that takes the document
// inline, which is why the shape is a parameter rather than something this
// module fetches.
//
// WHY THIS IS CODE. Measured over the committed e2e corpus (issue #2937):
// across repeat runs of one fixture the model gives the same persona the same
// role only 62.9% of the time (81.8% by role class), and differs with itself on
// `record_basis` 15.6%, `informant_proximity` 22.6% and `information_quality`
// 21.4%. Code is identical every time.
//
// The rule below agrees with the model on **84.6% of personas by role class**
// (930/1099 comparisons across 319 records), reproducible offline with
// `npx tsx dev/score-roles.ts`. Agreement is NOT accuracy: the model is not
// ground truth, and the two largest disagreement clusters were opened and found
// to be the model's error — `deceased` roled onto a Liechtenstein baptism, and
// `child_N` assigned from position on a pre-1880 census. Both depress that
// figure, which is the right direction for the instrument to be wrong in.
//
// WHAT IT DOES NOT DO. It never emits the literal `record_role: "absent"` —
// negative evidence is a claim about a person the record does NOT contain, so
// the caller supplies those. It never writes identity links. It never decides
// which questions a fact answers; `extracted_for_question_ids` is the caller's.

import type { SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";
import type { PersonaIndexFields } from "./record-index-fields.js";
import type { DocumentMode } from "./structured-document.js";

// ─── input / output ─────────────────────────────────────────────────────────

/** The staged element shape, as `record_read` writes it. */
export interface ExtractDocument {
  recordId: string;
  gedcomx: SimplifiedGedcomX;
  indexFields?: Record<string, PersonaIndexFields>;
}

export interface ExtractOptions {
  /** The log entry whose sidecar carried this document. Stamped on every
   *  assertion so provenance is recoverable. */
  logEntryId: string;
  /** The open questions this extraction serves. Caller's call — relative to the
   *  research question, not to the record. */
  questionIds: string[];
  /** Set only for an unindexed source the record-structurer agent read
   *  (spec §11.7): what the document says that a sidecar has no field for. */
  mode?: DocumentMode;
  // NO `evidenceType`. Issue #2937 lists it among the three things the caller
  // still supplies, but that field was RENAMED to `record_basis` on 2026-09-18
  // (the retired-identifier registry in enums.schema.json;
  // tests/packaging/retired-field-names.test.ts bans the old spelling), and the
  // GPS direct/indirect/negative judgment it used to carry is deliberately NOT
  // PERSISTED at all — it is relative to the question being asked, not to the
  // record. `record_basis` is what survives, and the extractor computes it per
  // assertion from the record itself. There is nothing here for a caller to
  // default.
}

/** One assertion entry, ready for `research_append` to assign an id and a
 *  `source_id`. snake_case: this is the persisted `research.json` shape. */
export interface ExtractedAssertion {
  record_id: string;
  record_persona_id?: string;
  record_role: string;
  fact_type: string;
  value: string;
  date?: string;
  place?: string;
  standard_place?: string;
  information_quality: string;
  informant: string;
  informant_proximity: string;
  informant_bias_notes?: string;
  record_basis: string;
  log_entry_id: string;
  extracted_for_question_ids: string[];
  structured_value?: Record<string, unknown>;
  date_certainty?: string;
}

export interface ExtractResult {
  recordType: RecordType;
  /** `true` when the census schedule carried a relationship column, decided by
   *  the year table and NEVER by whether the field is populated. `undefined`
   *  for a non-census record. */
  censusStatesRelationships?: boolean;
  assertions: ExtractedAssertion[];
  /** One line per assertion that took the `unknown`/`indeterminate` DEFAULT
   *  rather than a classification-table row. Surfaced by the caller as
   *  `validation.warnings`, because `unknown` switches off
   *  `contradictionIsCredible` and a missing table row must be visible rather
   *  than quietly weakening a guard. */
  defaultedClassifications: string[];
  /** Anything the caller should say out loud — a second household, a role the
   *  rule could not name. */
  notes: string[];
}

// ─── the census relationship-column year table ──────────────────────────────

/**
 * When a census schedule began carrying a relationship-to-head column.
 *
 * **HARD-CODED, by lead ruling 2026-09-27, and decided from jurisdiction and
 * year — never from whether the field is populated.** The distinction is not
 * pedantry: `dev/probe-census-persona-fields.ts` found the 1870 US census, which
 * has NO relationship column, carrying an indexer-supplied
 * `PR_RELATIONSHIP_TO_HEAD="Head"` on 8 of 8 probed records. A rule keyed on
 * presence would read 1870 as a stated-relationship census and emit parent-child
 * assertions the schedule never made. The converse failure is just as real in
 * the other direction: a blank indexer cell on one person of an 1880 household
 * looks identical to a schedule with no column.
 *
 * Measured corroboration, one household per collection: the field is on 6/6
 * US-1880 personas, 4/4 E&W-1861, and 0/8 US-1850.
 *
 * Issue #2805 drops its wiki route for census years and cites this table.
 * Issue #2475 owns the writer-side refusal that applies it.
 */
const RELATIONSHIP_COLUMN_FROM: { test: RegExp; from: number; label: string }[] = [
  { test: /\bunited states\b|\bu\.?s\.?a?\b/i, from: 1880, label: "United States" },
  { test: /\bengland\b|\bwales\b|\bunited kingdom\b/i, from: 1851, label: "England and Wales" },
];

/** Whether this census schedule stated relationships. `null` when the
 *  jurisdiction is not in the table — the caller then treats relationships as
 *  unstated, which is the conservative direction: it withholds assertions
 *  rather than inventing them. */
export function censusStatedRelationships(
  place: string | undefined,
  year: number | undefined,
): boolean | null {
  if (!place || year === undefined) return null;
  for (const row of RELATIONSHIP_COLUMN_FROM) {
    if (row.test.test(place)) return year >= row.from;
  }
  return null;
}

// ─── record type ────────────────────────────────────────────────────────────

export type RecordType =
  | "census"
  | "marriage"
  | "death"
  | "burial"
  | "birth"
  | "christening"
  | "land"
  | "draft_registration"
  | "obituary"
  | "probate"
  | "newspaper_announcement"
  | "other";

/** `grave` for Find a Grave, the commonest burial index in the scorer corpus. */
const BURIAL_TITLE = /burial|cemeter|interment|\bgraves?\b/i;

const TITLE_TO_RECORD: [RegExp, RecordType][] = [
  [/census/i, "census"],
  [/marriage/i, "marriage"],
  [/death|mortality/i, "death"],
  [BURIAL_TITLE, "burial"],
  [/christen|baptis/i, "christening"],
  [/birth/i, "birth"],
  // `land` must NOT be a bare substring. `/land/i` matches Scotland, Ireland,
  // Maryland, Finland, Poland, Rutland, Cumberland and the Netherlands, and it
  // did: every "Scotland, Civil Registration" record in the scorer corpus typed
  // as a land deed, which is not merely a mislabel — it applies the wrong
  // classification table to a birth record. Match the phrases a land record
  // actually uses.
  [/\bdeeds?\b|\bland (grant|record|patent|entr)|\bgrantors?\b|\bgrantees?\b|\btract book/i, "land"],
  [/\bdraft\b|registration cards?\b/i, "draft_registration"],
];

/**
 * Record type from the record's own facts first, then the collection title.
 *
 * **PRECEDENCE, not a vote**, in the order issue #2937 specifies: census >
 * marriage > death/burial > couple-between-principals > christening/baptism.
 * Two things make counting wrong:
 *
 *   - **A `Birth` fact rides along on everything.** A census persona has one
 *     (the year computed from their age), and so does each party to a marriage.
 *     Ranked by count, a 6-person marriage record has 6 Birth facts and 0
 *     person-level Marriage facts, and types as a birth record — which it did,
 *     on the captured `marriage.json` fixture, before this was precedence.
 *   - **A marriage's event fact is on the COUPLE, not on a person.** Scanning
 *     `persons[].facts` alone can never see it. The relationship's own `facts[]`
 *     and the bare existence of a Couple edge between two principals are both
 *     read here.
 *
 * `birth` is deliberately LAST and never beats the title: a record whose only
 * event is a birth is more often a christening register or a birth-and-
 * christening collection than a birth certificate.
 */
export function detectRecordType(gx: SimplifiedGedcomX): RecordType {
  const persons = gx.persons ?? [];
  const principals = persons.filter((p) => p.principal === true);
  const pool = principals.length > 0 ? principals : persons;
  const personFactTypes = new Set<string>();
  for (const p of pool) {
    for (const f of p.facts ?? []) personFactTypes.add(String(f.type ?? "").split("/").pop()!);
  }
  const relFactTypes = new Set<string>();
  let coupleBetweenPrincipals = false;
  const principalIds = new Set(principals.map((p) => p.id));
  for (const r of gx.relationships ?? []) {
    for (const f of r.facts ?? []) relFactTypes.add(String(f.type ?? "").split("/").pop()!);
    if (
      String(r.type ?? "").toLowerCase().includes("couple") &&
      r.person1 &&
      r.person2 &&
      principalIds.has(r.person1) &&
      principalIds.has(r.person2)
    ) {
      coupleBetweenPrincipals = true;
    }
  }
  const has = (re: RegExp) =>
    [...personFactTypes].some((t) => re.test(t)) || [...relFactTypes].some((t) => re.test(t));

  if (has(/^census$|^municipalcensus$/i)) return "census";
  if (has(/^marriage$|^marriagebanns$/i) || coupleBetweenPrincipals) return "marriage";
  // A record carrying BOTH is common in both directions — a burial index
  // states the death date, and a death certificate states the burial — so the
  // facts cannot decide it and the collection title does. 20 of the 319
  // scorer-corpus records carry both: Find a Grave (11) and Norway Burials (2)
  // are burial indexes; NYC and Texas Deaths are death records.
  const hasDeath = has(/^death$/i);
  const hasBurial = has(/^burial$|^cremation$/i);
  if (hasDeath && hasBurial) {
    return BURIAL_TITLE.test(collectionTitle(gx) ?? "") ? "burial" : "death";
  }
  if (hasDeath) return "death";
  if (hasBurial) return "burial";
  if (has(/^christening$|^baptism$/i)) return "christening";

  const title = collectionTitle(gx) ?? "";
  for (const [re, t] of TITLE_TO_RECORD) if (re.test(title)) return t;

  if (has(/^birth$/i)) return "birth";
  return "other";
}

/** The collection's title, off the Collection-typed source description. */
export function collectionTitle(gx: SimplifiedGedcomX): string | undefined {
  for (const sd of gx.sources ?? []) {
    if (/collection/i.test(String(sd.resource_type ?? "")) && sd.title) return sd.title;
  }
  return gx.sources?.[0]?.title;
}

// ─── ordering and households ────────────────────────────────────────────────

/**
 * Enumeration order within a household.
 *
 * `FS_SORT_KEY` first, not `SOURCE_PERSON_NBR`. The issue names the latter;
 * `dev/probe-census-persona-fields.ts` found it absent on US 1850 and E&W 1861 —
 * exactly the no-relationship-column schedules the positional rule is FOR —
 * while the sort key was present on 24/24 probed households and ends in a
 * zero-padded person ordinal that matches `SOURCE_PERSON_NBR_ORIG` wherever both
 * exist.
 *
 * **The sort was never observed to differ from array order** (0 of 24
 * households). It is kept because the issue reports array order is sometimes
 * scrambled, which that sample neither reproduces nor refutes — not because a
 * reordering was seen.
 */
function orderKey(
  person: SimplifiedPerson,
  fields: PersonaIndexFields | undefined,
  arrayIndex: number,
): string {
  const pad = (v: string) => v.padStart(12, "0");
  if (fields?.sortKey) return `0:${fields.sortKey}`;
  if (fields?.personNbr) return `1:${pad(fields.personNbr)}`;
  if (fields?.lineNbr) return `2:${pad(fields.lineNbr)}`;
  return `3:${pad(String(arrayIndex))}`;
}

interface Party {
  person: SimplifiedPerson;
  id: string;
  fields?: PersonaIndexFields;
  order: string;
  household: string;
}

function parties(doc: ExtractDocument): Party[] {
  const out: Party[] = [];
  const persons = doc.gedcomx.persons ?? [];
  for (let i = 0; i < persons.length; i++) {
    const p = persons[i];
    const id = p.id ?? `#${i}`;
    const fields = doc.indexFields?.[id];
    out.push({
      person: p,
      id,
      fields,
      order: orderKey(p, fields, i),
      // A record can hold more than one household, so roles are assigned per
      // household. Everything falls into one bucket when the field is absent,
      // which is the right default for a non-census record.
      household: fields?.householdId ?? "",
    });
  }
  out.sort((a, b) => a.order.localeCompare(b.order));
  return out;
}

// ─── roles ──────────────────────────────────────────────────────────────────

/** A stated relationship-to-head string → the role token. The lead's
 *  2026-09-27 decision fixes the vocabulary: a census with no column gets the
 *  SAME tokens a later census states, so these are shared by both arms. */
function roleFromRelationship(rel: string, counters: Map<string, number>): string {
  const r = rel.trim().toLowerCase();
  if (/^head|^self\b/.test(r)) return "head_of_household";
  if (/^wife/.test(r)) return "wife";
  if (/^husband/.test(r)) return "husband";
  if (/^son|^dau/.test(r)) return numbered("child", counters);
  if (/^boarder|^lodger/.test(r)) return numbered("boarder", counters);
  if (/^servant/.test(r)) return numbered("servant", counters);
  // Otherwise the stated relation, numbered — never invented, never dropped.
  const slug = r.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "other";
  return numbered(slug, counters);
}

/**
 * A stated relationship-to-head → the kin word an assertion's `value` uses and
 * the category its `structured_value.relationship_type` declares.
 *
 * Both are the RECORD SUBJECT's own role, not the head's:
 * `validateRelationshipDirection` (research-append.ts) parses the value with
 * `^<relation word> of ` and refuses when the parsed role disagrees with the
 * declared type. So a son of the head is `"son of <head>"` + `"child"`, and a
 * father of the head is `"father of <head>"` + `"parent"`.
 *
 * NOT imported from `research-append.ts`, though that file owns the canonical
 * `RELATION_CATEGORY`: a `utils/` → `tools/` import is against CLAUDE.md's
 * no-util→tool rule. This is a different vocabulary anyway — FamilySearch's
 * INDEX spellings, not the assertion grammar. `record-extract.test.ts` pins
 * that every category emitted here is one the writer accepts and that every
 * value built here parses back to the same category, so the two cannot drift
 * without a test failing.
 *
 * A relation with no kin mapping — Boarder, Servant, Lodger — yields a ROLE but
 * no relationship assertion. Co-residence is not kinship.
 */
const CENSUS_RELATION_TO_KIN: Record<string, { word: string; category: string }> = {
  son: { word: "son", category: "child" },
  dau: { word: "daughter", category: "child" },
  daughter: { word: "daughter", category: "child" },
  child: { word: "child", category: "child" },
  wife: { word: "wife", category: "spouse" },
  husband: { word: "husband", category: "spouse" },
  spouse: { word: "spouse", category: "spouse" },
  father: { word: "father", category: "parent" },
  mother: { word: "mother", category: "parent" },
  brother: { word: "brother", category: "sibling" },
  sister: { word: "sister", category: "sibling" },
};

/** The kin mapping for a stated relation, or undefined when it names no kin. */
export function censusKin(
  rel: string | undefined,
): { word: string; category: string } | undefined {
  const key = String(rel ?? "").trim().toLowerCase().replace(/\.$/, "");
  return CENSUS_RELATION_TO_KIN[key];
}

function numbered(base: string, counters: Map<string, number>): string {
  const n = (counters.get(base) ?? 0) + 1;
  counters.set(base, n);
  return `${base}_${n}`;
}

function ageYears(fields: PersonaIndexFields | undefined): number | null {
  const m = String(fields?.age ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

function surnameOf(p: SimplifiedPerson): string {
  return String(p.names?.[0]?.surname ?? "").trim().toLowerCase();
}

function genderOf(p: SimplifiedPerson): string {
  return String(p.gender ?? "").trim().toLowerCase();
}

/**
 * Roles for one census household with NO relationship column.
 *
 * The lead's 2026-09-27 rule, verbatim: first in source order is
 * `head_of_household`; the next adult of the opposite sex sharing the head's
 * surname with a plausible age gap is `wife`; later persons with the head's
 * surname young enough to be the couple's children are `child_N`; everyone else
 * is `household_member_N`.
 *
 * `head_of_household` for person 1 is measured, not assumed: where a probed
 * record stated a Head at all, it was the sort-first person in 8 of 8
 * households (`dev/probe-census-persona-fields.ts`, US 1870).
 *
 * These are LABELS. Item 4 of issue #2937 binds: a census without a
 * relationship column produces no `relationship` assertion whatever the roles
 * say, which is enforced by the caller below, not here.
 */
function positionalCensusRoles(household: Party[]): Map<string, string> {
  const roles = new Map<string, string>();
  const counters = new Map<string, number>();
  if (household.length === 0) return roles;

  const head = household[0];
  roles.set(head.id, "head_of_household");
  const headSurname = surnameOf(head.person);
  const headAge = ageYears(head.fields);
  const headGender = genderOf(head.person);

  let spouseTaken = false;
  for (const party of household.slice(1)) {
    const age = ageYears(party.fields);
    const sameSurname = headSurname !== "" && surnameOf(party.person) === headSurname;
    const gender = genderOf(party.person);
    const oppositeSex =
      headGender !== "" && gender !== "" && gender !== headGender;

    // Spouse: the next adult of the opposite sex with the head's surname and a
    // plausible age gap. "Plausible" is generous on purpose — a 20-year gap is
    // unremarkable in this period, and the cost of a miss here is a
    // `household_member_N`, not a wrong kin claim.
    if (
      !spouseTaken &&
      sameSurname &&
      oppositeSex &&
      age !== null &&
      age >= 15 &&
      (headAge === null || Math.abs(age - headAge) <= 25)
    ) {
      roles.set(party.id, headGender === "male" ? "wife" : "husband");
      spouseTaken = true;
      continue;
    }

    // Child: the head's surname, and young enough to be the couple's.
    if (
      sameSurname &&
      age !== null &&
      headAge !== null &&
      headAge - age >= 14 &&
      age < 60
    ) {
      roles.set(party.id, numbered("child", counters));
      continue;
    }

    roles.set(party.id, numbered("household_member", counters));
  }
  return roles;
}

/** Relationship edges from the simplified document, as adjacency. */
function edges(gx: SimplifiedGedcomX) {
  const parentOf = new Map<string, string[]>(); // child -> parents
  const couples: [string, string][] = [];
  for (const r of gx.relationships ?? []) {
    const t = String(r.type ?? "").toLowerCase();
    if (t.includes("parentchild") && r.parent && r.child) {
      const arr = parentOf.get(r.child) ?? [];
      arr.push(r.parent);
      parentOf.set(r.child, arr);
    } else if (t.includes("couple") && r.person1 && r.person2) {
      couples.push([r.person1, r.person2]);
    }
  }
  return { parentOf, couples };
}

/** Roles for a marriage record: the Couple pair are groom/bride, their
 *  ParentChild edges name the parents, everyone else witnesses. */
function marriageRoles(ps: Party[], gx: SimplifiedGedcomX): Map<string, string> {
  const roles = new Map<string, string>();
  const counters = new Map<string, number>();
  const { parentOf, couples } = edges(gx);
  const byId = new Map(ps.map((p) => [p.id, p]));
  const principalIds = new Set(
    ps.filter((p) => p.person.principal === true).map((p) => p.id),
  );
  const couplePairs = (gx.relationships ?? [])
    .filter((r) => String(r.type ?? "").toLowerCase().includes("couple") && r.person1 && r.person2)
    .map((r) => ({
      ids: [r.person1 as string, r.person2 as string] as [string, string],
      hasMarriageFact: (r.facts ?? []).some((f) =>
        /marriage/i.test(String(f.type ?? "")),
      ),
    }));

  let groom: string | undefined;
  let bride: string | undefined;
  // The marrying pair is the Couple edge carrying the MARRIAGE FACT — not the
  // first Couple edge in the document. A marriage record routinely states the
  // parents' marriages too: the captured `marriage.json` fixture lists
  // Couple(Frank Miller, Ellen Traxler) — the groom's parents — BEFORE
  // Couple(Chancey, Olive), the pair the record is about. Taking `couples[0]`
  // made the groom's father the groom and pushed the actual bride and groom out
  // to `witness_N`.
  const pair =
    couplePairs.find((c) => c.hasMarriageFact)?.ids ??
    couplePairs.find((c) => principalIds.has(c.ids[0]) && principalIds.has(c.ids[1]))?.ids ??
    couples[0];
  if (pair) {
    for (const id of pair) {
      const g = genderOf(byId.get(id)?.person ?? {});
      if (g === "male" && !groom) groom = id;
      else if (g === "female" && !bride) bride = id;
    }
    // Gender missing on one side: fall back to document order rather than
    // guessing, so a missing gender costs a label and not a wrong one.
    if (!groom && !bride) [groom, bride] = pair;
    else if (!groom) groom = pair.find((x) => x !== bride);
    else if (!bride) bride = pair.find((x) => x !== groom);
  }
  if (groom) roles.set(groom, "groom");
  if (bride) roles.set(bride, "bride");

  for (const [child, ps2] of parentOf) {
    const side = child === groom ? "groom" : child === bride ? "bride" : null;
    if (!side) continue;
    for (const parent of ps2) {
      const g = genderOf(byId.get(parent)?.person ?? {});
      const which = g === "female" ? "mother" : "father";
      if (!roles.has(parent)) roles.set(parent, `${which}_of_${side}`);
    }
  }
  for (const p of ps) if (!roles.has(p.id)) roles.set(p.id, numbered("witness", counters));
  return roles;
}

/** Roles for a death/burial, birth or christening record. */
function principalRoles(
  ps: Party[],
  gx: SimplifiedGedcomX,
  principalRole: string,
): Map<string, string> {
  const roles = new Map<string, string>();
  const counters = new Map<string, number>();
  const { parentOf } = edges(gx);
  const byId = new Map(ps.map((p) => [p.id, p]));

  const principal =
    ps.find((p) => p.person.principal === true)?.id ?? ps[0]?.id;
  if (principal) roles.set(principal, principalRole);

  for (const parent of parentOf.get(principal ?? "") ?? []) {
    const g = genderOf(byId.get(parent)?.person ?? {});
    if (!roles.has(parent)) roles.set(parent, g === "female" ? "mother" : "father");
  }
  // Grandparents: a parent's own parents, one hop further out.
  for (const parent of parentOf.get(principal ?? "") ?? []) {
    for (const gp of parentOf.get(parent) ?? []) {
      const g = genderOf(byId.get(gp)?.person ?? {});
      if (!roles.has(gp)) roles.set(gp, g === "female" ? "grandmother" : "grandfather");
    }
  }
  for (const p of ps) if (!roles.has(p.id)) roles.set(p.id, numbered("other", counters));
  return roles;
}

// ─── classification ─────────────────────────────────────────────────────────

/** What a fact is ABOUT, for the classification table's third axis. */
type FactClass = "identity" | "event" | "residence" | "relationship";

/** The role's family, for the table's second axis. */
type RoleFamily = "principal" | "spouse" | "child" | "parent" | "other";

function roleFamily(role: string): RoleFamily {
  if (/^head_of_household$|^groom$|^bride$|^deceased$|^child$|^registrant$/.test(role)) {
    return "principal";
  }
  if (/^wife$|^husband$/.test(role)) return "spouse";
  if (/^child_\d+$/.test(role)) return "child";
  if (/^(father|mother|grand(father|mother))(_of_\w+)?$/.test(role)) return "parent";
  return "other";
}

interface Classification {
  informant: string;
  informant_proximity: string;
  information_quality: string;
  bias?: string;
  /** True when this row is the fallback rather than a real table entry. */
  defaulted?: boolean;
}

/**
 * The classification table: record type × role family × fact class.
 *
 * Measured against the 255 `expected_classifications` cells in the 19 unit
 * fixtures that pin them: 249/255 agree. **That figure is IN-SAMPLE** — the
 * table was built by reading the same cells the eval checks, so it states
 * internal consistency, not predictive accuracy.
 *
 * A record type with no row defaults to `unknown` / `indeterminate`, and every
 * assertion that takes the default is NAMED in the result. That visibility is
 * load-bearing: `unknown` switches off `contradictionIsCredible`
 * (research-append.ts), so a silently-defaulted row would quietly weaken a
 * guard on exactly the record types (probate, obituary, military) where the
 * informant is often knowable. Genealogists add rows over time; a missing one
 * must show up.
 */
/**
 * Whether a burial record is a church burial register or a cemetery/grave
 * index, from its collection title. The genealogist's ruling (2026-09-29): on a
 * church register the officiant recorded the burial, so the burial EVENT is
 * theirs at official_duty/primary, as the christening row reads; a cemetery or
 * grave index names no informant for anything.
 *
 * Cemetery words win over church words, and a title matching neither is read as
 * an index — the conservative direction, since `unknown` claims less. Over the
 * 20 burial-typed scorer-corpus records: 12 index (Find a Grave 11, Chile
 * Cemetery Records 1), 8 register (Norway Burials 2, Costa Rica Catholic 2,
 * Baden katholische Kirchenbücher, Albacete Catholic, Gloucestershire
 * Non-Conformist, England Deaths and Burials).
 */
const CEMETERY_TITLE = /cemeter|\bgraves?\b|interment|headstone|tombstone|gravestone/i;
const CHURCH_REGISTER_TITLE =
  /church|catholic|parish|diocese|kirchenb|protestant|lutheran|reformed|methodist|baptist|conformist|\bburials\b/i;

export function burialSourceKind(title: string | undefined): "church_register" | "cemetery_index" {
  const t = title ?? "";
  if (CEMETERY_TITLE.test(t)) return "cemetery_index";
  return CHURCH_REGISTER_TITLE.test(t) ? "church_register" : "cemetery_index";
}

function classify(
  recordType: RecordType,
  role: string,
  factClass: FactClass,
  collection?: string,
): Classification {
  const family = roleFamily(role);

  if (recordType === "census") {
    // The enumerator personally visited the dwelling — a known, firsthand
    // witness for the RESIDENCE fact specifically, and for nothing else on the
    // page.
    if (factClass === "residence" || factClass === "event") {
      return {
        informant: "census enumerator",
        informant_proximity: "witness",
        information_quality: "primary",
        bias: "the enumerator visited the dwelling",
      };
    }
    // A pre-1940 census does not record who answered, so even an adult's own
    // age is `household_member`, not `self`: you do not KNOW the person spoke
    // for themselves.
    return {
      informant: "unknown household member",
      informant_proximity: "household_member",
      information_quality: "indeterminate",
      bias: "the census does not record who answered",
    };
  }

  if (recordType === "marriage") {
    if (family === "principal" || family === "spouse") {
      // The parties speak for themselves — including for their own parents'
      // names, which they have firsthand ongoing knowledge of.
      return {
        informant: "the party",
        informant_proximity: "self",
        information_quality: "primary",
      };
    }
    if (family === "parent") {
      return {
        informant: "the party",
        informant_proximity: "self",
        information_quality: "primary",
        bias: "the parent's name as stated by their own child",
      };
    }
    return {
      informant: "the witness",
      informant_proximity: "witness",
      information_quality: "primary",
    };
  }

  // A cemetery or grave index identifies no informant at all — not a funeral
  // director (that row is scoped to a death certificate that names one), not
  // the index compiler, not the cemetery. So every fact on it is unknown /
  // indeterminate, the death date included. A church burial register differs
  // for the burial EVENT only: the officiant recorded it (`burialSourceKind`).
  // Everything else on a register stays unknown / indeterminate. Both are REAL
  // rows, not the default, so neither is named as a gap. The index row is pinned
  // by `burial-index-dates-direct` and `burial-index-parents-indirect`.
  if (recordType === "burial") {
    if (factClass === "event" && burialSourceKind(collection) === "church_register") {
      return {
        informant: "the officiant",
        informant_proximity: "official_duty",
        information_quality: "primary",
        bias: "the officiant recorded the burial they conducted",
      };
    }
    return {
      informant: "unknown",
      informant_proximity: "unknown",
      information_quality: "indeterminate",
      bias: "a burial or cemetery index names no informant",
    };
  }

  if (recordType === "death") {
    if (factClass === "event") {
      return {
        informant: "the certifying official",
        informant_proximity: "official_duty",
        information_quality: "primary",
      };
    }
    // The decedent's biography comes from the personal informant, who was not
    // present at the birth they are reporting.
    return {
      informant: "the personal informant named on the record",
      informant_proximity: "family_not_present",
      information_quality: "secondary",
      bias: "reported by a survivor, not witnessed",
    };
  }

  // Christening and birth rows (genealogist rulings, 2026-09-30).
  if (recordType === "christening") {
    if (factClass === "event") {
      return {
        informant: "the officiant",
        informant_proximity: "official_duty",
        information_quality: "primary",
      };
    }
    // Godparents and sponsors are recorded by the officiant, not reported by the
    // family: 7b. Every non-family party on a christening is roled `other_N`.
    if (family === "other") {
      return {
        informant: "the officiant",
        informant_proximity: "official_duty",
        information_quality: "primary",
      };
    }
    // A parent presented the child and supplied the family facts firsthand; a
    // christened infant cannot report, so never `self`.
    return {
      informant: "the presenting parent",
      informant_proximity: "household_member",
      information_quality: "primary",
    };
  }

  if (recordType === "birth") {
    // 7a: the registrar recorded the birth but did not witness it. The birth
    // itself, like every other fact, comes from the informant, usually a parent.
    // 7c: a DELAYED certificate, filed long after the birth, is recollection, so
    // it is `secondary` though the source is original. Told apart by title.
    const delayed = /delayed/i.test(collection ?? "");
    return {
      informant: "the informant (usually a parent)",
      informant_proximity: "household_member",
      information_quality: delayed ? "secondary" : "primary",
      ...(delayed ? { bias: "a delayed birth record, reported long after the birth" } : {}),
    };
  }

  // No row. Default, and SAY SO.
  return {
    informant: "unknown",
    informant_proximity: "unknown",
    information_quality: "indeterminate",
    defaulted: true,
  };
}

/** Record types that only a document produces: each has its own rows below. */
const DOCUMENT_ONLY_TYPES: ReadonlySet<RecordType> = new Set(["obituary", "probate", "newspaper_announcement"]);

/**
 * The obituary, probate and newspaper-announcement rows. All of them are the
 * genealogist's rulings (2026-09-29 and 2026-09-30); spec §11.7 holds the tables.
 * Keyed on role, fact type and, for residences, date, because "recent family
 * knowledge" and "life history" split the same fact type by when it happened.
 */
function classifyDocumentRow(
  recordType: RecordType,
  role: string,
  factType: string,
  extra: Partial<ExtractedAssertion>,
  mode: DocumentMode | undefined,
  statedRelation: string | undefined,
): Classification {
  const year = Number(String(extra.date ?? "").match(/\d{4}/)?.[0]);
  const earlier = !Number.isNaN(year) && mode?.eventYear !== undefined && year < mode.eventYear;
  const relatedRole = String(extra.structured_value?.related_person_role ?? "");
  const isParentRole = (r: string) => roleFamily(r) === "parent" || /^(father|mother)(_|$)/.test(r);

  if (recordType === "obituary") {
    const author = "the obituary's author (usually unnamed family)";
    const recent: Classification = { informant: author, informant_proximity: "household_member", information_quality: "indeterminate" };
    const life: Classification = { informant: author, informant_proximity: "family_not_present", information_quality: "secondary" };
    if (role === "deceased") {
      if (factType === "relationship") return isParentRole(relatedRole) ? life : recent;
      if (/^(name|death|burial|funeral|cremation|interment)$/.test(factType)) return recent;
      if (factType === "residence") return earlier ? life : recent;
      return life;
    }
    if (isParentRole(role) || /\b(late|deceased|predeceased)\b/i.test(statedRelation ?? "")) return life;
    if (/^(name|residence|relationship)$/.test(factType)) return recent;
    return life;
  }

  if (recordType === "probate") {
    if (/^(probate|court|letters|letters_testamentary|letters_of_administration|will_proved|administration)$/.test(factType)) {
      return { informant: "the court clerk", informant_proximity: "official_duty", information_quality: "primary" };
    }
    if (/^(will|will_execution|testament|signing)$/.test(factType) || /^witness_\d+$/.test(role)) {
      return { informant: "the witnesses", informant_proximity: "witness", information_quality: "primary" };
    }
    const petitioner = "the petitioner (executor or administrator)";
    if (factType === "death") {
      return { informant: petitioner, informant_proximity: "household_member", information_quality: "indeterminate" };
    }
    if (mode?.hasWill) {
      return { informant: "the testator", informant_proximity: "self", information_quality: "primary" };
    }
    if (/^(name|relationship)$/.test(factType)) {
      return { informant: petitioner, informant_proximity: "household_member", information_quality: "primary" };
    }
    return { informant: petitioner, informant_proximity: "household_member", information_quality: "indeterminate" };
  }

  // newspaper_announcement
  const submitter = "the announcement's submitter (usually unnamed family)";
  const recent: Classification = { informant: submitter, informant_proximity: "household_member", information_quality: "indeterminate" };
  const life: Classification = { informant: submitter, informant_proximity: "family_not_present", information_quality: "secondary" };
  if (mode?.eventType && factType === mode.eventType) return recent;
  if (/^(name|relationship)$/.test(factType)) return recent;
  if (factType === "residence") return earlier ? life : recent;
  return life;
}

/** Newspaper-announcement roles (genealogist ruling, 2026-09-30): the event's
 *  subject by event, and by sex where the event has two principals. */
function newspaperRoles(ps: Party[], gx: SimplifiedGedcomX, eventType: string | undefined): Map<string, string> {
  const principalRole =
    eventType === "birth" ? "child" : eventType === "marriage" || eventType === "engagement" || eventType === "anniversary" ? "__pair" : "principal";
  const roles = principalRoles(ps, gx, principalRole === "__pair" ? "principal" : principalRole);
  if (principalRole === "__pair") {
    for (const p of ps.filter((q) => q.person.principal === true)) {
      const female = genderOf(p.person) === "female";
      roles.set(p.id, eventType === "anniversary" ? (female ? "wife" : "husband") : female ? "bride" : "groom");
    }
  }
  return roles;
}

// ─── fact mapping ───────────────────────────────────────────────────────────

/** Normalize a fact type to the snake_case `fact_type` the schema expects.
 *  About 8% of corpus assertions carry `Name` / `Birth` / `Residence`. */
export function normalizeFactType(raw: unknown): string {
  return String(raw ?? "")
    .split("/")
    .pop()!
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function factClassOf(factType: string, recordType: RecordType): FactClass {
  if (factType === "residence") return "residence";
  if (factType === "relationship") return "relationship";
  const eventFor: Record<string, RecordType | undefined> = {
    census: "census",
    marriage: "marriage",
    death: "death",
    burial: "burial",
    cremation: "burial",
    christening: "christening",
    baptism: "christening",
    birth: "birth",
  };
  return eventFor[factType] === recordType ? "event" : "identity";
}

function fullName(p: SimplifiedPerson): string {
  const n = p.names?.[0];
  if (!n) return "";
  return [n.given, n.surname].filter((x) => x && String(x).trim() !== "").join(" ").trim();
}

// ─── the extractor ──────────────────────────────────────────────────────────

export function extractRecord(
  doc: ExtractDocument,
  opts: ExtractOptions,
): ExtractResult {
  const gx = doc.gedcomx ?? {};
  const mode = opts.mode;
  const recordType = mode?.recordType ?? detectRecordType(gx);
  const collection = collectionTitle(gx);
  const ps = parties(doc);
  const assertions: ExtractedAssertion[] = [];
  const defaultedClassifications: string[] = [];
  const notes: string[] = [];

  // ── roles ──
  const roles = new Map<string, string>();
  let censusStatesRelationships: boolean | undefined;
  /** Households on a WITH-column census, kept so relationship assertions can be
   *  written from the stated relation after every role is known. */
  const statedHouseholds: Party[][] = [];

  if (recordType === "census") {
    // Decide the column from the census fact's place and year, per household.
    const censusFact = ps
      .flatMap((p) => p.person.facts ?? [])
      .find((f) => /census/i.test(String(f.type ?? "")));
    const year = Number(String(censusFact?.date ?? "").match(/\d{4}/)?.[0]);
    const place = censusFact?.standard_place ?? censusFact?.place;
    const stated =
      mode && "censusStates" in mode
        ? (mode.censusStates ?? null)
        : censusStatedRelationships(place, Number.isNaN(year) ? undefined : year);
    censusStatesRelationships = stated === true;
    if (mode && stated !== true && mode.statedRelations.size > 0) {
      notes.push(
        `${mode.statedRelations.size} stated relation(s) not used: this schedule had no ` +
          `relationship column, so a relation the text appears to give is not the record's claim`,
      );
    }
    if (stated === null) {
      notes.push(
        `census jurisdiction not in the relationship-column table ` +
          `(place ${JSON.stringify(place ?? null)}, year ${year || "unknown"}) — ` +
          `treated as stating no relationships, so no relationship assertion is written`,
      );
    }

    const households = new Map<string, Party[]>();
    for (const p of ps) {
      const arr = households.get(p.household) ?? [];
      arr.push(p);
      households.set(p.household, arr);
    }
    if (households.size > 1) {
      notes.push(`record covers ${households.size} households; roles assigned within each`);
    }
    for (const [, members] of households) {
      if (stated === true) {
        const counters = new Map<string, number>();
        for (const m of members) {
          const rel = m.fields?.relationshipToHead;
          roles.set(
            m.id,
            rel ? roleFromRelationship(rel, counters) : numbered("household_member", counters),
          );
        }
        statedHouseholds.push(members);
      } else {
        for (const [id, role] of positionalCensusRoles(members)) roles.set(id, role);
      }
    }
  } else if (recordType === "marriage") {
    for (const [id, r] of marriageRoles(ps, gx)) roles.set(id, r);
  } else if (recordType === "death" || recordType === "burial") {
    for (const [id, r] of principalRoles(ps, gx, "deceased")) roles.set(id, r);
  } else if (recordType === "christening" || recordType === "birth") {
    for (const [id, r] of principalRoles(ps, gx, "child")) roles.set(id, r);
  } else if (recordType === "draft_registration") {
    for (const [id, r] of principalRoles(ps, gx, "registrant")) roles.set(id, r);
  } else if (recordType === "obituary") {
    for (const [id, r] of principalRoles(ps, gx, "deceased")) roles.set(id, r);
  } else if (recordType === "probate") {
    for (const [id, r] of principalRoles(ps, gx, mode?.hasWill ? "testator" : "decedent")) roles.set(id, r);
  } else if (recordType === "newspaper_announcement") {
    for (const [id, r] of newspaperRoles(ps, gx, mode?.eventType)) roles.set(id, r);
  } else if (recordType === "land") {
    // `grantee` for the principal, `grantor_N` for the rest. The record is
    // indexed under the party ACQUIRING the land — a patentee, a homesteader —
    // so the principal is the grantee; the other named parties are the
    // conveying side. Where the index says otherwise there is no field to read
    // it from, so this is the best available default rather than a reading.
    const counters = new Map<string, number>();
    const principal = ps.find((p) => p.person.principal === true)?.id ?? ps[0]?.id;
    for (const p of ps) {
      roles.set(p.id, p.id === principal ? "grantee" : numbered("grantor", counters));
    }
  } else {
    const counters = new Map<string, number>();
    const principal = ps.find((p) => p.person.principal === true)?.id ?? ps[0]?.id;
    for (const p of ps) {
      roles.set(p.id, p.id === principal ? "principal" : numbered("other", counters));
    }
  }

  // In document mode, a party the rules above could only number (`other_N`,
  // `witness_N`) takes the text's own relation word instead: son -> child_N,
  // executor, heir_N (genealogist ruling, 2026-09-30). A census's relation is the
  // column's, handled above, and never this.
  if (mode && recordType !== "census" && mode.statedRelations.size > 0) {
    const counters = new Map<string, number>();
    for (const p of ps) {
      const rel = mode.statedRelations.get(p.id);
      if (rel && /^(other|witness)_\d+$/.test(roles.get(p.id) ?? "")) {
        roles.set(p.id, roleFromRelationship(rel, counters));
      }
    }
  }

  // ── assertions ──
  const push = (
    party: Party,
    factType: string,
    value: string,
    extra: Partial<ExtractedAssertion> = {},
    factClass?: FactClass,
    clsOverride?: Classification,
  ) => {
    const role = roles.get(party.id) ?? "other_1";
    let cls =
      clsOverride ??
      (DOCUMENT_ONLY_TYPES.has(recordType)
        ? classifyDocumentRow(recordType, role, factType, extra, mode, mode?.statedRelations.get(party.id))
        : classify(recordType, role, factClass ?? factClassOf(factType, recordType), collection));
    if (
      mode?.informantName &&
      (cls.informant_proximity === "household_member" || cls.informant_proximity === "family_not_present")
    ) {
      cls = { ...cls, informant: mode.informantName };
    }
    const a: ExtractedAssertion = {
      record_id: doc.recordId,
      record_role: role,
      fact_type: factType,
      value,
      information_quality: cls.information_quality,
      informant: cls.informant,
      informant_proximity: cls.informant_proximity,
      record_basis: "stated",
      log_entry_id: opts.logEntryId,
      extracted_for_question_ids: [...opts.questionIds],
      ...extra,
    };
    // Set per persona and never auto-filled. `extraction_append`'s auto-fill
    // stamped the SEARCHED persona's id onto assertions about someone else 16
    // times in the e2e corpus (issue #2937).
    // Document mode never sets a persona id: local ids name nothing outside the
    // document, and research_append verifies a supplied id against a sidecar.
    if (party.person.id && !mode) a.record_persona_id = party.person.id;
    const bias = [cls.bias, extra.informant_bias_notes].filter(Boolean).join("; ");
    if (bias) a.informant_bias_notes = bias;
    else delete a.informant_bias_notes;
    assertions.push(a);
    if (cls.defaulted) {
      defaultedClassifications.push(
        `${factType} for ${role}: no classification-table row for record type ` +
          `'${recordType}' — defaulted to unknown/indeterminate. An 'unknown' ` +
          `informant_proximity switches off the contradiction-credibility check, ` +
          `so treat this as a gap to fill, not a finding.`,
      );
    }
    return a;
  };

  for (const party of ps) {
    const p = party.person;

    // Name — mandatory, and first. It is the identifying fact everything else
    // hangs on; a parent with a birthplace and no name is an incomplete
    // extraction.
    const name = fullName(p);
    if (name !== "") {
      push(party, "name", name, {
        structured_value: {
          given: p.names?.[0]?.given ?? "",
          surname: p.names?.[0]?.surname ?? "",
        },
        ...(mode?.nameNotes.get(party.id) ? { informant_bias_notes: mode.nameNotes.get(party.id) } : {}),
      });
    }

    // Sex, where the record gives one.
    const g = genderOf(p);
    if (g === "male" || g === "female") {
      push(party, "sex", g === "male" ? "Male" : "Female");
    }

    // Age, from the index field — its own assertion, distinct from any birth
    // claim computed from it.
    const age = party.fields?.age;
    if (age) push(party, "age", String(age));

    // Every persona fact.
    for (const [fi, f] of (p.facts ?? []).entries()) {
      const factType = normalizeFactType(f.type);
      if (factType === "") continue;

      if (mode) {
        const marks = mode.factMarks.get(`${party.id}#${fi}`);
        const computed = new Set(marks?.computed ?? []);
        const attrs = (["value", "date", "place"] as const).filter(
          (k) => f[k] !== undefined && String(f[k]).trim() !== "",
        );
        const groups: [readonly ("value" | "date" | "place")[], "stated" | "inferred"][] = [
          [attrs.filter((k) => !computed.has(k)), "stated"],
          [attrs.filter((k) => computed.has(k)), "inferred"],
        ];
        for (const [group, basis] of groups) {
          if (group.length === 0) continue;
          const extra: Partial<ExtractedAssertion> = { record_basis: basis };
          if (group.includes("date")) extra.date = f.date;
          if (group.includes("place")) extra.place = f.place;
          if (basis === "inferred" && group.includes("date")) extra.date_certainty = "approximate";
          if (marks?.note) extra.informant_bias_notes = marks.note;
          const value = group.includes("value") ? f.value : group.includes("date") ? f.date : f.place;
          push(party, factType, String(value ?? ""), extra);
        }
        continue;
      }

      // A record that states an AGE but no birth date carries the birth year
      // only as arithmetic. FamilySearch folds both the birthplace and that
      // derived year into ONE `Birth` fact, and they do not share a
      // `record_basis`: the place sits in a field (`stated`), the year does not
      // (`inferred`). So the fact is SPLIT into two atomic assertions, which is
      // also what the doctrine requires independently — "Age, birthplace, birth
      // year — separate assertions". Emitting one combined assertion would mark
      // a computed year `stated`, which is the exact confusion between the
      // record layer and the inference layer that `record_basis` exists to keep
      // apart.
      //
      // Only where the year is genuinely derived. On a birth or christening
      // record the date IS stated — the record is about that event.
      const yearIsDerived =
        factType === "birth" &&
        (recordType === "census" || recordType === "death" || recordType === "burial");

      if (yearIsDerived && f.date && (f.place || f.standard_place)) {
        const placeExtra: Partial<ExtractedAssertion> = { place: f.place };
        if (f.standard_place) placeExtra.standard_place = f.standard_place;
        push(party, "birth", String(f.place ?? f.standard_place ?? ""), placeExtra);
        push(party, "birth", String(f.date), {
          date: f.date,
          record_basis: "inferred",
          date_certainty: "approximate",
        });
        continue;
      }

      const value = f.value ?? f.date ?? f.place ?? "";
      const extra: Partial<ExtractedAssertion> = {};
      if (f.date) extra.date = f.date;
      if (f.place) extra.place = f.place;
      if (f.standard_place) extra.standard_place = f.standard_place;
      if (yearIsDerived && f.date) {
        extra.record_basis = "inferred";
        extra.date_certainty = "approximate";
      }
      push(party, factType, String(value), extra);
    }
  }

  // ── relationships ──
  //
  // ITEM 4 OF ISSUE #2937. A census with no relationship column produces roles
  // from the positional rule but NO parent-child or spousal assertion, even
  // where the document carries an indexer-inferred edge. The indexer inferred
  // that from position exactly as the rule did; persisting it would assert the
  // relationship while labelling the doubt, and the correlation that resolves
  // it happens downstream.
  //
  // (No census read in the probe carried any edge at all — 0 relationships[]
  // across three collections — so this is a guard against a shape that exists
  // in principle rather than one observed.)
  // EVERY census, not just the pre-1880 ones. A census's relationship claims
  // come from the stated column (handled above, per household) or from nowhere;
  // its `relationships[]` edges are the indexer's reading of household position,
  // which is the same inference the positional rule makes and is not a statement
  // by the record. Running both arms on an 1880 record also double-counted:
  // the captured fixture produced a field-derived "wife of Charles Miller"
  // anchored to `head_of_household` AND an edge-derived duplicate anchored to
  // `wife`, for the same marriage.
  const suppressRelationships = recordType === "census";

  // A WITH-column census states each person's relation to the head IN A FIELD,
  // and carries no `relationships[]` edges at all (0 across every census the
  // probe read). So the assertions come from the field, not from the graph —
  // without this arm an 1880 census would produce roles and no relationship
  // assertion, which is the pre-1880 outcome applied to a record that does
  // state its relationships.
  for (const members of statedHouseholds) {
    const head = members.find((m) => /^head|^self\b/i.test(m.fields?.relationshipToHead ?? ""));
    if (!head) {
      // The head is not among the returned personas — a real shape: a search
      // can hand back a subset of the household. Roles still stand (they are
      // labels), but an assertion anchored to a person we do not have would
      // name a party the record never identified here.
      notes.push(
        `census household states relationships but no persona is the head — ` +
          `roles assigned from the stated relation, and NO relationship assertion ` +
          `written, because the party each relation points at is not in this record`,
      );
      continue;
    }
    const headName = fullName(head.person) || head.id;
    for (const m of members) {
      if (m.id === head.id) continue;
      const kin = censusKin(m.fields?.relationshipToHead);
      // Boarder, servant, lodger: a role, but not kinship. Co-residence is not
      // a relationship the record asserts.
      if (!kin) continue;
      push(
        m,
        "relationship",
        `${kin.word} of ${headName}`,
        {
          structured_value: {
            relationship_type: kin.category,
            related_person_role: "head_of_household",
          },
        },
        "relationship",
      );
    }
  }

  // ── parent birthplaces (genealogist ruling 2026-09-30) ──
  //
  // A stated-relationship census carries "father's birthplace" and "mother's
  // birthplace" columns on each person's line. They are written ONLY when that
  // parent is in the household, as a birth-place assertion on the parent's own
  // persona, and always `secondary`: no household respondent could have
  // witnessed a parent's birth (`record-extractor.md`'s census rule). The parent
  // is matched from the stated relation alone:
  //   son / daughter of the head -> the head, or the head's spouse, by sex;
  //   the head -> the member stated "father" / "mother";
  //   the head's wife -> the member stated "father-in-law" / "mother-in-law".
  // Anyone else (grandchild, stepchild, boarder...) writes nothing, and so does
  // a parent that is missing or matched more than once. Identical claims about
  // one parent collapse to ONE assertion that says how many lines state it:
  // repeated cells from one respondent are one piece of evidence. The parent's
  // own-line birthplace is still written separately, and where the two
  // disagree the record disagrees with itself.
  for (const members of statedHouseholds) {
    const relOf = (m: Party) => (m.fields?.relationshipToHead ?? "").trim().toLowerCase();
    const head = members.find((m) => /^(head|self)\b/.test(relOf(m)));
    const only = (re: RegExp): Party | null | "ambiguous" => {
      const c = members.filter((m) => re.test(relOf(m)));
      return c.length === 1 ? c[0] : c.length === 0 ? null : "ambiguous";
    };
    const claims = new Map<string, { target: Party; place: string; which: string; lines: number }>();
    let unmatched = 0;
    for (const m of members) {
      for (const which of ["father", "mother"] as const) {
        const place = (which === "father" ? m.fields?.fatherBirthPlace : m.fields?.motherBirthPlace)?.trim();
        if (!place) continue;
        const r = relOf(m);
        let target: Party | null | "ambiguous";
        if (/^(son|daughter|child)$/.test(r)) {
          const hs = head ? genderOf(head.person) : "";
          if (!head || (hs !== "male" && hs !== "female")) target = null;
          else if ((hs === "male") === (which === "father")) target = head;
          else target = only(which === "father" ? /^husband$/ : /^wife$/);
        } else if (/^(head|self)\b/.test(r)) {
          target = only(which === "father" ? /^father$/ : /^mother$/);
        } else if (r === "wife") {
          target = only(which === "father" ? /^father[- ]?in[- ]?law$/ : /^mother[- ]?in[- ]?law$/);
        } else {
          continue;
        }
        if (target === null || target === "ambiguous") {
          unmatched += 1;
          continue;
        }
        const key = `${target.id}|${place.toLowerCase()}`;
        const c = claims.get(key);
        if (c) c.lines += 1;
        else claims.set(key, { target, place, which, lines: 1 });
      }
    }
    for (const c of claims.values()) {
      push(
        c.target,
        "birth",
        c.place,
        { place: c.place },
        "identity",
        {
          informant: "unknown household member",
          informant_proximity: "household_member",
          information_quality: "secondary",
          bias:
            `the ${c.which}'s birthplace as stated on ${c.lines} household member line(s); ` +
            `no household respondent could have witnessed it`,
        },
      );
    }
    if (unmatched > 0) {
      notes.push(
        `${unmatched} parent-birthplace column(s) not written: the parent is not ` +
          `identifiable in this household from the stated relations`,
      );
    }
  }

  if (!suppressRelationships) {
    const byId = new Map(ps.map((p) => [p.id, p]));
    const { parentOf, couples } = edges(gx);
    for (const [child, parentIds] of parentOf) {
      const cp = byId.get(child);
      if (!cp) continue;
      for (const parent of parentIds) {
        const pp = byId.get(parent);
        if (!pp) continue;
        push(
          cp,
          "relationship",
          `child of ${fullName(pp.person) || parent}`,
          {
            structured_value: {
              relationship_type: "child",
              // Without this the persona arm of `materialize_facts` cannot
              // corroborate the assertion.
              related_person_role: roles.get(parent) ?? "other_1",
            },
          },
          "relationship",
        );
      }
    }
    for (const r of gx.relationships ?? []) {
      if (!String(r.type ?? "").toLowerCase().includes("sibling") || !r.person1 || !r.person2) continue;
      const ap = byId.get(r.person1);
      const bp = byId.get(r.person2);
      if (!ap || !bp) continue;
      const g = genderOf(ap.person);
      const word = g === "male" ? "brother" : g === "female" ? "sister" : "sibling";
      push(
        ap,
        "relationship",
        `${word} of ${fullName(bp.person) || r.person2}`,
        {
          structured_value: {
            relationship_type: "sibling",
            related_person_role: roles.get(r.person2) ?? "other_1",
          },
        },
        "relationship",
      );
    }
    for (const [a, b] of couples) {
      const ap = byId.get(a);
      const bp = byId.get(b);
      if (!ap || !bp) continue;
      push(
        ap,
        "relationship",
        `spouse of ${fullName(bp.person) || b}`,
        {
          structured_value: {
            relationship_type: "spouse",
            related_person_role: roles.get(b) ?? "other_1",
          },
        },
        "relationship",
      );
    }
  } else if ((gx.relationships ?? []).length > 0) {
    const n = (gx.relationships ?? []).length;
    notes.push(
      censusStatesRelationships === true
        ? `${n} relationship edge(s) on this census were not persisted from the graph: ` +
            `this schedule HAS a relationship column, so the assertions above come from ` +
            `what each person's entry states, which is the record's own claim rather than ` +
            `the indexer's reading of it. Persisting both duplicated every tie.`
        : `${n} relationship edge(s) on this census were NOT persisted: the schedule has ` +
            `no relationship column, so the indexer inferred them from household position ` +
            `exactly as the role rule did. The household looks like a family — carry that ` +
            `to the correlation skills as a hypothesis, not as an assertion.`,
    );
  }

  return {
    recordType,
    ...(recordType === "census" ? { censusStatesRelationships } : {}),
    assertions,
    defaultedClassifications,
    notes,
  };
}

/**
 * What the extractor sets for `source_classification` on the source entry.
 *
 * `derivative`, always, and deliberately. What was read is FamilySearch's INDEX
 * of the record, not the schedule or register itself — an index is a
 * transcription, and calling it `original` claims an examination that did not
 * happen. A researcher who then reads the page image has examined the original
 * and may upgrade it; that is a later, evidenced edit, not this tool's guess.
 *
 * Exported as a named constant rather than inlined so the spec and the writer
 * cannot drift.
 */
export const EXTRACTED_SOURCE_CLASSIFICATION = "derivative";

// ─── the calendar flag ──────────────────────────────────────────────────────

const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const DAY_MONTH_YEAR = new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+${MONTH}\\s+(\\d{4})\\b`, "i");
const MONTH_DAY_YEAR = new RegExp(`\\b${MONTH}\\s+\\d{1,2}(st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i");
const QUAKER_MONTH = /\b\d{1,2}(st|nd|rd|th)\s+(month|mo\.?)\b/i;
const DOUBLE_DATED = /\b\d{4}\/\d{1,4}\b/;

/**
 * The dates the calendar route may apply to (genealogist ruling, 2026-09-30,
 * the broad trigger): a date with a day and a month before 1752, anywhere; a
 * Quaker numbered month; a double-dated year. A year-only date never fires. No
 * country table here: `convert-dates` owns the cutoffs and clears the dates that
 * needed nothing.
 */
export function calendarFlags(assertions: readonly { date?: string; value: string }[]): string[] {
  const out = new Set<string>();
  for (const a of assertions) {
    for (const text of [a.date, a.value]) {
      if (!text) continue;
      const dm = text.match(DAY_MONTH_YEAR) ?? text.match(MONTH_DAY_YEAR);
      const y = dm ? Number(dm[dm.length - 1]) : NaN;
      if ((dm && y < 1752) || QUAKER_MONTH.test(text) || DOUBLE_DATED.test(text)) out.add(text.trim());
    }
  }
  return [...out];
}

// ─── the summary the caller relays ──────────────────────────────────────────

/**
 * What one extraction says, written by code for the caller to relay verbatim
 * (lead, 2026-09-29: "the record, the people on it and the key facts extracted,
 * plus any defaulted-classification warnings. Not every assertion, and not bare
 * counts"). The caller never sees the record, so this is the only account of it
 * that reaches the researcher.
 */
export function summarizeExtraction(doc: ExtractDocument, result: ExtractResult): string {
  const gx = doc.gedcomx ?? {};
  const title = collectionTitle(gx) ?? `record ${doc.recordId}`;
  const lines: string[] = [];
  const kind =
    result.recordType === "census"
      ? `census${result.censusStatesRelationships ? ", relationships stated" : ", no relationship column"}`
      : result.recordType.replace(/_/g, " ");
  const event = result.assertions.find((a) => a.fact_type === result.recordType && (a.date || a.place));
  const eventText = event ? `, ${[event.date, event.place].filter(Boolean).join(", ")}` : "";
  lines.push(`${title} (${kind}${eventText}).`);

  // People, in the record's own order, each with the facts written about them.
  const byPersona = new Map<string, ExtractedAssertion[]>();
  for (const a of result.assertions) {
    const key = a.record_persona_id ?? a.record_role;
    const arr = byPersona.get(key) ?? [];
    arr.push(a);
    byPersona.set(key, arr);
  }
  for (const as of byPersona.values()) {
    const name = as.find((a) => a.fact_type === "name")?.value ?? "(unnamed)";
    const facts = as
      .filter((a) => a.fact_type !== "name" && a.fact_type !== "sex")
      .filter((a) => !(result.recordType === "census" && a.fact_type === "census"))
      .map((a) => {
        if (a.fact_type === "relationship") return a.value;
        if (a.fact_type === "age") return `age ${a.value}`;
        const label = a.fact_type.replace(/_/g, " ");
        const own = a.value && a.value !== a.date && a.value !== a.place ? ` ${a.value}` : "";
        const when = a.date ? ` ${a.date}` : "";
        const where = a.place ? ` ${a.place}` : "";
        let body = `${label}${own}${when}${where}`;
        if (a.record_basis === "inferred") body += " (computed)";
        if (/household member line/.test(a.informant_bias_notes ?? "")) {
          body += ` (per ${a.informant_bias_notes!.match(/stated on (\d+)/)?.[1] ?? "other"} household line(s))`;
        }
        return body;
      });
    lines.push(`- ${name} (${as[0].record_role})${facts.length ? ": " + facts.join("; ") : ""}.`);
  }

  // A household head whose surname differs from the principal's is a lead for
  // hypothesis-tracking, never a relationship (walk, record-extractor.md Step 2).
  if (result.recordType === "census") {
    const principal = (gx.persons ?? []).find((p) => p.principal === true);
    const headA = result.assertions.find((a) => a.record_role === "head_of_household" && a.fact_type === "name");
    const ps = principal?.names?.[0]?.surname?.trim().toLowerCase();
    const hs = (headA?.structured_value?.surname as string | undefined)?.trim().toLowerCase();
    if (ps && hs && ps !== hs) {
      lines.push(
        `Lead: the head, ${headA!.value}, has a different surname from ${fullName(principal!)}. ` +
          `Possible kin of unstated relationship; worth a hypothesis, not a conclusion.`,
      );
    }
  }
  const calendar = calendarFlags(result.assertions);
  if (calendar.length > 0) {
    lines.push(
      `Calendar: ${calendar.join("; ")} may fall under the Old Style calendar or a ` +
        `double-dated year. Run convert-dates on each, and correct the assertion if it changes.`,
    );
  }
  const suspicious = result.assertions.filter((a) => /\[suspicious text/i.test(a.informant_bias_notes ?? ""));
  if (suspicious.length > 0) {
    lines.push(
      `Suspicious text: ${suspicious.length} passage(s) read like instructions and were captured as ` +
        `record text only (${suspicious.map((a) => `${a.record_role} ${a.fact_type}`).join(", ")}).`,
    );
  }
  for (const n of result.notes) lines.push(`Note: ${n}.`);
  if (result.defaultedClassifications.length > 0) {
    lines.push(
      `${result.defaultedClassifications.length} fact(s) took the default unknown/indeterminate ` +
        `classification: no table row covers a ${result.recordType.replace(/_/g, " ")} record yet.`,
    );
  }
  return lines.join("\n");
}
