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
// NAMED-PARTY arm ({ projectPath, assertionId, relatedRole, name, gender?,
//   nameType?, personId? }) —
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

import {
  ASSERTION_FACT_ATTRS,
  COUPLE_EVENT_TYPES,
  EVENT_TREE_TYPES,
  GENDER_TYPES,
  NAME_TYPES,
  SKIP_TYPES,
  assertionFactAttr,
  assertionTreeFactType,
  candAsFact,
  factCandidate,
  factText,
  materializesToPersonFact,
  nameParts,
  normGender,
  toTreeFactType,
  type AssertionFactAttr,
  type FactCandidate,
} from "../utils/record-persona.js";
// The assertion → tree-fact mapping and the name/gender normalisers were lifted
// verbatim into utils/record-persona.ts (lead ruling 2026-09-11, issue #1731) so
// `same_person`'s project-relative arm can project a record persona with the
// same rules.

class MaterializeFactsError extends Error {}

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

const str = factText;

/** Normalize a comparison key for a name part (case/space-insensitive). */
function normNamePart(v: string | undefined): string {
  return (v ?? "").trim().toLowerCase();
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
  /** Fact ids that existed before the whole OP, when an op runs this more than
   *  once (the named-party arm's fact pass, one call per role spelling).
   *  Without it each pass snapshots its own "before", so pass 2 counts pass 1's
   *  brand-new fact as pre-existing and reports it `factsEnriched` on a person
   *  the same op created — which the count's own definition ("existed BEFORE
   *  this op") says is impossible. */
  preExistingFactIds?: ReadonlySet<string>,
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
  const preFactIds = preExistingFactIds ?? new Set((person.facts ?? []).map((f) => f.id));
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
// her; or the persona that role does have is never named by the record, so the
// arm refuses to mint from it. Before this arm either shape could only be
// written by `tree_edit add_person`, whose name path is ref-tolerant, so a
// record-derived person landed with NO provenance (the leak
// tree-materialization-spec §6 names).
//
// Writes a sourced NAME plus the gender scalar, and, where that role has a
// persona the record never names AND the assertion's `related_person_role`
// corroborates the role, that persona's own facts. Never a relationship edge. §4.5 therefore still holds in full — a `marriage`
// assertion never becomes a person-level fact, because the second pass runs
// through the persona arm and `SKIP_TYPES` drops it there exactly as it would
// on any other persona; only the party it names becomes a sourced name, and the
// Couple event stays on the edge.
//
// The ref is enforced, the name is not: the tool cannot know the name the
// record gives (8 of 167 corpus relationship/marriage assertions carry it in
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

  // Both of the next two checks turn on the role's OWN personas, not the
  // assertion's. Measured over eval/**/research.json: the role named by a
  // relationship/marriage assertion already has its own persona on the same
  // record in 93 of 167 cases (55.7%), so this is the common path, not an edge
  // case, and comparing only against the assertion's own record_role would miss
  // every one of them. A party whose persona can name itself belongs to the
  // persona arm and is refused below; a party whose persona cannot is minted
  // here and then handed to the persona arm for its facts, so that neither
  // route ends in the name-only shell tree-materialization-spec §1.1 (1)
  // exists to cure.
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
  // this whole arm exists to remove. Measured over eval/**/research.json: 90
  // personas carry no positive `name` assertion, and 61 of those 90 also carry
  // a fact this tool would materialize (the largest shape is
  // [birth, death, relationship], 34 of them). Those 61 are why the pass below
  // exists: letting them through here without it would drop the very facts the
  // record does state about them.
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
  // in a FIRST marriage is giving her maiden name; a remarrying widow is giving
  // her late husband's, and a register rarely says which); otherwise the field is
  // omitted, which the tree schema allows and most of the corpus does.
  const { namesAdded, refsAttached } = upsertName(
    tree, person, given, surname, ref, str(op.nameType),
  );

  // Reaching here WITH siblings means the role has a persona on this record
  // that could not mint her: the refusal above fires only when a sibling
  // carries a non-negative `name` assertion, so what is left is a nameless
  // persona (the live shape is a `bride` of [birth, marriage]). Minting her
  // name and stopping would leave exactly the name-only shell §1.1 (1) exists
  // to cure, with her sourced facts dropped: the 1839 birth has no other route
  // into the tree, because the persona arm refuses her for want of a name and
  // this arm is the only one that will take her.
  //
  // So write them by BEING the persona arm rather than restating it. It
  // enriches instead of minting now that she exists, and by construction there
  // is no positive `name` assertion among the siblings for it to double-write.
  // A ref it cannot resolve throws, which aborts the whole op before anything
  // is persisted — provenance first (§4.2 step 2), the same rule as everywhere
  // else here, rather than a half-provenanced person.
  // ONE PASS PER DISTINCT RAW SPELLING, not one for `siblings[0]`. `siblings`
  // was selected through `normNamePart`, so it can span spellings that
  // normalize equal (`Bride` and `bride`, or a trailing space), while the
  // persona arm filters with exact `a.record_role === recordRole`. Driving it
  // from a single spelling therefore hands it a SUBSET of the personas this
  // guard just matched, and the rest are dropped with no error and no count:
  // a bride of `Bride`[birth 1839] + `bride`[death 1901] wrote the birth,
  // returned factsAdded 1, and lost the death. Which fact survived was array
  // order. Latent rather than live (no record in the corpus carries two
  // spellings that normalize equal today, though 10 of 10,341 assertions
  // already break the schema's own `^[a-z][a-z0-9_]*$` pattern, which
  // `validate_research_schema` does not enforce) — but the fix is a loop, and
  // a silent partial write under an enforced ref is the exact failure class
  // this tool exists to refuse.
  //
  // CORROBORATED ONLY. `relatedRole` is caller-supplied free text and is never
  // persisted, so a wrong one that happens to name a REAL other role on this
  // record selects a real persona — a different individual's. Writing a name
  // under that mistake mints a duplicate, which is bad and was the pre-existing
  // risk the spec accepted ("a miss degrades to exactly the behaviour this arm
  // would have had without the guard"). Writing that individual's FACTS under
  // it is categorically worse and breaks that acceptance: it attaches one
  // person's birth and death to another's name, each carrying a genuine
  // resolved ref, so the misattribution looks provenanced. Executed: a
  // `testator` parentage assertion naming a daughter, with `relatedRole:
  // "heir"` where `heir` is a real male persona of [birth 1802, death 1871],
  // wrote Ann Weller carrying both, refsAttached 3, conflicts_surfaced [].
  // That is the same objection this file already makes about splitting a
  // multi-token `given` (line ~634: "fabricates a surname — under an enforced
  // ref, which makes the fabrication look provenanced").
  //
  // So the fact pass runs ONLY where the assertion itself corroborates the
  // role: `structured_value.related_person_role` present and normalizing equal
  // to `relatedRole`. 146 of 167 corpus relationship/marriage assertions carry
  // that key, so corroboration is the common case, not a rare one. Without it
  // the arm does what it did before — a sourced name and nothing else — which
  // is the conservative direction: a missing fact is recoverable by a later
  // persona-arm call, a fact on the wrong person is not.
  const sv = assertion.structured_value;
  const namedRole =
    sv && typeof sv === "object" && !Array.isArray(sv)
      ? str((sv as Record<string, unknown>).related_person_role)
      : undefined;
  const corroborated = namedRole !== undefined && normNamePart(namedRole) === wanted;

  let factsAdded = 0;
  let factsEnriched = 0;
  const conflicts: MaterializeFactsOpResult["conflicts_surfaced"] = [];
  let extraNames = 0;
  let extraRefs = 0;
  const spellings: string[] = [];
  for (const a of corroborated ? siblings : []) {
    const raw = String(a.record_role ?? "");
    if (!spellings.includes(raw)) spellings.push(raw);
  }
  // Snapshotted ONCE, before the first pass, and handed to every pass: see the
  // `preExistingFactIds` docstring. Without it a two-spelling role reported
  // `{created: true, factsAdded: 1, factsEnriched: 1}` for one fact on a person
  // that had none before the call.
  const preOpFactIds: ReadonlySet<string> = new Set(
    (person.facts ?? []).map((f) => f.id).filter((id): id is string => id !== undefined),
  );
  for (const spelling of spellings) {
    const pass = applyMaterializeOp(
      tree,
      research,
      { personId: targetId, recordId: String(recordId), recordRole: spelling },
      preOpFactIds,
    );
    factsAdded += pass.factsAdded;
    factsEnriched += pass.factsEnriched;
    extraNames += pass.namesAdded;
    extraRefs += pass.refsAttached;
    conflicts.push(...pass.conflicts_surfaced);
  }

  return {
    personId: targetId,
    created,
    factsAdded,
    factsEnriched,
    namesAdded: namesAdded + extraNames,
    refsAttached: refsAttached + extraRefs,
    conflicts_surfaced: conflicts,
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
    "\"mother\") and should name someone the record does not NAME through a persona: " +
    "if the record has a persona with that record_role carrying a name assertion, the " +
    "call is refused and names the { recordId, recordRole } to use, because that form " +
    "writes her facts too. A negative-evidence " +
    "assertion (what the source does NOT say) is refused too — it cannot mint anyone. " +
    "Pass nameType only when the record settles whether the surname is her own or " +
    "a married one; omitted means no claim, which is preferable to a wrong one. This " +
    "writes a SOURCED NAME and the gender scalar. Where that role does have a persona " +
    "the record never names, that persona's facts are written too in the same call, but " +
    "ONLY when the assertion's structured_value.related_person_role names that same role: " +
    "relatedRole is free text this tool cannot otherwise check, and a wrong one that happens " +
    "to name a real OTHER role would attach that individual's facts to this name under a " +
    "genuine ref. factsAdded: 0 does NOT single out that case: it is also what you get when the " +
    "role has no persona at all (the arm's canonical shape), when its persona carries nothing " +
    "writable, and on a repeat call. The reply carries no corroboration flag, so do not infer " +
    "one from a count. " +
    "Your `gender` WINS over the persona's own gender/sex assertions when you supply one; " +
    "omit it to take the record's. Never a relationship. " +
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
          "her own/maiden surname (a bride in a FIRST marriage; a remarrying widow is " +
          "giving her late husband's surname, so omit the type unless the register " +
          "settles it), \"MarriedName\" when it " +
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
          "`{ assertionId, relatedRole, name, gender?, nameType?, personId? }`; the two may be mixed in " +
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
