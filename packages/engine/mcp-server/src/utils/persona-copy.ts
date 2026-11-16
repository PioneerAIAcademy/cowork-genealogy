// The in-memory copy of one record persona's facts onto a tree person, and the
// warnings that copy would introduce.
//
// Lifted out of tools/materialize-facts.ts so that `same_person` can ask what a
// link would do to the tree without importing a module that writes one: this
// module reads the documents it is handed and writes nothing. `materialize_facts`
// runs `copyPersonaFacts` for the persona arm's write; `warningsIfLinked` runs
// it on a clone and saves nothing.

import type {
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedFact,
  SimplifiedName,
  SimplifiedSourceReference,
} from "../types/gedcomx.js";
import type { MaterializeFactsOpResult, ConflictSurfaced } from "../types/materialize-facts.js";
import { GATE_EXEMPT_TYPES, computeTouchedPersonIds, introducedWarnings } from "../validation/introduced-warnings.js";
import { VALIDATOR_ENUMS } from "../validation/validator.js";
import { Mob } from "./mob.js";
import { calculateWarnings } from "../tools/person-warnings.js";
import { nextId } from "./gedcomx-ids.js";
import { factsEquivalent, VITAL_PRIMARY_TYPES } from "./merge-gedcomx.js";
import { resolveSourceRef as resolveSourceRefShared } from "./source-ref-resolver.js";
import { recordBasisOf } from "./record-basis.js";
import { placeTextKey } from "./place-verdict.js";
import { isLiveAssertion } from "./assertion-liveness.js";
import {
  GENDER_TYPES,
  NAME_TYPES,
  SKIP_TYPES,
  isCoupleEventFactType,
  candAsFact,
  factCandidate,
  factText,
  nameParts,
  normGender,
} from "./record-persona.js";

/** A refusal `materialize_facts` reports as `{ ok: false, errors }`. */
export class MaterializeFactsError extends Error {}

const str = factText;

/** Normalize a comparison key for a name part (case/space-insensitive). */
export function normNamePart(v: string | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

/** A readable descriptor of a coexisting competing fact (value, or date/place). */
export function factDescriptor(fact: SimplifiedFact): string {
  const v = str(fact.value);
  if (v) return v;
  const parts = [str(fact.date), str(fact.standard_place) ?? str(fact.place)].filter(Boolean);
  return parts.length ? parts.join(", ") : (fact.id ?? "(fact)");
}

// ─── provenance resolution (§4.2 step 2 — error, never null) ──────────────────

/**
 * Resolve an assertion's source-ref (the provenance-chain walk itself lives in
 * `utils/source-ref-resolver.ts`, shared with `tree_edit`'s add_relationship
 * `sourceAssertionId` — tree-materialization-spec §8), wrapped so a missing
 * hop surfaces as this tool's own error class. A missing tree S-entry is an
 * upstream research_append gate failure to surface, not to paper over with null.
 */
export function resolveSourceRef(
  assertion: any,
  research: any,
  tree: SimplifiedGedcomX,
): SimplifiedSourceReference {
  try {
    return resolveSourceRefShared(assertion, research, tree);
  } catch (e) {
    throw new MaterializeFactsError((e as Error).message);
  }
}

/** Union `ref` into `node.sources` (dedup on ref + page). Returns true when a
 *  new ref was actually attached. */
export function unionRef(
  node: { sources?: SimplifiedSourceReference[] },
  ref: SimplifiedSourceReference,
): boolean {
  node.sources ??= [];
  const key = `${ref.ref ?? ""}|${ref.page ?? ""}`;
  for (const r of node.sources) {
    if (`${r.ref ?? ""}|${r.page ?? ""}` === key) return false;
  }
  node.sources.push({ ...ref });
  return true;
}

/** A name assertion's `structured_value.type` -> the tree's name type. Only a
 *  document's own words map; anything else, and no type at all, mints none —
 *  never a default (issue #4378, Richard 2026-11-12). */
const TREE_NAME_TYPE: Readonly<Record<string, string | undefined>> = Object.assign(Object.create(null), {
  birth: "BirthName",
  married: "MarriedName",
  nickname: "Nickname",
  also_known_as: "AlsoKnownAs",
});

/** Upsert one SOURCED name onto a person: union the ref onto an equivalent
 *  existing name, else mint a new one carrying it. Name equivalence is
 *  case/space-insensitive on given + surname, which is what makes a re-run a
 *  no-op rather than a duplicate.
 *
 *  Shared by both arms — the persona arm's `name` assertions and the
 *  named-party arm (§4.6) — because the two had the same block character for
 *  character, and a second copy is how the two drift. NEVER sets `preferred`:
 *  concluding a preferred name is proof-conclusion's job (§4.2). */

export function upsertName(
  tree: SimplifiedGedcomX,
  person: SimplifiedPerson,
  given: string,
  surname: string,
  ref: SimplifiedSourceReference,
  /** Name type to record. OMITTED when undefined, which is legal (the tree
   *  schema requires only id/given/surname) and is what most of the corpus
   *  does. Omitting is a smaller claim than asserting the wrong one. */
  nameType?: string,
): { namesAdded: number; refsAttached: number } {
  person.names ??= [];
  const match = person.names.find(
    (n) =>
      normNamePart(n.given) === normNamePart(given) &&
      normNamePart(n.surname) === normNamePart(surname),
  );
  if (match) {
    return { namesAdded: 0, refsAttached: unionRef(match, ref) ? 1 : 0 };
  }
  const name: SimplifiedName = { id: nextId(tree, "N"), given, surname, sources: [ref] };
  if (nameType !== undefined) name.type = nameType;
  person.names.push(name);
  return { namesAdded: 1, refsAttached: 1 };
}

/** The place texts (`placeTextKey`) a record's assertions give two or more
 *  different standard places: the record disagrees with itself about them, so
 *  none of those standard places is copied onto the tree. */
function doubtedPlaces(research: any, recordId: unknown): Set<string> {
  const byText = new Map<string, Set<string>>();
  for (const a of Array.isArray(research.assertions) ? research.assertions : []) {
    if (!isLiveAssertion(a) || a.record_id !== recordId || typeof a.place !== "string" || str(a.standard_place) === undefined) continue;
    const key = placeTextKey(a.place);
    byText.set(key, (byText.get(key) ?? new Set<string>()).add(a.standard_place));
  }
  return new Set([...byText].filter(([, values]) => values.size > 1).map(([key]) => key));
}

/**
 * Copy one record persona's assertions onto `person` in `tree`, in memory:
 * sourced names, gender, and value-bearing facts, each upserted by identity so
 * a re-run is a no-op (tree-materialization-spec §4.2-§4.4). Returns the op's
 * result payload. Throws `MaterializeFactsError`; writes nothing.
 */
export function copyPersonaFacts(
  tree: SimplifiedGedcomX,
  research: any,
  person: SimplifiedPerson,
  assertions: any[],
  recordId: unknown,
  targetId: string,
  created: boolean,
  /** Fact ids that existed before the whole OP, when an op runs this more than
   *  once (the named-party arm's fact pass, one call per role spelling). */
  preExistingFactIds: ReadonlySet<string> | undefined,
): MaterializeFactsOpResult {
  // Snapshot pre-existing node ids so enrich (vs. add) counts are honest and a
  // re-run is a no-op. Scoped to THIS op — in a batch, an earlier op's writes
  // to this same person are already on `person.facts` and correctly count as
  // pre-existing for this op, exactly as if they'd arrived in an earlier,
  // separate call.
  const preFactIds = preExistingFactIds ?? new Set((person.facts ?? []).map((f) => f.id));
  const createdFactIds = new Set<string>();
  const enrichedFactIds = new Set<string>();
  let namesAdded = 0;
  let refsAttached = 0;
  const doubted = doubtedPlaces(research, recordId);

  for (const a of assertions) {
    const rawType = String(a.fact_type ?? "").toLowerCase();

    // Purely-argumentative / negative evidence is not a positive tree fact
    // (spec §7.1 (4)) — it stays a research.json assertion feeding the argument;
    // only its conclusion materializes, via proof-conclusion.
    if (recordBasisOf(a) === "absent") continue;

    if (GENDER_TYPES.has(rawType)) {
      // Gender sets the scalar, not a fact/name (no ref); never overwrite a
      // resolved Male/Female with a conflicting one — only fill Unknown/absent.
      const g = normGender(a.value);
      if (g && (person.gender === undefined || person.gender === "Unknown")) {
        person.gender = g;
      }
      continue;
    }

    if (NAME_TYPES.has(rawType)) {
      const ref = resolveSourceRef(a, research, tree);
      const { given, surname, type } = nameParts(a);
      const n = upsertName(tree, person, given, surname, ref, type ? TREE_NAME_TYPE[type] : undefined);
      namesAdded += n.namesAdded;
      refsAttached += n.refsAttached;
      continue;
    }

    // SKIP_TYPES matches the raw lowercased string; the couple-event check
    // folds separators too, because one event arrives spelled several ways and
    // only `marriage` was ever listed. A couple event belongs on the Couple
    // relationship via tree_edit, never on a person.
    if (SKIP_TYPES.has(rawType) || isCoupleEventFactType(rawType)) continue;

    // A value-bearing / event fact. Resolve provenance first (§4.2 step 2:
    // error, never null), then upsert by fact identity.
    const ref = resolveSourceRef(a, research, tree);
    const cand = factCandidate(a);
    if (cand.place !== undefined && doubted.has(placeTextKey(cand.place))) delete cand.standard_place;
    const candFact = candAsFact(cand);
    person.facts ??= [];
    const match = person.facts.find(
      (f) => factsEquivalent(f, candFact) && str(f.value) === cand.value,
    );

    if (match) {
      // Same fact — corroboration. Fill any attribute the existing fact lacks
      // (never remove, never upgrade a set field) and union the ref. NEVER set
      // `primary`.
      let fieldChanged = false;
      if (str(match.date) === undefined && cand.date !== undefined) {
        match.date = cand.date;
        fieldChanged = true;
      }
      if (str(match.place) === undefined && cand.place !== undefined) {
        match.place = cand.place;
        fieldChanged = true;
      }
      if (
        str(match.standard_place) === undefined &&
        cand.standard_place !== undefined &&
        placeTextKey(match.place ?? "") === placeTextKey(cand.place ?? "")
      ) {
        match.standard_place = cand.standard_place;
        fieldChanged = true;
      }
      if (str(match.value) === undefined && cand.value !== undefined) {
        match.value = cand.value;
        fieldChanged = true;
      }
      const refAdded = unionRef(match, ref);
      if (refAdded) refsAttached++;
      // Only a fact that existed BEFORE this op counts as "enriched"; a
      // corroboration of a fact minted earlier in the same op is not.
      if (match.id !== undefined && preFactIds.has(match.id) && (fieldChanged || refAdded)) {
        enrichedFactIds.add(match.id);
      }
    } else {
      // Coexist — a competing or new fact. Mint it with its ref. NEVER set
      // `primary`.
      const fact: SimplifiedFact = { id: nextId(tree, "F"), type: cand.type };
      if (cand.date !== undefined) fact.date = cand.date;
      if (cand.place !== undefined) fact.place = cand.place;
      if (cand.standard_place !== undefined) fact.standard_place = cand.standard_place;
      if (cand.value !== undefined) fact.value = cand.value;
      // The backlink (#2472). MINT ONLY — deliberately not set on the
      // corroboration branch above, and never filled in when absent there.
      // `factsEquivalent` is a loose DEDUPE predicate (an absent date or place
      // counts as compatible, and a place chain that is a prefix of the other
      // counts as compatible), not an identity one, so a fill-when-absent rule
      // would attach a backlink to a hand-entered `tree_edit add_fact`
      // conclusion and a later assertion update would then silently rewrite it.
      // The field means "this fact was minted from this assertion"; it is set
      // once and never inferred. See tree-materialization-spec.md section 4.4.
      if (typeof a.id === "string" && a.id !== "") fact.assertion_id = a.id;
      fact.sources = [ref];
      person.facts.push(fact);
      createdFactIds.add(fact.id!);
      refsAttached++;
    }
  }

  // A newly-minted person MUST end up with a name (the tree schema requires it,
  // and a create-or-enrich person is never nameless in practice).
  if (created && (person.names ?? []).length === 0) {
    throw new MaterializeFactsError(
      `cannot mint person '${targetId}' — the persona has no name assertion to build a name from`,
    );
  }

  // ── Conflict surfacing — single-valued/vital types only (§4.4 / Cluster F) ──
  // A vital type now holding ≥2 coexisting facts, at least one authored this
  // op, is a surfaced conflict. Multi-valued types (Occupation, Residence,
  // Census, …) are never in VITAL_PRIMARY_TYPES, so they coexist silently.
  const conflicts_surfaced: ConflictSurfaced[] = [];
  for (const type of VITAL_PRIMARY_TYPES) {
    const ofType = (person.facts ?? []).filter((f) => f.type === type);
    if (ofType.length >= 2 && ofType.some((f) => f.id !== undefined && createdFactIds.has(f.id))) {
      conflicts_surfaced.push({
        personId: targetId,
        factType: type,
        values: ofType.map(factDescriptor),
      });
    }
  }

  return {
    personId: targetId,
    created,
    factsAdded: createdFactIds.size,
    factsEnriched: enrichedFactIds.size,
    namesAdded,
    refsAttached,
    conflicts_surfaced,
  };
}

/** One warning as `warningsIfLinked` words it: the person it stands on, then
 *  the warning's own message. */
export function warningSentence(w: { personId: string; personName?: string; message: string }): string {
  return `${w.personName ? `${w.personName} (${w.personId})` : w.personId}: ${w.message}`;
}

/** How many of the record's facts, and how many of the tree's, one warning names. */
const FACTS_BEHIND_CAP = 3;
const TIER_ORDER = [...VALIDATOR_ENUMS.person_evidence_confidence];

/** Whether warning `w` still stands on `tree`: same tag, same anchor, same
 *  related person. A tree the warnings cannot be computed on has none. */
function stillWarns(
  tree: SimplifiedGedcomX,
  w: { issueType: string; personId: string; relatedPersonId?: string },
): boolean {
  try {
    const mob = new Mob(tree, w.personId);
    return calculateWarnings(mob, mob, mob, /* isFinalWarnings */ true).some(
      (x) => x.issueType === w.issueType && (x.relatedPersonId ?? "") === (w.relatedPersonId ?? ""),
    );
  } catch {
    return false;
  }
}

/** The facts warning `w` depends on: taking any one of them out of the
 *  after-tree clears the warning. `fromRecord` marks a fact the copy added;
 *  the rest are facts the tree held before it. Read on the warning's own
 *  person and its related person. A warning that depends only on a
 *  relationship has none. */
function factsBehind(
  before: SimplifiedGedcomX,
  after: SimplifiedGedcomX,
  w: { issueType: string; personId: string; relatedPersonId?: string },
): Array<{ personId: string; fact: SimplifiedFact; fromRecord: boolean }> {
  const held = new Set<string>();
  for (const p of before.persons ?? []) for (const f of p.facts ?? []) if (f.id) held.add(f.id);
  const out: Array<{ personId: string; fact: SimplifiedFact; fromRecord: boolean }> = [];
  for (const pid of new Set([w.personId, w.relatedPersonId].filter((x): x is string => typeof x === "string"))) {
    const person = (after.persons ?? []).find((p) => p.id === pid);
    for (const fact of person?.facts ?? []) {
      if (!fact.id) continue;
      const without: SimplifiedGedcomX = {
        ...after,
        persons: (after.persons ?? []).map((p) =>
          p.id === pid ? { ...p, facts: (p.facts ?? []).filter((f) => f.id !== fact.id) } : p,
        ),
      };
      if (!stillWarns(without, w)) out.push({ personId: pid, fact, fromRecord: !held.has(fact.id) });
    }
  }
  return out;
}

/** Whether `fact` was on `personId` in the write-once starting tree. */
function cameWithTree(startingTree: SimplifiedGedcomX | null, personId: string, fact: SimplifiedFact): boolean {
  const person = (Array.isArray(startingTree?.persons) ? startingTree.persons : []).find((p) => p && p.id === personId);
  return (person?.facts ?? []).some((f) => f.id !== undefined && f.id === fact.id);
}

/** Where a tree fact comes from and what backs it. Tree facts are taken as
 *  correct while researching (lead, 2026-11-16), so a fact the starting tree
 *  held reads "came with the tree" whatever links it has gained since; so does
 *  an unlinked fact of a project with no starting tree on file. A fact this
 *  project added reads with the live person_evidence links to `personId`
 *  whose assertion comes from a source the fact cites. */
function factBacking(
  research: any,
  personId: string,
  fact: SimplifiedFact,
  startingTree: SimplifiedGedcomX | null,
): string {
  const refs = new Set((fact.sources ?? []).map((s) => s.ref));
  const sourceIds = new Set(
    (Array.isArray(research?.sources) ? research.sources : [])
      .filter((s: any) => s && refs.has(s.gedcomx_source_description_id))
      .map((s: any) => s.id),
  );
  const byId = new Map<string, any>(
    (Array.isArray(research?.assertions) ? research.assertions : [])
      .filter((a: any) => isLiveAssertion(a) && sourceIds.has(a.source_id))
      .map((a: any) => [a.id, a]),
  );
  const links = (Array.isArray(research?.person_evidence) ? research.person_evidence : []).filter(
    (e: any) => e && !e.superseded_by && e.person_id === personId && byId.has(e.assertion_id),
  );
  if (cameWithTree(startingTree, personId, fact) || (startingTree === null && links.length === 0)) {
    return "which came with the tree";
  }
  if (links.length === 0) return "which this project added and no live link backs";
  const records = new Set(links.map((e: any) => byId.get(e.assertion_id).record_id ?? byId.get(e.assertion_id).source_id)).size;
  const tiers = TIER_ORDER.filter((t) => links.some((e: any) => e.confidence === t));
  const ids = links.map((e: any) => e.id).join(", ");
  return `which this project added: ${records} record${records === 1 ? " backs" : "s back"} it, linked ${tiers.join(" and ")} (${ids})`;
}

/** " It depends on the record's Residence of 1881; and on the tree's Burial of
 *  3 March 1870 (F3), which this project added: 1 record backs it, linked
 *  probable (pe_005, pe_006)." The record's facts first, then the tree's.
 *  Empty when the warning depends on no fact. */
function dependsOn(
  research: any,
  all: Array<{ personId: string; fact: SimplifiedFact; fromRecord: boolean }>,
  w: { personId: string },
  startingTree: SimplifiedGedcomX | null,
): string {
  const behind = [
    ...all.filter((x) => x.fromRecord).slice(0, FACTS_BEHIND_CAP),
    ...all.filter((x) => !x.fromRecord).slice(0, FACTS_BEHIND_CAP),
  ];
  if (behind.length === 0) return "";
  const parts = behind.map(({ personId, fact, fromRecord }) => {
    const when = str(fact.date) !== undefined ? ` of ${fact.date}` : "";
    if (fromRecord) return `the record's ${fact.type}${when}`;
    const where = personId === w.personId ? fact.id : `${fact.id} on ${personId}`;
    return `the tree's ${fact.type}${when} (${where}), ${factBacking(research, personId, fact, startingTree)}`;
  });
  return ` It depends on ${parts.join("; and on ")}.`;
}

/**
 * Warning types `warningsIfLinked` leaves out: they say nothing about whether
 * two people are the same. Measured 2026-11-15 over the 244 saved e2e runs,
 * each fires about as often on a link a run kept as on the same record person
 * paired with someone else in the tree (blank name 5.0% and 5.0%, non-standard
 * place 1.8% and 1.9%), or restates what the caller already compares (the two
 * different-surname types). Every other type is listed, the write gate's
 * exempt ones included: "an event more than a year before birth", exempt at
 * the gate, fires on 3.8% of kept links and 38.3% of wrong pairings.
 */
export const LINK_REVIEW_NOISE_TYPES: ReadonlySet<string> = new Set([
  "hasBlankName",
  "nonStandardPlace",
  "nonStandardDate",
  "noGenderFound",
  "missingFactsAndRelatives",
  "hasPlaceStandardOtherCountry",
  "hasDiffSurnameMale",
  "maleRelativesHasDiffSurname",
  // Two birth dates that disagree. The birth comparison owns that: the caller
  // checks the gap itself and `research_append` refuses a link past a wide one.
  "tooManyBirthDates2",
  "relativesTooManyBirthDates2",
]);

/** "An event before birth" is left out when the event is the record's own
 *  birth or christening: that is two birth dates disagreeing, again the birth
 *  comparison's. A residence or a marriage before the tree's birth is listed. */
const EVENT_BEFORE_BIRTH_TYPES: ReadonlySet<string> = new Set([
  "hasEventBeforeBirth365_2",
  "relativesHasEventBeforeBirth365_2",
]);
const BIRTH_LIKE_TYPES: ReadonlySet<string> = new Set(["Birth", "Christening", "Baptism"]);
const RELATIVE_FORM = /^(relatives|femaleRelatives|maleRelatives)/;

/** One warning a link would introduce. */
export interface LinkWarning {
  issueType: string;
  personId: string;
  /** The warning's own severity: a `contradiction` cannot be, an `implausible`
   *  one is unlikely. */
  impossible: boolean;
  /** True when `materialize_facts` would refuse the copy for it until justified. */
  refusedAtSave: boolean;
  sentence: string;
}

/**
 * The warnings a link would bring: what the tree would report if persona
 * `recordRole` of `recordId` were copied onto the existing tree person
 * `personId`. It is the persona arm's own copy (`copyPersonaFacts`) run on a
 * clone of the tree, with no link required and nothing saved, then the write
 * gate's delta (`introducedWarnings`) with its exempt list off and
 * `LINK_REVIEW_NOISE_TYPES` left out. One sentence per warning: the person it
 * stands on, the warning's message, whether it is impossible or implausible and
 * whether `materialize_facts` would refuse the copy for it, then the facts it
 * depends on and where each tree fact comes from (`dependsOn`). A warning says
 * one of two colliding facts is wrong; which one is the caller's to decide.
 * Impossible warnings come first, a sentence is listed once, and a relatives
 * form is listed only when no self form is.
 *
 * Empty when `personId` is not in the tree, the persona has no live assertion,
 * the copy cannot be made, or it changes nothing (the facts are already there).
 * Never throws: it answers a question beside a score, and a failure to compute
 * it must not fail the score.
 *
 * Exported so `same_person` and the eval mock run this rule, not a copy of it.
 */
export function warningsIfLinked(
  research: any,
  tree: SimplifiedGedcomX,
  recordId: unknown,
  recordRole: unknown,
  personId: unknown,
  startingTree: SimplifiedGedcomX | null = null,
): string[] {
  return introducedByLink(research, tree, recordId, recordRole, personId, startingTree).map((x) => x.sentence);
}

/** `warningsIfLinked` with each warning's tag beside its sentence.
 *  `includeNoise: true` is measurement-only: it also lists
 *  `LINK_REVIEW_NOISE_TYPES`, so the choice of list can be re-derived. No
 *  shipped caller passes it. */
export function introducedByLink(
  research: any,
  tree: SimplifiedGedcomX,
  recordId: unknown,
  recordRole: unknown,
  personId: unknown,
  startingTree: SimplifiedGedcomX | null = null,
  includeNoise = false,
): LinkWarning[] {
  try {
    const target = str(personId);
    if (target === undefined || str(recordId) === undefined || str(recordRole) === undefined) return [];
    if (!(tree?.persons ?? []).some((p) => p && p.id === target)) return [];
    const after = structuredClone(tree);
    const assertions = (Array.isArray(research?.assertions) ? research.assertions : []).filter(
      (a: any) => isLiveAssertion(a) && a.record_id === recordId && a.record_role === recordRole,
    );
    if (assertions.length === 0) return [];
    const person = (after.persons ?? []).find((p) => p && p.id === target);
    if (!person) return [];
    copyPersonaFacts(after, research, person, assertions, recordId, target, false, undefined);
    const touched = computeTouchedPersonIds(tree, after);
    if (touched.length === 0) return [];
    const { allIntroduced } = introducedWarnings(tree, after, touched, undefined, undefined, false);
    const seen = new Set<string>();
    const out: LinkWarning[] = [];
    for (const w of allIntroduced) {
      if (!includeNoise && LINK_REVIEW_NOISE_TYPES.has(w.issueType)) continue;
      const behind = factsBehind(tree, after, w);
      if (
        !includeNoise &&
        EVENT_BEFORE_BIRTH_TYPES.has(w.issueType) &&
        behind.some((x) => x.fromRecord && BIRTH_LIKE_TYPES.has(String(x.fact.type)))
      ) continue;
      const refusedAtSave = !GATE_EXEMPT_TYPES.has(w.issueType);
      const impossible = w.severity === "contradiction";
      const sentence =
        `${warningSentence(w)} ${impossible ? "Impossible" : "Implausible"}; ${refusedAtSave ? "refused" : "allowed"} at save.` +
        dependsOn(research, behind, w, startingTree);
      if (seen.has(sentence)) continue;
      seen.add(sentence);
      out.push({ issueType: w.issueType, personId: w.personId, impossible, refusedAtSave, sentence });
    }
    // A relatives form restates a self form from a neighbour's side ("a female
    // relative of this person had a child after 45"): listed only when no self
    // form is.
    const own = out.filter((x) => !RELATIVE_FORM.test(x.issueType));
    const listed = own.length > 0 ? own : out;
    return [...listed.filter((x) => x.impossible), ...listed.filter((x) => !x.impossible)];
  } catch {
    return [];
  }
}
