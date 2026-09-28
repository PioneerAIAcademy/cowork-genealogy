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
// 21.4%. Code is identical every time. The rule below agrees with the model on
// 80.1% of personas by role class, and a sample of 30 disagreements was mostly
// the model inventing kin on a pre-1880 census.
//
// WHAT IT DOES NOT DO. It never emits the literal `record_role: "absent"` —
// negative evidence is a claim about a person the record does NOT contain, so
// the caller supplies those. It never writes identity links. It never decides
// which questions a fact answers; `extracted_for_question_ids` is the caller's.

import type { SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";
import type { PersonaIndexFields } from "./record-index-fields.js";

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
  | "other";

const TITLE_TO_RECORD: [RegExp, RecordType][] = [
  [/census/i, "census"],
  [/marriage/i, "marriage"],
  [/death|mortality/i, "death"],
  [/burial|cemeter|interment/i, "burial"],
  [/christen|baptis/i, "christening"],
  [/birth/i, "birth"],
  [/deed|land|grantor|grantee/i, "land"],
  [/draft|registration card/i, "draft_registration"],
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
  if (has(/^death$/i)) return "death";
  if (has(/^burial$|^cremation$/i)) return "burial";
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
function classify(
  recordType: RecordType,
  role: string,
  factClass: FactClass,
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

  if (recordType === "death" || recordType === "burial") {
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

  if (recordType === "christening" || recordType === "birth") {
    if (factClass === "event") {
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

  // No row. Default, and SAY SO.
  return {
    informant: "unknown",
    informant_proximity: "unknown",
    information_quality: "indeterminate",
    defaulted: true,
  };
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
  const recordType = detectRecordType(gx);
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
    const stated = censusStatedRelationships(place, Number.isNaN(year) ? undefined : year);
    censusStatesRelationships = stated === true;
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
  } else {
    const counters = new Map<string, number>();
    const principal = ps.find((p) => p.person.principal === true)?.id ?? ps[0]?.id;
    for (const p of ps) {
      roles.set(p.id, p.id === principal ? "principal" : numbered("other", counters));
    }
  }

  // ── assertions ──
  const push = (
    party: Party,
    factType: string,
    value: string,
    extra: Partial<ExtractedAssertion> = {},
    factClass?: FactClass,
  ) => {
    const role = roles.get(party.id) ?? "other_1";
    const cls = classify(recordType, role, factClass ?? factClassOf(factType, recordType));
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
    if (party.person.id) a.record_persona_id = party.person.id;
    if (cls.bias) a.informant_bias_notes = cls.bias;
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
    for (const f of p.facts ?? []) {
      const factType = normalizeFactType(f.type);
      if (factType === "") continue;

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
    const head = members.find((m) => /^head|^self/i.test(m.fields?.relationshipToHead ?? ""));
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
