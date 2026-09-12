// materialize_facts — write a record persona's extracted assertions onto a tree
// person as SOURCED facts/names (spec docs/specs/tree-materialization-spec.md §4).
//
// The record→tree workhorse, in two arms.
//
// PERSONA arm ({ projectPath, personId, recordId, recordRole }) — the caller
// passes REFERENCES only; the tool reads the persona's assertions (every
// assertion matching recordId + recordRole) from research.json, resolves each
// one's provenance chain
// (assertion.source_id → research source.gedcomx_source_description_id → tree
// S-entry id) into a non-null source-ref, and writes to tree.gedcomx.json only.
// Because the input is references, the intact provenance chain is read from disk
// and CANNOT be dropped — the structural cure for the cruz "0/13 facts carried a
// ref" leak.
//
// NAMED-PARTY arm ({ projectPath, assertionId, relatedRole, name, gender? }) —
// for a party a relationship/marriage assertion NAMES but gives no persona of
// her own (the bride in the groom's marriage register is the canonical case). There is no recordRole to reference, so this arm necessarily takes
// one piece of caller-supplied DATA — her name — and nothing else. The
// provenance is still not the caller's to supply or drop: the ref is resolved
// from the assertion's own source_id through the same shared resolver, and the
// write is refused without it. What is structural in both arms is the ref, not
// the input shape; the name is remembered, the ref is enforced.
//
// Fact identity reuses the existing `factsEquivalent` (type + date/place-compat)
// from utils/merge-gedcomx.ts plus an equal-`value` check — never a
// `(fact_type, value)` key (`value` is null for event facts, which would collapse
// every Birth into one fact). Agreeing values union their refs onto one fact;
// incompatible date/place OR a different value coexist as separate facts. A
// competing value of a single-valued/vital type (VITAL_PRIMARY_TYPES) is surfaced
// in conflicts_surfaced; multi-valued types (Occupation, Residence, Census, …)
// coexist silently. materialize_facts NEVER sets `primary`/`preferred` — only
// proof-conclusion does — and never writes relationships or `conflicts` entries.
//
// The write tail (sanitizeTree → read research → apply → validateIntroduced →
// atomicWriteJson) mirrors tree_edit's executeTreeOps; it is a
// SINGLE-FILE tree write (atomicWriteJson, never atomicWriteBoth).

import type {
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedFact,
  SimplifiedName,
  SimplifiedSourceReference,
} from "../types/gedcomx.js";
import type {
  MaterializeFactsInput,
  MaterializeFactsOp,
  MaterializeFactsAnyOp,
  MaterializeFactsNamedPartyOp,
  MaterializeFactsOpResult,
  MaterializeFactsResult,
  ConflictSurfaced,
} from "../types/materialize-facts.js";
import { validateIntroduced } from "../validation/introduced-errors.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import {
  atomicWriteJson,
  readProjectJson,
  formatIssues,
  withProjectLock,
  NoProjectError,
  noProjectResult,
} from "../utils/project-io.js";
import { nextId } from "../utils/gedcomx-ids.js";
import { factsEquivalent, VITAL_PRIMARY_TYPES } from "../utils/merge-gedcomx.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import {
  resolveSourceRef as resolveSourceRefShared,
  isRelationshipEstablishing,
} from "../utils/source-ref-resolver.js";

class MaterializeFactsError extends Error {}

// ─── fact_type → tree fact type (honors the #711 structured-fact model) ───────
//
// An event's place/date are ATTRIBUTES of the one event fact, not their own fact
// types — extraction already folds birthplace/birth-date into a single `birth`
// assertion (research-append canonicalization), so here we only PascalCase the
// canonical event type and let date/place/value ride along as attributes. The
// value is null for event facts (below), which is why fact identity keys on
// `factsEquivalent` + `value`, never `(type, value)`.

/** Assertion fact_types handled as NON-facts: names, gender, and the ones this
 *  tool deliberately does not materialize (relationship edges are `tree_edit`
 *  add_relationship's job, §4.5; `age` is indirect evidence feeding a birth-year
 *  inference, not a standalone tree fact; `marriage` is a Couple-relationship
 *  event — per tree-edit.ts's own convention, "a Marriage/Divorce fact lives
 *  on the Couple, never duplicated onto each spouse" — so it can never be a
 *  correct PERSON-level write, structurally, not just usually. A caller
 *  wanting the marriage's date/place on the tree writes it via `tree_edit`
 *  `add_relationship`'s Couple `facts`, sourced with the same assertion via
 *  `sourceAssertionId`). Guards the exact mistake ut_person_evidence_022
 *  regression-tests: a `marriage` assertion on an already-existing spouse's
 *  persona getting materialized straight onto that person, leaving the
 *  relationship itself factless.
 *
 *  Skipped here means "not a fact for THIS persona" — it never meant the other
 *  party the assertion names has nowhere to go. That party is minted by the
 *  named-party arm below (§4.6), which writes her a sourced NAME and still no
 *  fact, so the Couple event stays on the edge where it belongs. */
const NAME_TYPES: ReadonlySet<string> = new Set(["name"]);
const GENDER_TYPES: ReadonlySet<string> = new Set(["gender", "sex"]);
const SKIP_TYPES: ReadonlySet<string> = new Set([
  "relationship",
  "age",
  "marriage",
  // `parentage`/`parentchild` join for the reason the comment above gives for
  // `marriage`: they establish a link between TWO parties, so they can never be
  // a correct person-level write, and the shared
  // RELATIONSHIP_ESTABLISHING_TYPES now says so on the sourcing side. Leaving
  // them out made the tool treat one fact_type two ways — a two-party link when
  // sourcing an edge, a person-level fact when materializing a persona. No tree
  // in the corpus carries a Parentage-like person fact, so nothing depended on
  // the old behaviour.
  "parentage",
  "parentchild",
]);

/** Couple-relationship event types, broken out so tree-forget.ts can import
 *  the set and sweep all of them without maintaining a parallel list. */
export const COUPLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "Marriage", "Divorce", "Annulment", "Engagement", "MarriageBanns", "Separation",
]);

/** Tree fact types whose `value` is null (events + place/duration attributes) —
 *  the qualifier `value` field is meaningful only for value-bearing types
 *  (Occupation, Race, Religion, Nationality, …). Exported so
 *  tests/packaging/tree-forget-sweep-drift.test.ts (#1549) can cross-reference
 *  its couple-event members against tree-forget.ts's swept set without
 *  re-declaring this list. */
export const EVENT_TREE_TYPES: ReadonlySet<string> = new Set([
  "Birth", "Death", "Christening", "Burial", "Baptism", "Cremation",
  ...COUPLE_EVENT_TYPES,
  "Residence", "Census", "MunicipalCensus", "Immigration", "Emigration",
  "Naturalization", "Will", "Probate", "Adoption",
]);

/** PascalCase a canonical snake_case fact_type into its tree type spelling:
 *  `birth` → `Birth`, `cause_of_death` → `CauseOfDeath`. Guarantees the
 *  uppercase-initial the tree schema requires. */
function toTreeFactType(factType: string): string {
  return factType
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

// ─── small helpers ────────────────────────────────────────────────────────────

async function readJson(projectPath: string, filename: string): Promise<any> {
  try {
    return await readProjectJson(projectPath, filename);
  } catch (e) {
    // NoProjectError is an ANSWER, not a failure — re-raised unchanged so the
    // outer catch can return noProjectResult().
    if (e instanceof NoProjectError) throw e;
    throw new MaterializeFactsError(e instanceof Error ? e.message : String(e));
  }
}

/** Trimmed non-empty string, else undefined. */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Normalize a comparison key for a name part (case/space-insensitive). */
function normNamePart(v: string | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

/** Normalize a record/persona gender value to the tree enum, else undefined. */
function normGender(v: unknown): "Male" | "Female" | "Unknown" | undefined {
  const g = String(v ?? "").trim().toLowerCase();
  if (g === "male" || g === "m") return "Male";
  if (g === "female" || g === "f") return "Female";
  if (g === "unknown" || g === "u") return "Unknown";
  return undefined;
}

/** A readable descriptor of a coexisting competing fact (value, or date/place). */
function factDescriptor(fact: SimplifiedFact): string {
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
function resolveSourceRef(
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
function unionRef(
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

/** Upsert one SOURCED name onto a person: union the ref onto an equivalent
 *  existing name, else mint a new one carrying it. Name equivalence is
 *  case/space-insensitive on given + surname, which is what makes a re-run a
 *  no-op rather than a duplicate.
 *
 *  Shared by both arms — the persona arm's `name` assertions and the
 *  named-party arm (§4.6) — because the two had the same block character for
 *  character, and a second copy is how the two drift. NEVER sets `preferred`:
 *  concluding a preferred name is proof-conclusion's job (§4.2). */
function upsertName(
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

// ─── build the tree-fact / tree-name candidate from an assertion ──────────────

interface FactCandidate {
  type: string;
  date?: string;
  place?: string;
  standard_place?: string;
  value?: string;
}

function factCandidate(assertion: any): FactCandidate {
  const type = toTreeFactType(String(assertion.fact_type));
  const cand: FactCandidate = { type };
  const date = str(assertion.date);
  if (date) cand.date = date;
  const place = str(assertion.place);
  if (place) cand.place = place;
  const standardPlace = str(assertion.standard_place);
  if (standardPlace) cand.standard_place = standardPlace;
  // Event facts carry no `value` (place/date are attributes, #711); value-bearing
  // types (Occupation, …) keep the assertion's value.
  if (!EVENT_TREE_TYPES.has(type)) {
    const value = str(assertion.value);
    if (value) cand.value = value;
  }
  return cand;
}

/** A SimplifiedFact view of a candidate for factsEquivalent(). */
function candAsFact(cand: FactCandidate): SimplifiedFact {
  const f: SimplifiedFact = { type: cand.type };
  if (cand.date !== undefined) f.date = cand.date;
  if (cand.place !== undefined) f.place = cand.place;
  if (cand.standard_place !== undefined) f.standard_place = cand.standard_place;
  if (cand.value !== undefined) f.value = cand.value;
  return f;
}

/** Given/surname from a name assertion — its structured_value when present, else
 *  parsed from `value` (surname = last token). Both parts are always returned
 *  (empty string, not undefined) so the minted name satisfies the tree schema's
 *  present-and-string given/surname requirement. */
function nameParts(assertion: any): { given: string; surname: string } {
  const sv = assertion.structured_value;
  if (sv && typeof sv === "object" && !Array.isArray(sv)) {
    const given = typeof sv.given === "string" ? sv.given : "";
    const surname = typeof sv.surname === "string" ? sv.surname : "";
    if (given || surname) return { given, surname };
  }
  const tokens = String(assertion.value ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { given: "", surname: "" };
  if (tokens.length === 1) return { given: tokens[0], surname: "" };
  return { given: tokens.slice(0, -1).join(" "), surname: tokens[tokens.length - 1] };
}

// ─── apply one persona-materialization op to a shared in-memory tree ─────────
//
// Pure mutation, shared by both call shapes below: given the tree and
// research documents (already read from disk) plus one persona reference,
// mints/enriches the target person and returns its per-op result payload.
// Throws MaterializeFactsError on failure — the caller (single-op or batch)
// decides how to report it (bare message, or `ops[i]: <message>`). Keeping
// this in one place means create-or-enrich, fact-identity, and
// conflict-surfacing behavior (§4.2-§4.4) is defined exactly once regardless
// of how many personas one call materializes.
function applyMaterializeOp(
  tree: SimplifiedGedcomX,
  research: any,
  op: MaterializeFactsOp,
): MaterializeFactsOpResult {
  const { recordId, recordRole } = op;
  if (str(recordId) === undefined || str(recordRole) === undefined) {
    throw new MaterializeFactsError("recordId and recordRole are required");
  }

  // The persona: every assertion matching recordId + recordRole.
  const assertions = (Array.isArray(research.assertions) ? research.assertions : []).filter(
    (a: any) => a && a.record_id === recordId && a.record_role === recordRole,
  );
  if (assertions.length === 0) {
    throw new MaterializeFactsError(
      `no assertions found for recordId '${recordId}' and recordRole '${recordRole}'`,
    );
  }

  // ── Create-or-enrich: find the target person, or mint it (§4.3) ──
  const targetId = str(op.personId) ?? nextId(tree, "I");
  let person = (tree.persons ?? []).find((p) => p && p.id === targetId);
  let created = false;
  if (!person) {
    created = true;
    // Gender from the persona's gender/sex assertions, else Unknown.
    let gender: "Male" | "Female" | "Unknown" = "Unknown";
    for (const a of assertions) {
      if (GENDER_TYPES.has(String(a.fact_type))) {
        const g = normGender(a.value);
        if (g) {
          gender = g;
          break;
        }
      }
    }
    person = { id: targetId, gender, names: [] };
    tree.persons = [...(tree.persons ?? []), person];
  }

  // Snapshot pre-existing node ids so enrich (vs. add) counts are honest and a
  // re-run is a no-op. Scoped to THIS op — in a batch, an earlier op's writes
  // to this same person are already on `person.facts` and correctly count as
  // pre-existing for this op, exactly as if they'd arrived in an earlier,
  // separate call.
  const preFactIds = new Set((person.facts ?? []).map((f) => f.id));
  const createdFactIds = new Set<string>();
  const enrichedFactIds = new Set<string>();
  let namesAdded = 0;
  let refsAttached = 0;

  for (const a of assertions) {
    const rawType = String(a.fact_type ?? "").toLowerCase();

    // Purely-argumentative / negative evidence is not a positive tree fact
    // (spec §7.1 (4)) — it stays a research.json assertion feeding the argument;
    // only its conclusion materializes, via proof-conclusion.
    if (a.evidence_type === "negative") continue;

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
      const { given, surname } = nameParts(a);
      const n = upsertName(tree, person, given, surname, ref, "BirthName");
      namesAdded += n.namesAdded;
      refsAttached += n.refsAttached;
      continue;
    }

    if (SKIP_TYPES.has(rawType)) continue;

    // A value-bearing / event fact. Resolve provenance first (§4.2 step 2:
    // error, never null), then upsert by fact identity.
    const ref = resolveSourceRef(a, research, tree);
    const cand = factCandidate(a);
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
      if (str(match.standard_place) === undefined && cand.standard_place !== undefined) {
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

/** True when an op selects the named-party arm (§4.6). Discriminated by
 *  `assertionId`: the persona arm has no such field, and requiring a string
 *  (not merely a present key) keeps a null/undefined from selecting an arm the
 *  caller did not mean. */
function isNamedPartyOp(op: MaterializeFactsAnyOp): op is MaterializeFactsNamedPartyOp {
  return typeof (op as MaterializeFactsNamedPartyOp).assertionId === "string";
}

// ─── apply one NAMED-PARTY op (§4.6) ─────────────────────────────────────────
//
// Mint or enrich the party a `relationship`/`marriage` assertion NAMES but does
// not give a persona of its own — canonically the bride in the groom's marriage
// register. She has no `record_role`, so the persona arm
// has nothing to select on and `SKIP_TYPES` drops the only assertion naming
// her; before this arm she could only be written by `tree_edit add_person`,
// whose name path is ref-tolerant, so a record-derived person landed with NO
// provenance (the leak tree-materialization-spec §6 names).
//
// Writes a sourced NAME plus the gender scalar, and NOTHING else: no facts, no
// relationship edge. §4.5 therefore still holds in full — a `marriage`
// assertion never becomes a person-level fact; only the party it names becomes
// a sourced name, and the Couple event stays on the edge.
//
// The ref is enforced, the name is not: the tool cannot know the name the
// record gives (8 of 162 corpus relationship/marriage assertions carry it in
// `structured_value`, under five distinct key shapes, which is why the caller supplies
// it). It also does NOT refuse a name matching the persona's own — a same-named
// father and son is ordinary genealogy, and refusing there would block correct
// mints far more often than it would catch a duplicate.
function applyNamedPartyOp(
  tree: SimplifiedGedcomX,
  research: any,
  op: MaterializeFactsNamedPartyOp,
): MaterializeFactsOpResult {
  const assertionId = str(op.assertionId);
  if (assertionId === undefined) throw new MaterializeFactsError("assertionId is required");

  const relatedRole = str(op.relatedRole);
  if (relatedRole === undefined) {
    throw new MaterializeFactsError(
      "relatedRole is required — name the role of the party being minted " +
        "(e.g. 'bride', 'mother'), which is the party that is NOT the persona",
    );
  }

  const assertion = (Array.isArray(research.assertions) ? research.assertions : []).find(
    (a: any) => a && a.id === assertionId,
  );
  if (!assertion) {
    throw new MaterializeFactsError(
      `assertionId '${assertionId}' not found in research.json assertions`,
    );
  }

  if (!isRelationshipEstablishing(assertion.fact_type)) {
    throw new MaterializeFactsError(
      `assertion '${assertionId}' has fact_type '${assertion.fact_type}' — only an ` +
        "assertion that establishes a link between two parties names a second party " +
        "('relationship', 'marriage', 'parentage', 'parentchild'; case-insensitive). If the " +
        "party you mean has its own record_role, materialize it with the recordId/recordRole form",
    );
  }

  // This arm exists ONLY for a party the record gives no persona. If the role
  // being minted DOES have a persona on this record, the persona arm is the
  // correct call and mints her with her facts, where this arm would leave a
  // name-only shell — the very symptom tree-materialization-spec §1.1 (1)
  // exists to cure. Measured over eval/**/research.json: the role named by a
  // relationship/marriage assertion already has its own persona on the same
  // record in 52 of 162 cases (32.1%), so this is the common path, not an edge
  // case. Comparing only against the assertion's OWN record_role would miss
  // every one of them.
  const wanted = normNamePart(relatedRole);
  const ownRole = normNamePart(String(assertion.record_role ?? ""));
  if (wanted === ownRole) {
    throw new MaterializeFactsError(
      `relatedRole '${relatedRole}' is assertion '${assertionId}'s own record_role — that ` +
        "party is the persona this assertion belongs to; materialize it with the " +
        "recordId/recordRole form so it arrives with its facts",
    );
  }
  const recordId = assertion.record_id;
  const siblings = (Array.isArray(research.assertions) ? research.assertions : []).filter(
    (a: any) => a && a.record_id === recordId && normNamePart(String(a.record_role ?? "")) === wanted,
  );
  // Refuse ONLY when the persona arm could actually MINT this party, which
  // means the persona carries a non-negative NAME assertion: the arm refuses to
  // mint a person it cannot name, so steering a gender-only or birth-only
  // persona there errors, and this arm refusing would send the caller back to
  // the call that just failed. That is the writable-by-neither-arm dead end
  // this whole arm exists to remove. Live shape: a `bride` persona of
  // [birth, marriage] with no name; 57 such personas in the scenario corpus.
  //
  // Deliberately NOT part of this test: whether the target person already
  // exists. An earlier version added that as a second condition, reasoning the
  // persona arm would enrich rather than mint. But an existing person gives the
  // persona nothing to write, so it re-created the same dead end, and it broke
  // idempotency (the first call mints the person, so the second refuses itself).
  const siblingCanMint = siblings.some(
    (a: any) =>
      a.evidence_type !== "negative" && NAME_TYPES.has(String(a.fact_type ?? "").toLowerCase()),
  );
  if (siblings.length > 0 && siblingCanMint) {
    const personIdHint = str(op.personId) !== undefined ? `personId: '${str(op.personId)}', ` : "";
    throw new MaterializeFactsError(
      `role '${relatedRole}' already has its own persona on record '${recordId}' (e.g. assertion ` +
        `'${siblings[0].id}') — materialize it with { ${personIdHint}recordId: '${recordId}', ` +
        `recordRole: '${siblings[0].record_role}' }, which writes her facts too. This form is for ` +
        "a party the record names without giving it a persona of its own",
    );
  }

  // Negative evidence is not a positive tree write (spec §7.1 (4)) — the same
  // rule the persona arm applies per assertion. "Father: not recorded" must not
  // mint a father; the assertion stays in research.json feeding the argument,
  // and only its conclusion materializes, via proof-conclusion.
  if (assertion.evidence_type === "negative") {
    throw new MaterializeFactsError(
      `assertion '${assertionId}' is negative evidence — it records what the source does NOT ` +
        "say, so it cannot mint a person. Negative evidence feeds the argument in research.json; " +
        "only a conclusion drawn from it reaches the tree, via proof-conclusion",
    );
  }

  // Trimmed before persisting: `str()` only proves non-blank, and the persona
  // arm's own `nameParts` trims what it parses, so an untrimmed part here would
  // put "  Mary  " in the tree and disagree with the other arm.
  const given = str(op.name?.given)?.trim() ?? "";
  const surname = str(op.name?.surname)?.trim() ?? "";
  // A multi-token `given` with no `surname` KEY is ambiguous and the tool must
  // not guess: "Mary Doyle" is a full name, "Anna Maria" is a compound given
  // name a register may supply with no surname at all, and splitting the second
  // fabricates a surname — under an enforced ref, which makes the fabrication
  // look provenanced. Guessing the other way is no better: writing "Mary Doyle"
  // whole produces a name node the persona arm can never match, so the same
  // woman ends up with two sourced names. So neither is guessed: the caller
  // splits it, or says explicitly that there is no surname by passing the
  // `surname` key (even empty).
  const surnameStated = !!op.name && typeof op.name === "object" && "surname" in op.name;
  if (!surnameStated && /\s/.test(given)) {
    throw new MaterializeFactsError(
      `name.given '${given}' has more than one token and no \`surname\` was given, which is ` +
        "ambiguous: it may be a full name or a compound given name. Pass given and surname " +
        "separately, or pass surname: \"\" to state that the record gives none. This tool does " +
        "not guess a surname it would then carry under a resolved source-ref",
    );
  }
  if (given === "" && surname === "") {
    throw new MaterializeFactsError(
      `cannot mint the '${relatedRole}' named in assertion '${assertionId}' — \`name\` must ` +
        "carry a non-empty given or surname (a minted person is never nameless)",
    );
  }

  // Provenance FIRST: nothing is written until the ref resolves (error, never
  // null — §4.2 step 2), so a missing S-entry cannot leave a half-minted person.
  const ref = resolveSourceRef(assertion, research, tree);

  const targetId = str(op.personId) ?? nextId(tree, "I");
  let person = (tree.persons ?? []).find((p) => p && p.id === targetId);
  let created = false;
  const gender = normGender(op.gender);
  if (!person) {
    created = true;
    person = { id: targetId, gender: gender ?? "Unknown", names: [] };
    tree.persons = [...(tree.persons ?? []), person];
  } else if (gender && (person.gender === undefined || person.gender === "Unknown")) {
    // Never overwrite a resolved Male/Female — the persona arm's rule.
    person.gender = gender;
  }

  // Same upsert the persona arm's name assertions use: an equivalent name
  // already there unions the ref (so a re-run with the same personId is a
  // no-op), otherwise the name is minted carrying it.
  // No default name type here. A party named inside someone ELSE's assertion is
  // often named by a surname that is not her birth surname — "survived by his
  // wife Mary Smith" gives the husband's — so asserting BirthName would source a
  // claim to a record that never made it, which is the failure this tool exists
  // to prevent. The caller names the type when the record supports one (a bride
  // in a marriage register is giving her maiden name); otherwise the field is
  // omitted, which the tree schema allows and most of the corpus does.
  const { namesAdded, refsAttached } = upsertName(
    tree, person, given, surname, ref, str(op.nameType),
  );

  return {
    personId: targetId,
    created,
    factsAdded: 0,
    factsEnriched: 0,
    namesAdded,
    refsAttached,
    conflicts_surfaced: [],
  };
}

/** Route one batch/single op to its arm, rejecting a shape that names both or
 *  neither. Supplying `assertionId` alongside `recordId`/`recordRole` is
 *  ambiguous rather than additive — pick one, as `tree_edit` does for
 *  `sourceAssertionId` vs a literal ref. */
function applyOp(
  tree: SimplifiedGedcomX,
  research: any,
  op: MaterializeFactsAnyOp,
): MaterializeFactsOpResult {
  // A null/non-object op is a caller error, not a crash: destructuring it threw
  // a raw TypeError straight out of the tool, past every `{ ok: false }` path.
  if (op === null || typeof op !== "object" || Array.isArray(op)) {
    throw new MaterializeFactsError(
      `each op must be an object — got ${op === null ? "null" : Array.isArray(op) ? "an array" : typeof op}`,
    );
  }
  // `assertionId` present but not a string would fall through to the persona
  // arm and materialize silently, ignoring what the caller plainly intended.
  const rawAssertionId = (op as { assertionId?: unknown }).assertionId;
  if (rawAssertionId != null && typeof rawAssertionId !== "string") {
    throw new MaterializeFactsError(
      `assertionId must be a string — got ${rawAssertionId === null ? "null" : typeof rawAssertionId}`,
    );
  }
  const persona = op as MaterializeFactsOp;
  const hasPersona = str(persona.recordId) !== undefined || str(persona.recordRole) !== undefined;
  if (isNamedPartyOp(op)) {
    if (hasPersona) {
      throw new MaterializeFactsError(
        "supply `assertionId` (the named-party form) OR `recordId`+`recordRole` (the persona " +
          "form), not both",
      );
    }
    return applyNamedPartyOp(tree, research, op);
  }
  if (!hasPersona) {
    throw new MaterializeFactsError(
      "supply either `recordId` + `recordRole` (materialize a persona) or `assertionId` + " +
        "`relatedRole` + `name` (mint the party a relationship/marriage assertion names)",
    );
  }
  // A persona op carrying named-party-only fields is a half-formed named-party
  // call. The persona arm would ignore them silently and mint from the persona's
  // own name assertions, so the caller's `name` would vanish with no sign — and
  // if that persona has no name assertion, the failure surfaces as an unrelated
  // "no name assertion" error. Name the missing field instead.
  // `gender` is deliberately NOT in this list: it is generic enough that a
  // persona op carrying it is not evidently a half-formed named-party call, and
  // refusing it would reject a shape that worked before this arm existed. Null
  // counts as absent, because a model filling a flat optional schema writes
  // nulls, and refusing those turns a tolerated shape into a hard error.
  const strays = (["relatedRole", "name"] as const).filter(
    (k) => (op as Partial<MaterializeFactsNamedPartyOp>)[k] != null,
  );
  if (strays.length > 0) {
    throw new MaterializeFactsError(
      `named-party field(s) [${strays.join(", ")}] supplied without \`assertionId\` — a persona ` +
        "op mints from the persona's own name/gender assertions and would silently ignore them. " +
        "Add `assertionId` (the relationship/marriage assertion naming this party), or drop the " +
        "field(s) if you meant the persona form",
    );
  }
  return applyMaterializeOp(tree, research, persona);
}

// ─── the tool ─────────────────────────────────────────────────────────────────

export async function materializeFacts(
  input: MaterializeFactsInput,
): Promise<MaterializeFactsResult> {
  const { projectPath } = input;

  // Recover a batch `ops` array the model serialized as a JSON string (see
  // coerceJsonArg) before any shape checks — mirrors tree_edit/tree_correct,
  // and for the same reason: a large `ops` batch is exactly the size that
  // pushes a model toward stringifying it.
  input.ops = coerceJsonArg(input.ops) as MaterializeFactsAnyOp[] | undefined;
  // `name` is an object arg and gets the same treatment every sibling gives
  // theirs (research_append's entry/fields, tree_edit's fact, tree_forget's
  // forget). Without it a stringified `name` fails the non-empty check and the
  // caller is told the name was blank, which is the opposite of what happened.
  if (input.name !== undefined) {
    input.name = coerceJsonArg(input.name) as MaterializeFactsInput["name"];
  }
  if (Array.isArray(input.ops)) {
    for (const op of input.ops) {
      const o = op as { name?: unknown };
      if (o && typeof o === "object" && o.name !== undefined) o.name = coerceJsonArg(o.name);
    }
  }

  // Serialize the read-modify-write against every other writer on this project
  // (issue #1715) — this one writes tree.gedcomx.json, which research_append's
  // composite path also writes, so the same per-project lock covers both.
  return withProjectLock(projectPath, async () => {
  try {
    // Heal legacy tree shapes in memory, then read research.json (assertions
    // live there). Single-file write path — research.json is read, never written.
    const sanitized = sanitizeTree(await readJson(projectPath, "tree.gedcomx.json"));
    const tree = sanitized.tree;
    const research = await readJson(projectPath, "research.json");
    // Post-heal, pre-materialize snapshot (applyMaterializeOp mutates tree in
    // place): block only on errors THIS call introduces, not pre-existing drift
    // in a section it never touched (#1572).
    const beforeTree = structuredClone(tree);

    // ─── Batch form: apply every op in-memory, then validate + write once ────
    if (input.ops !== undefined) {
      if (!Array.isArray(input.ops) || input.ops.length === 0) {
        return { ok: false, errors: ["`ops` must be a non-empty array"] };
      }
      const results: MaterializeFactsOpResult[] = [];
      for (let i = 0; i < input.ops.length; i++) {
        try {
          results.push(applyOp(tree, research, input.ops[i]));
        } catch (e) {
          if (e instanceof MaterializeFactsError) {
            // Identify the failing op; nothing has been written.
            return { ok: false, errors: [`ops[${i}]: ${e.message}`] };
          }
          throw e;
        }
      }

      const validation = await validateIntroduced({ research, tree: beforeTree }, { research, tree }, { projectPath });
      if (!validation.valid) {
        return { ok: false, errors: formatIssues(validation.errors) };
      }
      await atomicWriteJson(projectPath, "tree.gedcomx.json", tree);
      return {
        ok: true,
        results,
        filesWritten: ["tree.gedcomx.json"],
        validation: {
          valid: true,
          warnings: [...sanitized.warnings, ...formatIssues(validation.warnings)],
        },
      };
    }

    // ─── Single-op form ──────────────────────────────────────────────────────
    // Both arms are reachable here; applyOp picks by shape and rejects an input
    // that names both forms or neither.
    const result = applyOp(
      tree,
      research,
      input.assertionId !== undefined
        ? {
            assertionId: input.assertionId,
            relatedRole: input.relatedRole!,
            name: input.name!,
            gender: input.gender,
            nameType: input.nameType,
            personId: input.personId,
            ...(input.recordId !== undefined ? { recordId: input.recordId } : {}),
            ...(input.recordRole !== undefined ? { recordRole: input.recordRole } : {}),
          } as MaterializeFactsAnyOp
        : ({
            personId: input.personId,
            recordId: input.recordId!,
            recordRole: input.recordRole!,
            // Passed through, NOT dropped: applyOp refuses a persona op carrying
            // named-party-only fields, and silently discarding them here would
            // make that guard fire in the batch form only.
            ...(input.relatedRole !== undefined ? { relatedRole: input.relatedRole } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.gender !== undefined ? { gender: input.gender } : {}),
          } as MaterializeFactsAnyOp),
    );

    const validation = await validateIntroduced({ research, tree: beforeTree }, { research, tree }, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }
    await atomicWriteJson(projectPath, "tree.gedcomx.json", tree);

    return {
      ok: true,
      ...result,
      filesWritten: ["tree.gedcomx.json"],
      validation: {
        valid: true,
        warnings: [...sanitized.warnings, ...formatIssues(validation.warnings)],
      },
    };
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult();
    if (e instanceof MaterializeFactsError) return { ok: false, errors: [e.message] };
    throw e;
  }
  });
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const materializeFactsSchema = {
  name: "materialize_facts",
  description:
    "Write a record persona's extracted assertions onto a tree person as SOURCED " +
    "facts and names. For a persona, pass REFERENCES only — { projectPath, personId, " +
    "recordId, recordRole } — and the tool reads the persona's assertions (every " +
    "assertion matching recordId + recordRole) from research.json, resolves each one's " +
    "provenance (assertion.source_id -> research source -> tree S-entry) into a " +
    "non-null source-ref, and writes only tree.gedcomx.json. You never hand-assemble " +
    "a document, so the provenance chain cannot be dropped. (There is a second form " +
    "below, for a party the record names WITHOUT giving it a persona: it takes one " +
    "piece of data, her name, because no reference to her exists. The provenance is " +
    "still resolved by the tool and still cannot be dropped.)\n" +
    "\n" +
    "Create-or-enrich: if personId names a person that does not exist yet, the tool " +
    "mints it from the persona's name/gender assertions, so the person is never " +
    "fact-less. Idempotent: re-running the same persona duplicates neither facts nor " +
    "refs. Agreeing values (compatible date/place, equal value) union their refs onto " +
    "one fact; an incompatible date/place OR a different value coexists as a separate " +
    "sourced fact. A competing value of a single-valued/vital type (Birth, Death, " +
    "Christening, Burial) is reported in conflicts_surfaced for conflict-resolution; " +
    "multi-valued types (Occupation, Residence, Census, …) coexist silently.\n" +
    "\n" +
    "materialize_facts NEVER sets primary/preferred (only proof-conclusion does), " +
    "never resolves conflicts, never writes relationships (use tree_edit " +
    "add_relationship), never writes research.json, and silently skips `marriage` " +
    "assertions (a Couple-relationship event — never a correct person-level fact; " +
    "put it on the Couple via tree_edit add_relationship's facts, sourced with the " +
    "same marriage assertion via sourceAssertionId). If a persona's source has no " +
    "tree S-entry, the call errors — materialize the record's source first (via " +
    "research_append's composite sourceDescription). Returns a compact summary " +
    "{ personId, created, factsAdded, factsEnriched, namesAdded, refsAttached, " +
    "conflicts_surfaced } — never an echo of the written tree.\n" +
    "\n" +
    "To materialize several personas at once (e.g. a whole household — the subject " +
    "plus siblings and a spouse from the same or different records), pass an `ops` " +
    "array instead of the top-level personId/recordId/recordRole: each op is " +
    "`{ personId?, recordId, recordRole }` (the same per-op fields). The tool applies " +
    "all ops to one in-memory tree, validates ONCE, and writes ONCE — all-or-nothing " +
    "(on any op's failure nothing is written and the error is `ops[i]: <msg>`). Ids " +
    "minted by an earlier op (e.g. a new person from create-or-enrich) are visible to " +
    "later ops. Returns `results: [{ personId, created, factsAdded, factsEnriched, " +
    "namesAdded, refsAttached, conflicts_surfaced }]`, one entry per op, in order.\n" +
    "\n" +
    "NAMED PARTY — for a person the record names only INSIDE another persona's " +
    "link-establishing assertion (`relationship`, `marriage`, `parentage` or " +
    "`parentchild`, case-insensitive): a bride named in the groom's marriage " +
    "register. She has no persona of her own to pass, or has one that carries " +
    "nothing this tool would write. Call " +
    "`{ projectPath, assertionId, relatedRole, name: { given, surname }, gender?, " +
    "personId? }` (or the same fields as an `ops` element) instead of " +
    "recordId/recordRole — supplying both forms in one op is rejected. You supply " +
    "her NAME because the assertion rarely carries it in machine-readable form; the " +
    "tool resolves the source-ref from that assertion's own source_id and REFUSES " +
    "the write if it cannot, so a record-derived person can never land without " +
    "provenance. `relatedRole` is the role of the party being minted (\"bride\", " +
    "\"mother\") and should name someone who has NO persona on that record: if the " +
    "record has a persona with that record_role AND it could be materialized instead, " +
    "the call is refused and names the { recordId, recordRole } to use, because that " +
    "form writes her facts too. A negative-evidence " +
    "assertion (what the source does NOT say) is refused too — it cannot mint anyone. " +
    "Pass nameType only when the record settles whether the surname is her own or " +
    "a married one; omitted means no claim, which is preferable to a wrong one. This " +
    "writes a SOURCED NAME and the gender scalar only: no facts, no relationship. " +
    "The marriage event still belongs on the Couple via tree_edit " +
    "add_relationship, and the edge itself via add_relationship's " +
    "sourceAssertionId. Unlike tree_edit add_person, whose name path is " +
    "ref-tolerant, this arm cannot leave her without a source, which is why it is " +
    "the correct mint for a person the record names.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the project directory holding tree.gedcomx.json and research.json.",
      },
      personId: {
        type: "string",
        description:
          "Target tree person id. May name a person that does not exist yet — the tool mints it " +
          "from the persona's name/gender assertions (create-or-enrich). Omit to mint a brand-new " +
          "person with the next allocated I id. Ignored when `ops` is present.",
      },
      recordId: {
        type: "string",
        description:
          "The record the persona belongs to (matches assertion.record_id). Ignored when `ops` " +
          "is present.",
      },
      recordRole: {
        type: "string",
        description:
          "The persona's role on that record (matches assertion.record_role). Ignored when `ops` " +
          "is present.",
      },
      assertionId: {
        type: "string",
        description:
          "NAMED-PARTY form: the assertion that NAMES a party who has no persona of her own " +
          "(the bride in the groom's marriage register). Any type that establishes a link " +
          "between two parties: relationship, marriage, parentage or parentchild, matched " +
          "case-insensitively. Selects " +
          "this form; supply it INSTEAD of recordId/recordRole, never alongside. The tool " +
          "resolves this assertion's source-ref and refuses the write without it.",
      },
      relatedRole: {
        type: "string",
        description:
          "NAMED-PARTY form: the role of the party being minted — the one that is NOT the " +
          "persona (\"bride\", \"mother\", \"father\"). Use the record's own spelling where it " +
          "has one. If the record has a persona with this record_role that could be " +
          "materialized instead, the call is refused and tells you the recordId/recordRole to " +
          "use, because that form writes her facts too.",
      },
      name: {
        type: "object",
        description:
          "NAMED-PARTY form: the name the record gives this party. At least one of given/" +
          "surname must be non-empty. You supply it because the assertion rarely carries it " +
          "in machine-readable form; the tool supplies and enforces the source-ref.",
        properties: {
          given: { type: "string" },
          surname: { type: "string" },
        },
      },
      gender: {
        type: "string",
        description:
          "NAMED-PARTY form, optional: Male/Female/Unknown for the minted person. Fills an " +
          "absent or Unknown gender only — never overwrites a resolved one.",
      },
      nameType: {
        type: "string",
        description:
          "NAMED-PARTY form, optional: the name's type — \"BirthName\" when the record gives " +
          "her own/maiden surname (a bride in a marriage register), \"MarriedName\" when it " +
          "gives a married one (\"survived by his wife Mary Smith\" gives the husband's " +
          "surname). OMIT IT when the record does not settle which; the field is optional and " +
          "no type is a smaller claim than the wrong type.",
      },
      ops: {
        type: "array",
        description:
          "Batch form: apply many ops in one validate-once/write-once call (all-or-nothing). " +
          "When present, the top-level per-op fields are ignored. Each op is either the " +
          "persona form `{ personId?, recordId, recordRole }` or the named-party form " +
          "`{ assertionId, relatedRole, name, gender?, personId? }`; the two may be mixed in " +
          "one batch, but not merged into one op.",
        items: {
          type: "object",
          properties: {
            personId: { type: "string" },
            recordId: { type: "string" },
            recordRole: { type: "string" },
            assertionId: { type: "string" },
            relatedRole: { type: "string" },
            name: {
              type: "object",
              properties: {
                given: { type: "string" },
                surname: { type: "string" },
              },
            },
            gender: { type: "string" },
            nameType: { type: "string" },
          },
        },
      },
    },
    required: ["projectPath"],
  },
};
