// tree_edit — single-entity ad-hoc mutations of tree.gedcomx.json.
//
// The sibling of the merge tools: where those collapse persons, this one does
// the add/correct/remove edits the tree-edit skill performs by hand today. It
// reuses the shipped write layer (atomicWriteJson, validateIntroduced)
// and the shared id allocator, so the LLM passes only the content judgment and
// the tool does id assignment, the primary/preferred swaps, standard_place
// resolution, validate-before-persist, and the atomic write. Writes only
// tree.gedcomx.json. Spec: docs/specs/tree-edit-tool-spec.md.
//
// The op set is split across two advertised tools sharing this core
// (spec § "The tree_edit / tree_correct split"): `tree_edit` accepts only the
// ADDITIVE ops (add_*), while `tree_correct` (src/tools/tree-correct.ts)
// accepts only the CORRECTION/REMOVAL ops (update_*, remove). The split makes
// write authority allowlist-enforceable: an extraction context granted only
// tree_edit is structurally unable to rewrite identity (the ut_013 rename
// incident), instead of merely prose-forbidden from it.

import type {
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedName,
  SimplifiedFact,
  SimplifiedRelationship,
  SimplifiedSourceDescription,
  SimplifiedSourceReference,
} from "../types/gedcomx.js";
import { validateIntroduced } from "../validation/introduced-errors.js";
import {
  introducedWarnings,
  staleJustifications,
  computeTouchedPersonIds,
  findCompetingParentage,
  parentChildKey,
  type WarningJustificationInput,
} from "../validation/introduced-warnings.js";
import { dedupSourceRefs, relationshipMatches } from "../utils/merge-gedcomx.js";
import type { ConflictSurfaced } from "../types/materialize-facts.js";
import { getPersonName } from "./person-warnings.js";
import { isCoupleEventFactType } from "../utils/record-persona.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import {
  atomicWriteJson,
  atomicWriteBoth,
  readProjectJson,
  formatIssues,
  withProjectLock,
  NoProjectError,
  noProjectResult,
} from "../utils/project-io.js";
import { maxIdNum, nextId } from "../utils/gedcomx-ids.js";
import { resolveStandardPlace, countryConsistency } from "../utils/place-resolver.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import { resolveSourceRef, isRelationshipEstablishing } from "../utils/source-ref-resolver.js";

export type TreeEditOperation =
  | "add_fact"
  | "update_fact"
  | "add_name"
  | "update_name"
  | "update_person"
  | "add_person"
  | "add_relationship"
  | "add_source"
  | "update_source"
  | "update_relationship"
  | "remove";

/** The additive ops — the only operations `tree_edit` accepts. */
export const ADD_OPERATIONS = [
  "add_fact",
  "add_name",
  "add_person",
  "add_relationship",
  "add_source",
] as const;

/** The correction/removal ops — the only operations `tree_correct` accepts. */
export const CORRECT_OPERATIONS = [
  "update_fact",
  "update_name",
  "update_person",
  "update_source",
  "update_relationship",
  "remove",
] as const;

const ALL_OPERATIONS: ReadonlySet<string> = new Set([...ADD_OPERATIONS, ...CORRECT_OPERATIONS]);

/** Which ops the calling tool admits, and how to phrase a cross-tool redirect. */
export interface OpGate {
  allowed: ReadonlySet<string>;
  rejection: (operation: string) => string;
}

const EDIT_GATE: OpGate = {
  allowed: new Set<string>(ADD_OPERATIONS),
  rejection: (operation) =>
    `tree_edit only adds — '${operation}' is a correction/removal op; ` +
    "corrections and removals live in tree_correct",
};

/** One edit. The body of a single call, or one element of a batch `ops`. */
export interface TreeEditOp {
  operation: TreeEditOperation;
  personId?: string;
  factId?: string;
  nameId?: string;
  relationshipId?: string;
  sourceId?: string;
  fact?: SimplifiedFact;
  name?: SimplifiedName;
  person?: SimplifiedPerson;
  relationship?: SimplifiedRelationship;
  source?: SimplifiedSourceDescription;
  gender?: string;
  ark?: string;
  /** update_relationship only: the edge's new subtype (e.g. "Biological",
   *  "Step"). The type is its own claim and an edge can be retyped — a census
   *  or an import lists a stepchild as "son" (plan Decision 11). */
  subtype?: string;
  /** Auto-resolve standard_place when a place is set (default true). */
  resolveStandardPlace?: boolean;
  /** add_relationship only: resolve the edge's (and any inline Couple fact's)
   *  source-ref from this research.json assertion — a `relationship` or
   *  `marriage` type (RELATIONSHIP_ESTABLISHING_TYPES) — instead of supplying a
   *  literal `relationship.sources`; mirrors materialize_facts's resolver
   *  (tree-materialization-spec §8). Mutually exclusive with a literal ref on
   *  `relationship`. */
  sourceAssertionId?: string;
}

export interface TreeEditInput extends Partial<TreeEditOp> {
  projectPath: string;
  // Batch form — supply ops; when present the single-op fields above are ignored.
  // Every op applies to one in-memory tree; the tool validates once and writes
  // once (all-or-nothing). Ids assigned earlier in the batch are visible to
  // later ops (the allocator rescans the live tree).
  ops?: TreeEditOp[];
  // Justifications for genealogical warnings this write introduces (issue #2840).
  // If the write introduces warnings and this is absent or incomplete, the tool
  // refuses with { ok: false, reason: "unjustified_warnings", warnings: [...] }.
  warningJustifications?: Array<{ warningId: string; justification: string }>;
}

interface AssignedIds {
  person?: string;
  fact?: string;
  name?: string;
  relationship?: string;
  source?: string;
  names?: string[];
  facts?: string[];
}

interface PerOpResult {
  operation: TreeEditOperation;
  assignedIds?: AssignedIds;
}

export type TreeEditResult =
  | ({
      ok: true;
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
      conflicts_surfaced?: ConflictSurfaced[];
    } & PerOpResult)
  | {
      ok: true;
      results: PerOpResult[];
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
      conflicts_surfaced?: ConflictSurfaced[];
    }
  // `reason: "no_project"` marks the one ok:false that is an answer rather than
  // a failure (see noProjectResult). Optional field on the existing arm, NOT a
  // third arm — every `if (!r.ok) r.errors…` keeps narrowing as it does today.
  // The warning gate's refusal rides this same arm (see WarningGateRefusal).
  | ({ ok: false; errors: string[]; reason?: "no_project" | "unjustified_warnings" } &
      Partial<Pick<WarningGateRefusal, "message" | "warnings" | "conflicts_surfaced">>);

/** One warning a gated write introduced, as the refusal reports it. */
export interface GateWarning {
  warningId?: string;
  issueType?: string;
  severity?: string;
  personId?: string;
  personName?: string;
  message: string;
  facts?: unknown;
  relatedPersonId?: string;
}

/** The warning gate's refusal, shared by every gated writer. `errors` carries
 *  the same text as `message`, so a caller that reads `errors` sees it. */
export interface WarningGateRefusal {
  ok: false;
  reason: "unjustified_warnings";
  errors: string[];
  message?: string;
  warnings: GateWarning[];
  /** Competing biological parentage the refused write would create (#2525). */
  conflicts_surfaced?: ConflictSurfaced[];
}

/** What the gate hands back when the write may proceed. */
export interface WarningGatePass {
  justificationsPersisted: boolean;
}

const ROUTE_PARENTAGE =
  "This write gives a child a second biological parent of one sex. That is not a warning to " +
  "justify, and warningJustifications cannot pass it. If one of these parents is a step, " +
  "adoptive, foster or guardian parent, add that edge with its subtype instead. Otherwise send " +
  "each conflicts_surfaced entry to conflict-resolution as an identity question, and do not " +
  "write this edge until it is resolved.";

const JUSTIFY_OTHERS =
  " Justify every other warningId: re-call with warningJustifications listing each warningId " +
  "and a justification string.";

class TreeEditError extends Error {}

/** Reject an operation the calling tool does not admit (redirecting to the
 *  sibling tool when the op exists there), before anything is applied. */
function gateOperation(operation: string | undefined, gate: OpGate): void {
  if (!operation || gate.allowed.has(operation)) return;
  if (ALL_OPERATIONS.has(operation)) throw new TreeEditError(gate.rejection(operation));
  throw new TreeEditError(`unknown operation '${operation}'`);
}

async function readJson(projectPath: string, filename: string): Promise<any> {
  try {
    return await readProjectJson(projectPath, filename);
  } catch (e) {
    // NoProjectError is an ANSWER, not a failure — re-raised unchanged so the
    // outer catch can return noProjectResult().
    if (e instanceof NoProjectError) throw e;
    throw new TreeEditError(e instanceof Error ? e.message : String(e));
  }
}

/** Resolve `sourceAssertionId` into a source-ref, wrapped so a missing
 *  provenance hop surfaces as a TreeEditError (see utils/source-ref-resolver.ts
 *  for the shared walk, also used by materialize_facts). */
function resolveRelationshipRef(
  assertion: any,
  research: any,
  tree: SimplifiedGedcomX,
): SimplifiedSourceReference {
  try {
    return resolveSourceRef(assertion, research, tree);
  } catch (e) {
    throw new TreeEditError((e as Error).message);
  }
}

function requirePerson(tree: SimplifiedGedcomX, personId: string | undefined): SimplifiedPerson {
  if (!personId) throw new TreeEditError("personId is required for this operation");
  const p = (tree.persons ?? []).find((x) => x.id === personId);
  if (!p) throw new TreeEditError(`person '${personId}' not found in tree`);
  return p;
}

/** Anything that holds a `facts` array: a person or a Couple relationship. */
type FactHolder = SimplifiedPerson | SimplifiedRelationship;

/**
 * A couple event belongs on the Couple relationship's `facts[]`, never on a
 * person — `tree_edit`'s own convention ("a Marriage/Divorce fact lives on the
 * Couple, never duplicated onto each spouse"). Writing one onto a person leaves
 * the Couple edge factless, which is the shape the materialize-facts skip
 * already refuses to create on the extraction side.
 *
 * Matched with `isCoupleEventFactType`, so every spelling it lists is caught —
 * `marriage_banns`, `MarriageLicense` and `Marriage Intention` alike — rather
 * than only the exact strings someone happened to list here.
 */
function refuseCoupleEventOnPerson(type: unknown, op: string): void {
  if (!isCoupleEventFactType(type)) return;
  throw new TreeEditError(
    `${op}: '${String(type)}' is a couple event and belongs on the Couple relationship, ` +
      "not on a person. Add it with `add_relationship` carrying the fact inline, or with " +
      "`add_fact` naming the Couple edge in `relationshipId`",
  );
}

/**
 * Resolve the target of add_fact/update_fact: exactly one of `personId` or
 * `relationshipId`. Facts on relationships are legal only on Couples
 * (Marriage, Divorce, …) — the tree schema rejects `facts` on ParentChild.
 */
function requireFactHolder(tree: SimplifiedGedcomX, input: TreeEditInput, op: string): FactHolder {
  const targets = [input.personId, input.relationshipId].filter(Boolean);
  if (targets.length !== 1) {
    throw new TreeEditError(`${op} requires exactly one of \`personId\` or \`relationshipId\``);
  }
  if (input.personId) return requirePerson(tree, input.personId);
  const rel = (tree.relationships ?? []).find((r) => r.id === input.relationshipId);
  if (!rel) throw new TreeEditError(`relationship '${input.relationshipId}' not found in tree`);
  if (rel.type !== "Couple") {
    throw new TreeEditError(
      `facts live only on Couple relationships — '${input.relationshipId}' is ` +
        `${rel.type ?? "untyped"}; put person facts on the person instead`,
    );
  }
  return rel;
}

/**
 * Reject a fact payload whose scalar fields are not the flat strings the
 * simplified-GedcomX format requires (simplified-gedcomx-spec.md §4.1, §4.5) — most
 * commonly a raw-GedcomX nested `date: { original, formal }` object, which
 * would otherwise surface as an opaque whole-project validation error (or,
 * historically, crash downstream date parsing). Checked on every fact write
 * path so the error names the op and the expected shape.
 */
const FACT_STRING_FIELDS = ["date", "standard_date", "place", "standard_place", "value"] as const;
/** The fields whose change detaches a fact from the assertion it was minted
 *  from. `type` rides along with the strings because a RE-CLASSIFICATION is the
 *  strongest correction a researcher can make: it changes what the fact claims,
 *  and it also moves the fact across the event / value-bearing line that decides
 *  whether an assertion's `value` may be written to it at all. Left attached, a
 *  retyped fact and its assertion disagree about their own type, and the
 *  disagreement is unreachable by any later correction. */
const FACT_DETACH_FIELDS = [...FACT_STRING_FIELDS, "type"] as const;
function requireFactShape(fact: SimplifiedFact, op: string): void {
  // `primary` carries an instruction, so a near-miss spelling must not be
  // assigned and left for the document validator: its message is "omit it
  // rather than setting false", which is the one action that leaves a stale
  // flag exactly where it was. Caught here because every fact path calls this.
  const flag = (fact as Record<string, unknown>).primary;
  if (flag !== undefined && typeof flag !== "boolean") {
    const got = flag === null ? "null" : Array.isArray(flag) ? "an array" : `a ${typeof flag}`;
    throw new TreeEditError(
      `${op}: fact \`primary\` must be the boolean true or false, got ${got} — ` +
        "`true` makes it the primary of its type, `false` clears the flag",
    );
  }
  // The assertion backlink is stamped by `materialize_facts`, never supplied
  // (#2472). Admitting `assertion_id` to TREE_FACT_FIELDS also made it
  // caller-settable here — `fact` is a freeform object and every key is assigned
  // straight onto the fact — so without this a caller could forge a link the
  // spec says is set once and never inferred, and `research_append` would then
  // silently rewrite that hand-entered fact from an assertion it never came from.
  if ((fact as Record<string, unknown>).assertion_id !== undefined) {
    throw new TreeEditError(
      `${op}: fact \`assertion_id\` is not settable — it is the backlink ` +
        "`materialize_facts` stamps on a fact it mints from an assertion, and it is " +
        "never supplied by a caller. Materialize the assertion instead, or omit the field.",
    );
  }
  for (const field of FACT_STRING_FIELDS) {
    const v = (fact as Record<string, unknown>)[field];
    if (v !== undefined && typeof v !== "string") {
      const got = v === null ? "null" : Array.isArray(v) ? "an array" : `a ${typeof v}`;
      throw new TreeEditError(
        `${op}: fact \`${field}\` must be a plain string (e.g. date: "2 October 1876", ` +
          `place: "Schuylkill County, Pennsylvania"), got ${got} — simplified-GedcomX facts ` +
          `use flat string fields, not nested GedcomX objects like { original, formal }`,
      );
    }
  }
}

/**
 * `primary: false` is an INSTRUCTION, never a stored value. The persisted schema
 * pins the flag to `const: true` (omit-when-false, for token count —
 * simplified-gedcomx-spec §6), so the key is dropped before the write and the
 * document stays conformant. See clearPrimaryOfType's note.
 *
 * Every path that authors a NEW fact calls this. `update_fact` does not: it
 * deletes the flag from the EXISTING fact rather than from the incoming patch.
 */
function stripClearedPrimary(fact: SimplifiedFact): void {
  if (fact.primary === false) delete fact.primary;
}

// ─── delta-scoped mandatory-ref guard (tree-materialization-spec §6, §8) ─────
//
// A fact/name/relationship-edge a writer NEWLY AUTHORS must record where it came
// from — a non-null source-ref. The guard is per-op and DELTA-scoped: it fires
// only on content the op introduces, never on a pre-existing (legacy) ref-less
// node merely carried through. It is deliberately NOT a rule in the shared
// validateGedcomx / checkTreeFact (a whole-tree required-`sources` rule would
// brick every legacy ref-less project's next write and the merge_tree_persons
// fold); the schema keeps `sources` optional and the validator stays tolerant so
// legacy projects load. We do not fabricate/backfill refs for legacy content.

/** True when the node carries at least one non-null, non-empty source-ref. */
function hasNonNullRef(node: { sources?: SimplifiedSourceReference[] }): boolean {
  return (
    Array.isArray(node.sources) &&
    node.sources.some((s) => s && typeof s.ref === "string" && s.ref !== "")
  );
}

/** Reject a newly-authored node (fact/name/edge) that carries no non-null
 *  source-ref. Fires only on content the op introduces (§6, delta-scoped). */
function assertNodeHasRef(
  node: { sources?: SimplifiedSourceReference[] },
  what: string,
  op: string,
): void {
  if (!hasNonNullRef(node)) {
    throw new TreeEditError(
      `${op}: ${what} must carry a non-null source-ref (e.g. sources: [{ ref: "S1" }]) — ` +
        "newly-authored tree content records its provenance (tree-materialization-spec §6). " +
        "Supply the source-ref that resolves the assertion's source_id (its tree S-entry id), " +
        "or use materialize_facts to write a record persona's sourced facts.",
    );
  }
}

/** Remove the `primary` flag from the holder's other facts of the same type.
 *
 *  Fires only as a side effect of designating a REPLACEMENT primary, so it can
 *  move the flag but never retire it. Clearing without a replacement is
 *  `primary: false` on add_fact/update_fact, which is the state a newly-surfaced
 *  conflict needs: `materialize_facts` never sets `primary` and surfaces a
 *  conflict when a second vital fact lands, so a pre-existing flag would
 *  otherwise keep asserting a concluded value the evidence no longer supports
 *  (10 such persons across the committed e2e final trees, 2026-09-10). */
function clearPrimaryOfType(holder: FactHolder, type: string | undefined, exceptId: string | undefined): void {
  for (const f of holder.facts ?? []) {
    if (f.id !== exceptId && f.type === type && "primary" in f) delete f.primary;
  }
}

/**
 * Is this the same fact already recorded, rather than a second one?
 *
 * Strict equality on type, date, place and value — deliberately NOT
 * `factsEquivalent` from merge-gedcomx, which is a *compatibility* test: it
 * treats an absent date as matching any date, and one day-range containing
 * another as one fact. That is right for merging two documents and wrong here,
 * where folding a dated Marriage into an undated one would silently discard
 * the date the new record supplied (plan Decision 31 on the same helpers:
 * `compatibleDate`/`compatiblePlace` "treated 5 of 10 labelled
 * affirmed-and-ruled-out pairs as one object").
 *
 * Compares the four fields the plan names — type, date, place and value — and
 * deliberately NOT `standard_place`. The twin lookup runs before
 * `maybeResolvePlace`, so the stored fact carries a resolved `standard_place`
 * while the incoming one carries none: comparing it made a retried call whose
 * fact had a resolvable place write a SECOND fact, which is the opposite of the
 * idempotence corroboration exists for. `standard_date` is dropped with it —
 * caller-supplied, and the raw `date` already carries the claim.
 */
function sameFactValue(a: SimplifiedFact, b: SimplifiedFact): boolean {
  return (
    a.type === b.type &&
    a.date === b.date &&
    a.place === b.place &&
    a.value === b.value
  );
}

/** Remove the `preferred` flag from the person's other names. */
function clearPreferred(person: SimplifiedPerson, exceptId: string | undefined): void {
  for (const n of person.names ?? []) {
    if (n.id !== exceptId && "preferred" in n) delete n.preferred;
  }
}

interface AppliedOperation {
  assignedIds: AssignedIds;
  warnings: string[];
}

async function applyOperation(
  tree: SimplifiedGedcomX,
  research: any,
  input: TreeEditInput,
): Promise<AppliedOperation> {
  const assignedIds: AssignedIds = {};
  const warnings: string[] = [];
  const wantResolve = input.resolveStandardPlace !== false;

  // Resolve a fact's standard_place in place when it has a place and no explicit
  // standard_place; best-effort — never fail the edit on a resolution miss.
  // `siblings` are the other facts on the same holder: a bare place
  // ("Shenandoah") is resolved against their places, not the whole world.
  const maybeResolvePlace = async (
    fact: SimplifiedFact,
    explicitStandardPlace: boolean,
    siblings: SimplifiedFact[] = [],
  ): Promise<void> => {
    if (wantResolve && fact.place && !explicitStandardPlace) {
      const contextPlaces = siblings
        .map((f) => f.place)
        .filter((p): p is string => typeof p === "string" && p !== fact.place);
      try {
        fact.standard_place = (await resolveStandardPlace(fact.place, { contextPlaces })) ?? undefined;
        if (fact.standard_place === undefined) delete fact.standard_place;
      } catch {
        delete fact.standard_place;
        warnings.push(`could not resolve standard_place for '${fact.place}' (left unset)`);
      }
    }

    // Country-contradiction guard on whatever standard_place ends up set —
    // supplied explicitly by the caller OR auto-resolved just above. Mirrors
    // research_append's countryConsistency guard on assertions (see
    // place-resolver.ts). tree_edit never fails an edit on a place-resolution
    // problem (see docs/specs/tree-edit-tool-spec.md), so a contradiction is
    // nulled + warned here rather than thrown.
    if (typeof fact.place === "string" && typeof fact.standard_place === "string") {
      if (countryConsistency(fact.place, fact.standard_place) === "contradiction") {
        warnings.push(
          `standard_place '${fact.standard_place}' contradicts place '${fact.place}' — the place text ` +
            "names a different country; cleared (left unset)",
        );
        delete fact.standard_place;
      }
    }
  };

  switch (input.operation) {
    case "add_fact": {
      // Target is a person OR an existing Couple relationship (a Marriage
      // fact lives on the Couple, not duplicated onto each spouse).
      const holder = requireFactHolder(tree, input, "add_fact");
      if (!input.fact) throw new TreeEditError("add_fact requires a `fact`");
      // Only when the target is a PERSON: the same fact on a Couple edge is
      // exactly where it belongs.
      if (input.personId) refuseCoupleEventOnPerson(input.fact.type, "add_fact");
      if (input.fact.id) throw new TreeEditError("add_fact `fact` must not carry an id — the tool assigns it");
      requireFactShape(input.fact, "add_fact");
      const fact: SimplifiedFact = { ...input.fact, id: nextId(tree, "F") };
      stripClearedPrimary(fact);
      assertNodeHasRef(fact, "the added fact", "add_fact");
      await maybeResolvePlace(fact, input.fact.standard_place !== undefined, holder.facts ?? []);
      if (fact.primary === true) clearPrimaryOfType(holder, fact.type, fact.id);
      holder.facts = [...(holder.facts ?? []), fact];
      assignedIds.fact = fact.id;
      break;
    }
    case "update_fact": {
      const holder = requireFactHolder(tree, input, "update_fact");
      if (!input.factId) throw new TreeEditError("update_fact requires a `factId`");
      if (!input.fact) throw new TreeEditError("update_fact requires `fact` fields to set");
      requireFactShape(input.fact, "update_fact");
      const existing = (holder.facts ?? []).find((f) => f.id === input.factId);
      if (!existing) {
        const where = input.personId ? `person '${input.personId}'` : `relationship '${input.relationshipId}'`;
        throw new TreeEditError(`fact '${input.factId}' not found on ${where}`);
      }
      // Refuse only an op that MAKES a person-level couple event. Editing one
      // already there is admitted: legacy documents are read, never repaired,
      // 14 such facts sit in 9 committed e2e starting trees, and refusing their
      // correction would strand data the agent is supposed to be able to fix.
      if (
        input.personId &&
        input.fact.type !== undefined &&
        !isCoupleEventFactType(existing.type)
      ) {
        refuseCoupleEventOnPerson(input.fact.type, "update_fact");
      }
      // Delta-scoped provenance rule (§6): an update may not REMOVE an existing
      // ref (e.g. clear a populated `sources`). It is NOT "the result must have a
      // ref" — touching an already-ref-less legacy fact without removing anything
      // is allowed.
      const factHadRef = hasNonNullRef(existing);
      // Pre-assignment values of the fields a correction can detach on, so the
      // detach below keys on an actual CHANGE rather than on the key merely
      // being present. Re-stating a field at the value it already holds is not
      // a correction, and 7 of the 31 ops that SET one in the committed corpus
      // also carry `primary` (the conclude-a-fact shape), which is exactly where
      // an unchanged echo rides along with a real edit.
      const factStringsBefore = new Map<string, unknown>(
        FACT_DETACH_FIELDS.map((f) => [f, (existing as Record<string, unknown>)[f]]),
      );
      for (const [k, v] of Object.entries(input.fact)) {
        if (k === "id") continue;
        // `primary: false` clears the flag rather than storing a false — the
        // only way to reach "this type has no concluded value" while a conflict
        // is open. Assigning it would fail the document validator, whose own
        // message ("omit it rather than setting false") is advice no op could
        // follow until this existed.
        if (k === "primary" && v === false) {
          delete (existing as any).primary;
          continue;
        }
        (existing as any)[k] = v;
      }
      if (factHadRef && !hasNonNullRef(existing)) {
        throw new TreeEditError(
          "update_fact must not remove an existing source-ref — clearing a populated `sources` " +
            "strips provenance (tree-materialization-spec §6). Downgrade a fact by removing the " +
            "whole fact (tree_correct remove) instead of nulling its ref.",
        );
      }
      if (input.fact.place !== undefined) {
        await maybeResolvePlace(existing, input.fact.standard_place !== undefined, holder.facts ?? []);
      }
      // A human CHANGING any of the fact's own string fields detaches it from
      // the assertion it was minted from (#2472) — the same reading the spec
      // already applies to `add_fact`: a researcher's own conclusion carries no
      // backlink. Left attached, the fact would permanently disagree with its
      // assertion (indistinguishable from the drift the agreement check reports)
      // and the next assertion update would silently revert the correction.
      //
      // Runs AFTER maybeResolvePlace so it sees the final `standard_place`: a
      // place change that re-resolves the sidecar is a change to this fact even
      // when the caller never named `standard_place`.
      //
      // The trigger is FACT_DETACH_FIELDS, wider than the four mirrored
      // attributes: a corrected `standard_date` must not survive beside a later
      // assertion `date` rewrite, and a retyped fact must not keep a backlink
      // whose assertion still carries the old type.
      if (existing.assertion_id !== undefined) {
        const changed = FACT_DETACH_FIELDS.filter(
          (f) => (existing as Record<string, unknown>)[f] !== factStringsBefore.get(f),
        );
        if (changed.length > 0) {
          warnings.push(
            `fact '${existing.id}' is no longer linked to assertion '${existing.assertion_id}' ` +
              `(${changed.join(", ")} changed) — an edit here detaches the fact, so a later ` +
              "correction to that assertion will not reach it. Correct the assertion instead " +
              "if the record was misread. (`standard_place` can change on its own when the " +
              "resolver re-runs, which detaches for the same reason.)",
          );
          delete existing.assertion_id;
        }
      }
      if (existing.primary === true) clearPrimaryOfType(holder, existing.type, existing.id);
      break;
    }
    case "add_name": {
      const person = requirePerson(tree, input.personId);
      if (!input.name) throw new TreeEditError("add_name requires a `name`");
      if (input.name.id) throw new TreeEditError("add_name `name` must not carry an id");
      const name: SimplifiedName = { ...input.name, id: nextId(tree, "N") };
      if (name.preferred === true) clearPreferred(person, name.id);
      person.names = [...(person.names ?? []), name];
      assignedIds.name = name.id;
      break;
    }
    case "update_name": {
      const person = requirePerson(tree, input.personId);
      if (!input.nameId) throw new TreeEditError("update_name requires a `nameId`");
      if (!input.name) throw new TreeEditError("update_name requires `name` fields to set");
      const existing = (person.names ?? []).find((n) => n.id === input.nameId);
      if (!existing) throw new TreeEditError(`name '${input.nameId}' not found on person '${input.personId}'`);
      // Same delta-scoped no-remove-ref rule as update_fact (§6).
      const nameHadRef = hasNonNullRef(existing);
      for (const [k, v] of Object.entries(input.name)) {
        if (k === "id") continue;
        (existing as any)[k] = v;
      }
      if (nameHadRef && !hasNonNullRef(existing)) {
        throw new TreeEditError(
          "update_name must not remove an existing source-ref — clearing a populated `sources` " +
            "strips provenance (tree-materialization-spec §6).",
        );
      }
      if (existing.preferred === true) clearPreferred(person, existing.id);
      break;
    }
    case "update_person": {
      const person = requirePerson(tree, input.personId);
      if (input.gender === undefined && input.ark === undefined) {
        throw new TreeEditError("update_person requires `gender` and/or `ark`");
      }
      if (input.gender !== undefined) person.gender = input.gender;
      if (input.ark !== undefined) person.ark = input.ark;
      break;
    }
    case "add_person": {
      if (!input.person) throw new TreeEditError("add_person requires a `person`");
      if (input.person.id) throw new TreeEditError("add_person `person` must not carry an id");
      // Tolerate a singular `name: {given, surname, ...}` where the schema wants
      // a `names: [...]` array — a common model shape slip (observed on ~15% of
      // add_person calls). Lift it into a single-element array; the object shape
      // already matches a names[] element. Reject if BOTH are supplied (ambiguous
      // — don't silently pick one). This is pure shape normalization: no name
      // content is parsed or invented.
      const rawPerson = input.person as SimplifiedPerson & { name?: SimplifiedName };
      if (rawPerson.name !== undefined) {
        if (rawPerson.names !== undefined) {
          throw new TreeEditError(
            "add_person: supply `names` (an array) OR a single `name`, not both",
          );
        }
        rawPerson.names = [rawPerson.name];
        delete rawPerson.name;
      }
      // Inline facts take the same rule as add_fact: a new person is a person.
      // Checked as an array first, so a malformed `facts` is a refusal naming
      // the op rather than a TypeError escaping the batch loop.
      if (input.person.facts != null && !Array.isArray(input.person.facts)) {
        throw new TreeEditError("add_person `person.facts` must be an array of facts");
      }
      for (const f of input.person.facts ?? []) {
        refuseCoupleEventOnPerson(f.type, "add_person");
      }
      const personId = nextId(tree, "I");
      const nMax = maxIdNum(tree, "N");
      const names = (input.person.names ?? []).map((n, i) => ({ ...n, id: `N${nMax + 1 + i}` }));
      // Normalize to exactly one preferred name (spec §4.1): keep the first
      // flagged preferred, or mark the first name preferred if none were.
      if (names.length > 0) {
        let kept = false;
        for (const n of names) {
          if (n.preferred === true && !kept) kept = true;
          else if (n.preferred === true) delete n.preferred;
        }
        if (!kept) names[0].preferred = true;
      }
      const person: SimplifiedPerson = { ...input.person, id: personId, names };
      tree.persons = [...(tree.persons ?? []), person];
      // Facts supplied inline on a new person get tool-allocated F ids and
      // place resolution, exactly as add_fact does — a fact written without
      // an id fails tree schema validation (fact.id is required).
      if (person.facts && person.facts.length > 0) {
        const factIds: string[] = [];
        for (const f of person.facts) {
          if (f.id) throw new TreeEditError("add_person facts must not carry ids — the tool assigns them");
          requireFactShape(f, "add_person");
          stripClearedPrimary(f);
          assertNodeHasRef(f, "each inline fact", "add_person");
          f.id = nextId(tree, "F");
          await maybeResolvePlace(f, f.standard_place !== undefined, person.facts);
          factIds.push(f.id);
        }
        assignedIds.facts = factIds;
      }
      assignedIds.person = personId;
      assignedIds.names = names.map((n) => n.id!).filter(Boolean);
      break;
    }
    case "add_relationship": {
      if (!input.relationship) throw new TreeEditError("add_relationship requires a `relationship`");
      if (input.relationship.id) throw new TreeEditError("add_relationship `relationship` must not carry an id");
      const rel: SimplifiedRelationship = { ...input.relationship, id: nextId(tree, "R") };

      // Resolve the edge's source-ref from a research.json relationship-
      // establishing assertion (`relationship` or `marriage`) instead of
      // requiring the caller to hand-walk the provenance chain
      // (tree-materialization-spec §8: "the same resolver materialize_facts
      // uses"). A literal `relationship.sources` alongside it is rejected as
      // ambiguous — pick one.
      if (input.sourceAssertionId !== undefined) {
        if (hasNonNullRef(rel)) {
          throw new TreeEditError(
            "add_relationship: supply `sourceAssertionId` OR a literal `relationship.sources`, not both",
          );
        }
        const assertion = (Array.isArray(research.assertions) ? research.assertions : []).find(
          (a: any) => a && a.id === input.sourceAssertionId,
        );
        if (!assertion) {
          throw new TreeEditError(
            `add_relationship: sourceAssertionId '${input.sourceAssertionId}' not found in research.json assertions`,
          );
        }
        // `marriage` counts as relationship-establishing: a marriage register is
        // exactly the assertion that establishes a Couple, and it is the type the
        // commonest Couple edge carries. Excluding it made this tool's own
        // instruction — and materialize_facts's — impossible to follow for that
        // edge, since a marriage assertion was the "same assertion" both told the
        // caller to source it with.
        if (!isRelationshipEstablishing(assertion.fact_type)) {
          throw new TreeEditError(
            `add_relationship: sourceAssertionId '${input.sourceAssertionId}' is a '${assertion.fact_type}' ` +
              "assertion, which establishes no link between two parties — the edge's provenance " +
              "must come from a relationship-establishing assertion ('relationship', 'marriage', " +
              "'parentage', 'parentchild'; case-insensitive)",
          );
        }
        rel.sources = [resolveRelationshipRef(assertion, research, tree)];
      }

      // The newly-authored edge carries a non-null source-ref (§6/§8): a census
      // etc. establishing a parent-child/spousal edge is evidence from that
      // record.
      assertNodeHasRef(rel, "the added relationship edge", "add_relationship");

      // A self-Couple is an impossibility, not a duplicate: a person cannot be
      // their own spouse, and the pair would survive every downstream rule that
      // reads the two endpoints as different people.
      if (rel.type === "Couple" && rel.person1 !== undefined && rel.person1 === rel.person2) {
        throw new TreeEditError(
          `add_relationship: a Couple cannot join '${rel.person1}' to themselves`,
        );
      }

      // An edge that already says this corroborates rather than duplicates
      // (plan Decision 37). The new sources — and any inline Couple facts —
      // land on the existing edge and its id comes back, so a retried call and
      // a second record about the same marriage both leave one edge. A refusal
      // would make the caller re-route the same evidence by hand through
      // `add_fact`, dropping the edge's own sources on the way.
      const matched = (tree.relationships ?? []).find((e) => relationshipMatches(e, rel));
      if (matched) {
        if (rel.sources?.length) {
          matched.sources = dedupSourceRefs([...(matched.sources ?? []), ...rel.sources]);
        }
        // Notes are often where the researcher records why; unioned exactly as
        // `dedupRelationships` unions them, so both paths keep the same trail.
        if (rel.notes?.length) {
          matched.notes = [...new Set([...(matched.notes ?? []), ...rel.notes])];
        }
        // The matched edge's subtype never changes here: retyping is
        // `update_relationship`'s job, and silently adopting one would turn an
        // untyped import into a biological claim with nothing behind it. Say so
        // rather than let the caller believe the subtype landed.
        if (rel.subtype !== undefined && matched.subtype !== rel.subtype) {
          warnings.push(
            `add_relationship corroborated the existing edge '${matched.id}', which keeps its ` +
              `${matched.subtype === undefined ? "absent subtype" : `'${matched.subtype}' subtype`} — ` +
              `use update_relationship to retype it to '${rel.subtype}'`,
          );
        }
      } else {
        tree.relationships = [...(tree.relationships ?? []), rel];
      }
      // Facts go onto whichever edge now carries this relationship.
      const edge = matched ?? rel;
      // Facts supplied on a new relationship (e.g. a Marriage on a Couple) are
      // the relationship's own facts: assign each a tool-allocated F id and
      // resolve its standard_place, exactly as add_fact does. Callers never
      // supply fact ids — a fact written without an id fails tree schema
      // validation (fact.id is required).
      if (rel.facts && rel.facts.length > 0) {
        if (rel.type !== "Couple") {
          throw new TreeEditError(
            "facts live only on Couple relationships — a ParentChild relationship cannot carry facts",
          );
        }
        const factIds: string[] = [];
        for (const f of rel.facts) {
          if (f.id) throw new TreeEditError("add_relationship facts must not carry ids — the tool assigns them");
          requireFactShape(f, "add_relationship");
          stripClearedPrimary(f);
          // A Couple fact (e.g. Marriage) with no ref of its own inherits the
          // edge's resolved ref — but ONLY when that ref came from
          // `sourceAssertionId` (the marriage record IS typically the source
          // for both the edge and the fact). A literal `relationship.sources`
          // is NOT auto-inherited onto facts — each still needs its own ref,
          // unchanged pre-existing behavior (a caller supplying a literal ref
          // manually is not asking for auto-propagation).
          if (!hasNonNullRef(f) && input.sourceAssertionId !== undefined && rel.sources) {
            f.sources = rel.sources.map((s) => ({ ...s }));
          }
          assertNodeHasRef(f, "each Couple fact", "add_relationship");
          // Corroborating: a fact the edge already carries, equal in type, date,
          // place and value, is not added again — its sources join the one
          // already there. This is what makes a retried call idempotent rather
          // than leaving two identical Marriage facts on one edge.
          const twin = matched
            ? (matched.facts ?? []).find((g) => sameFactValue(g, f))
            : undefined;
          if (twin) {
            if (f.sources?.length) {
              twin.sources = dedupSourceRefs([...(twin.sources ?? []), ...f.sources]);
            }
            // Report the fact the caller's sources landed on, exactly as the
            // corroborated edge reports its existing id. A silent omission
            // would leave a fully-corroborated retry returning no fact id at
            // all, with nothing to say where the evidence went.
            if (twin.id) factIds.push(twin.id);
            continue;
          }
          f.id = nextId(tree, "F");
          await maybeResolvePlace(f, f.standard_place !== undefined, edge.facts ?? rel.facts);
          // Same primary swap add_fact performs, but only when corroborating:
          // the plan scopes it to the matched edge, and `main` never swapped on
          // a newly created one. `primary` is about to become load-bearing
          // (Decision 34), so who sets it does not change by accident here.
          if (matched && f.primary === true) clearPrimaryOfType(edge, f.type, f.id);
          if (matched) matched.facts = [...(matched.facts ?? []), f];
          factIds.push(f.id);
        }
        if (factIds.length) assignedIds.facts = factIds;
      }
      assignedIds.relationship = edge.id;
      break;
    }
    case "add_source": {
      if (!input.source) throw new TreeEditError("add_source requires a `source`");
      if (input.source.id) throw new TreeEditError("add_source `source` must not carry an id — the tool assigns it");
      const source: SimplifiedSourceDescription = { ...input.source, id: nextId(tree, "S") };
      tree.sources = [...(tree.sources ?? []), source];
      assignedIds.source = source.id;
      break;
    }
    case "update_source": {
      if (!input.sourceId) throw new TreeEditError("update_source requires a `sourceId`");
      if (!input.source) throw new TreeEditError("update_source requires `source` fields to set");
      const existing = (tree.sources ?? []).find((s) => s.id === input.sourceId);
      if (!existing) throw new TreeEditError(`source '${input.sourceId}' not found in tree`);
      for (const [k, v] of Object.entries(input.source)) {
        if (k === "id") continue;
        (existing as any)[k] = v;
      }
      break;
    }
    case "update_relationship": {
      // Retyping, not re-pointing: the endpoints identify the relationship and
      // changing those would make it a different edge. `add_relationship`'s
      // corroboration deliberately never changes a matched edge's subtype and
      // names this op instead, so that a subtype only ever moves on an explicit
      // correction.
      if (!input.relationshipId) throw new TreeEditError("update_relationship requires a `relationshipId`");
      if (input.subtype === undefined) {
        throw new TreeEditError("update_relationship requires a `subtype` — it is the only field it sets");
      }
      // Types are trusted everywhere else in this switch because every other
      // check is a truthiness test or `===`, both safe on any value. `.trim()`
      // below is a method call, so a non-string `subtype` from a malformed op
      // would raise a TypeError — and the batch loop re-throws anything that is
      // not a TreeEditError, so it would escape as an unhandled exception
      // instead of a refusal naming the op.
      if (typeof input.subtype !== "string") {
        throw new TreeEditError(
          `update_relationship: \`subtype\` must be a string, got ${typeof input.subtype}`,
        );
      }
      // An empty string is not "clear the subtype": `relationshipMatches` reads
      // any defined subtype as an explicit one, so `""` would match an absent
      // subtype but never match 'Biological' — a phantom type that pairs with
      // nothing. Clearing a subtype is not specified; refuse rather than store
      // a value that behaves like neither.
      if (input.subtype.trim() === "") {
        throw new TreeEditError(
          "update_relationship: `subtype` must not be empty — an empty subtype matches no other edge. " +
            "Pass a real subtype (e.g. 'Biological', 'Step')",
        );
      }
      const rel = (tree.relationships ?? []).find((r) => r.id === input.relationshipId);
      if (!rel) throw new TreeEditError(`relationship '${input.relationshipId}' not found in tree`);
      if (rel.type !== "ParentChild") {
        throw new TreeEditError(
          `update_relationship: '${rel.id}' is a ${rel.type} — only a ParentChild edge carries a subtype`,
        );
      }
      // A retype that would collide with an edge already on the pair is refused
      // rather than silently creating a duplicate the dedup would later fold.
      const clash = (tree.relationships ?? []).find(
        (r) => r.id !== rel.id && relationshipMatches(r, { ...rel, subtype: input.subtype }),
      );
      if (clash) {
        throw new TreeEditError(
          `update_relationship: retyping '${rel.id}' to '${input.subtype}' would duplicate '${clash.id}', ` +
            "which already joins this pair — remove one of them instead",
        );
      }
      rel.subtype = input.subtype;
      break;
    }
    case "remove": {
      // `personId` is refused only as a target of its own. With a `factId` it
      // SCOPES the removal — which holder's copy to drop — and that is the
      // whole point below.
      // Order matters: two scopes is the more specific complaint. Checked
      // first so {personId, relationshipId} with no factId is not answered
      // with "remove does not delete persons", which sends the caller to
      // merge_tree_persons when their actual mistake was passing both scopes.
      if (input.personId && input.relationshipId) {
        throw new TreeEditError(
          "remove: pass `personId` OR `relationshipId` to scope a `factId`, not both",
        );
      }
      if (input.personId && !input.factId) {
        throw new TreeEditError("remove does not delete persons — use merge_tree_persons to collapse a person");
      }
      // `factId` with `relationshipId` is a scoped fact removal, not two
      // targets; `{relationshipId}` alone still removes the edge itself.
      if (!input.factId && !input.relationshipId) {
        throw new TreeEditError("remove requires exactly one of `factId` or `relationshipId`");
      }
      if (input.factId) {
        // FamilySearch reuses fact ids across the persons an import touches —
        // 65 of the 136 committed e2e starting trees carry one id on two or
        // more holders, one of them on 15. Filtering the id out of every person
        // and every relationship therefore deleted the fact for all of them, so
        // withdrawing one person's disproved imported Birth silently removed
        // fifteen people's. A shared id must say whose copy to drop.
        const holders: Array<{ label: string; node: { facts?: SimplifiedFact[] } }> = [];
        for (const p of tree.persons ?? []) {
          if ((p.facts ?? []).some((f) => f.id === input.factId)) {
            holders.push({ label: `person '${p.id}'`, node: p });
          }
        }
        for (const r of tree.relationships ?? []) {
          if ((r.facts ?? []).some((f) => f.id === input.factId)) {
            holders.push({ label: `relationship '${r.id}'`, node: r });
          }
        }
        if (holders.length === 0) throw new TreeEditError(`fact '${input.factId}' not found in tree`);

        const scopeId = input.personId ?? input.relationshipId;
        if (scopeId === undefined) {
          if (holders.length > 1) {
            throw new TreeEditError(
              `remove: fact '${input.factId}' is carried by ${holders.length} holders ` +
                `(${holders.map((h) => h.label).join(", ")}) — FamilySearch reuses fact ids, so ` +
                "removing it unscoped would delete all of them. Pass `personId` or " +
                "`relationshipId` to say whose copy to remove",
            );
          }
          holders[0].node.facts = (holders[0].node.facts ?? []).filter((f) => f.id !== input.factId);
        } else {
          const scoped = (input.personId
            ? (tree.persons ?? []).find((p) => p.id === input.personId)
            : (tree.relationships ?? []).find((r) => r.id === input.relationshipId)) as
            | { facts?: SimplifiedFact[] }
            | undefined;
          if (!scoped) {
            throw new TreeEditError(
              input.personId
                ? `person '${input.personId}' not found in tree`
                : `relationship '${input.relationshipId}' not found in tree`,
            );
          }
          const before = (scoped.facts ?? []).length;
          scoped.facts = (scoped.facts ?? []).filter((f) => f.id !== input.factId);
          if (scoped.facts.length === before) {
            throw new TreeEditError(
              `remove: fact '${input.factId}' is not carried by ${
                input.personId ? `person '${input.personId}'` : `relationship '${input.relationshipId}'`
              } — it is on ${holders.map((h) => h.label).join(", ")}`,
            );
          }
        }
      } else {
        const before = (tree.relationships ?? []).length;
        tree.relationships = (tree.relationships ?? []).filter((r) => r.id !== input.relationshipId);
        if (tree.relationships.length === before) {
          throw new TreeEditError(`relationship '${input.relationshipId}' not found in tree`);
        }
      }
      break;
    }
    default:
      throw new TreeEditError(`unknown operation '${input.operation}'`);
  }

  return { assignedIds, warnings };
}

export async function treeEdit(input: TreeEditInput): Promise<TreeEditResult> {
  return executeTreeOps(input, EDIT_GATE);
}

/**
 * Check introduced genealogical warnings and refuse if any are unjustified.
 * Returns null when the write may proceed, or the refusal response.
 * When justified, persists the justifications to research.json.
 *
 * Shared by tree_edit, tree_correct, materialize_facts and merge_tree_persons.
 */
export async function checkWarningGate(
  beforeTree: SimplifiedGedcomX,
  afterTree: SimplifiedGedcomX,
  research: any,
  projectPath: string,
  warningJustifications: WarningJustificationInput[] | undefined,
  toolName: string,
  collapseMap?: Map<string, string>,
  proposedAssertionIds?: Map<string, string>,
): Promise<WarningGateRefusal | WarningGatePass | null> {
  const touchedIds = computeTouchedPersonIds(beforeTree, afterTree);
  // Competing biological parentage is gated on its own finding, not on whether
  // tooManyFathers2/tooManyMothers2 is new: that warning can already stand on
  // the child, and a parent's gender change does not touch the child at all.
  const found = findCompetingParentage(beforeTree, afterTree, research, proposedAssertionIds, collapseMap);
  if (touchedIds.length === 0 && found.length === 0) return null;
  const parentage = found.map((c) => c.entry);

  const result = introducedWarnings(
    beforeTree,
    afterTree,
    touchedIds,
    warningJustifications,
    collapseMap,
  );

  // A finding replaces the count warning for the same child and sex, so the
  // caller is asked once, under the finding's own id.
  const covered = new Set(
    found.map((c) => `${c.sex === "Male" ? "tooManyFathers2" : "tooManyMothers2"}|${c.entry.personId}`),
  );
  const keep = (w: { issueType: string; personId: string }) => !covered.has(`${w.issueType}|${w.personId}`);
  const nameOf = (id: string) => {
    const p = (afterTree.persons ?? []).find((x) => x.id === id);
    return p ? getPersonName(p) : "";
  };
  const parentageWarnings = found.map((c) => ({
    warningId: c.warningId,
    issueType: c.sex === "Male" ? "tooManyFathers2" : "tooManyMothers2",
    severity: "implausible" as const,
    personId: c.entry.personId,
    personName: nameOf(c.entry.personId),
    message:
      `This write gives ${nameOf(c.entry.personId)} (${c.entry.personId}) two or more biological ${c.sex === "Male" ? "fathers" : "mothers"}: ` +
      `${c.entry.values.join("; ")}.`,
    facts: undefined,
    relatedPersonId: undefined,
  }));
  const allIntroduced = result.allIntroduced.filter(keep);
  const others = result.unjustified.filter(keep);
  // Competing parentage refuses whatever is justified: it is routed, not justified.
  const unjustified = [...parentageWarnings, ...others];

  if (unjustified.length > 0) {
    const message = parentage.length > 0
      ? ROUTE_PARENTAGE + (others.length > 0 ? JUSTIFY_OTHERS : "")
      : "This write introduces genealogical warnings that must be justified. " +
        "Re-call with warningJustifications listing each warningId and a justification string.";
    return {
      ok: false,
      reason: "unjustified_warnings",
      errors: [message],
      message,
      ...(parentage.length > 0 ? { conflicts_surfaced: parentage } : {}),
      warnings: unjustified.map((w) => ({
        warningId: w.warningId,
        issueType: w.issueType,
        severity: w.severity,
        personId: w.personId,
        personName: w.personName,
        message: w.message,
        facts: w.facts,
        relatedPersonId: w.relatedPersonId,
      })),
    };
  }

  // All introduced warnings are justified — check for stale justification ids
  if (warningJustifications && warningJustifications.length > 0) {
    const stale = staleJustifications(allIntroduced, warningJustifications);
    if (stale.length > 0) {
      const message = `Stale warningId(s) not matching any introduced warning: ${stale.join(", ")}. ` +
        "Re-call without warningJustifications to get the current warning ids.";
      return {
        ok: false,
        reason: "unjustified_warnings",
        errors: [message],
        message,
        warnings: [{ message }],
      };
    }

    // Persist justifications to research.json
    if (allIntroduced.length > 0) {
      const now = new Date().toISOString().slice(0, 10);
      const existing = Array.isArray(research.warning_justifications)
        ? research.warning_justifications
        : [];
      const newEntries = warningJustifications.map((j) => ({
        warning_id: j.warningId,
        justification: j.justification,
        person_ids: [...new Set(
          allIntroduced
            .filter((w) => w.warningId === j.warningId)
            .flatMap((w) => [w.personId, ...(w.relatedPersonId ? [w.relatedPersonId] : [])]),
        )],
        tool: toolName,
        recorded_at: now,
      }));
      research.warning_justifications = [...existing, ...newEntries];
      return { justificationsPersisted: true };
    }
  }

  return null;
}

/** Each proposed ParentChild edge's `sourceAssertionId`, keyed parent|child,
 *  so the gate can name the claim behind an edge it refuses. */
function proposedParentAssertions(ops: Array<Partial<TreeEditOp>> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const op of ops ?? []) {
    const rel = op.relationship;
    if (op.operation !== "add_relationship" || !op.sourceAssertionId || rel?.type !== "ParentChild") continue;
    if (rel.parent && rel.child) out.set(parentChildKey(rel.parent, rel.child), op.sourceAssertionId);
  }
  return out;
}

/** Shared core behind `tree_edit` and `tree_correct` — identical batched-op,
 *  id-assignment, and validate-on-write semantics; only the admitted
 *  op set (the gate) differs. */
export async function executeTreeOps(input: TreeEditInput, gate: OpGate, toolName = "tree_edit"): Promise<TreeEditResult> {
  const { projectPath } = input;

  // Recover object/array args the model serialized as JSON strings (see
  // coerceJsonArg) before any shape checks — the batch `ops` array most
  // importantly, plus the single-op nested objects — so a correct-but-
  // stringified payload isn't rejected and driven into a slow fallback.
  input.ops = coerceJsonArg(input.ops) as TreeEditOp[] | undefined;
  input.fact = coerceJsonArg(input.fact) as SimplifiedFact | undefined;
  input.name = coerceJsonArg(input.name) as SimplifiedName | undefined;
  input.person = coerceJsonArg(input.person) as SimplifiedPerson | undefined;
  input.relationship = coerceJsonArg(input.relationship) as SimplifiedRelationship | undefined;
  input.source = coerceJsonArg(input.source) as SimplifiedSourceDescription | undefined;

  // Serialize the read-modify-write against every other writer on this project
  // (issue #1715). Wraps tree_correct too, which routes here via executeTreeOps.
  return withProjectLock(projectPath, async () => {
  try {
    // Heal legacy shapes before anything touches the document: the closed
    // shapes below would otherwise refuse every write on a pre-tightening
    // tree, with no op able to express the repair. The healed document is
    // what a successful edit persists — a one-shot migration.
    const sanitized = sanitizeTree(
      await readJson(projectPath, "tree.gedcomx.json"),
    );
    const tree = sanitized.tree;
    const research = await readJson(projectPath, "research.json");
    // Post-heal, pre-edit snapshot (applyOperation mutates tree in place):
    // block only on errors THIS call introduces, not pre-existing drift in a
    // section it never touched (#1572).
    const beforeTree = structuredClone(tree);


    // ─── Batch form: apply every op in-memory, then validate + write once ─────
    if (input.ops !== undefined) {
      if (!Array.isArray(input.ops) || input.ops.length === 0) {
        return { ok: false, errors: ["`ops` must be a non-empty array"] };
      }
      const results: PerOpResult[] = [];
      const opWarnings: string[] = [];
      for (let i = 0; i < input.ops.length; i++) {
        const op = input.ops[i];
        try {
          gateOperation(op?.operation, gate);
          const applied = await applyOperation(tree, research, { ...op, projectPath });
          opWarnings.push(...applied.warnings);
          const r: PerOpResult = { operation: op.operation };
          if (Object.keys(applied.assignedIds).length > 0) r.assignedIds = applied.assignedIds;
          results.push(r);
        } catch (e) {
          if (e instanceof TreeEditError) {
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

      // Warning gate: refuse if the write introduces unjustified warnings
      const warningGateResult = await checkWarningGate(
        beforeTree, tree, research, projectPath,
        input.warningJustifications, toolName,
        undefined, proposedParentAssertions(input.ops),
      );
      if (warningGateResult && "ok" in warningGateResult) return warningGateResult;
      const justificationsPersisted = warningGateResult?.justificationsPersisted === true;

      // Write tree (and research if justifications were persisted)
      if (justificationsPersisted) {
        await atomicWriteBoth(projectPath, [
          { ref: "tree.gedcomx.json", data: tree },
          { ref: "research.json", data: research },
        ]);
      } else {
        await atomicWriteJson(projectPath, "tree.gedcomx.json", tree);
      }
      const filesWritten = justificationsPersisted
        ? ["tree.gedcomx.json", "research.json"]
        : ["tree.gedcomx.json"];
      return {
        ok: true,
        results,
        filesWritten,
        validation: {
          valid: true,
          warnings: [...sanitized.warnings, ...formatIssues(validation.warnings), ...opWarnings],
        },
      };
    }

    // ─── Single-op form (behavior unchanged) ─────────────────────────────────
    if (!input.operation) {
      return { ok: false, errors: ["provide either `ops` (batch) or `operation` (single)"] };
    }
    gateOperation(input.operation, gate);
    const applied = await applyOperation(tree, research, input);
    const { assignedIds, warnings } = applied;

    const validation = await validateIntroduced({ research, tree: beforeTree }, { research, tree }, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    // Warning gate: refuse if the write introduces unjustified warnings
    const singleGateResult = await checkWarningGate(
      beforeTree, tree, research, projectPath,
      input.warningJustifications, toolName,
      undefined, proposedParentAssertions([input]),
    );
    if (singleGateResult && "ok" in singleGateResult) return singleGateResult;
    const singleJustificationsPersisted = singleGateResult?.justificationsPersisted === true;

    // Write tree (and research if justifications were persisted)
    if (singleJustificationsPersisted) {
      await atomicWriteBoth(projectPath, [
        { ref: "tree.gedcomx.json", data: tree },
        { ref: "research.json", data: research },
      ]);
    } else {
      await atomicWriteJson(projectPath, "tree.gedcomx.json", tree);
    }

    const singleFilesWritten = singleJustificationsPersisted
      ? ["tree.gedcomx.json", "research.json"]
      : ["tree.gedcomx.json"];
    const result: TreeEditResult = {
      ok: true,
      operation: input.operation,
      filesWritten: singleFilesWritten,
      validation: {
        valid: true,
        warnings: [...sanitized.warnings, ...formatIssues(validation.warnings), ...warnings],
      },
    };
    if (Object.keys(assignedIds).length > 0) result.assignedIds = assignedIds;
    return result;
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult();
    if (e instanceof TreeEditError) return { ok: false, errors: [e.message] };
    throw e;
  }
  });
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const treeEditSchema = {
  name: "tree_edit",
  description:
    "Add to the project's tree.gedcomx.json — add a fact or name, add a person or " +
    "relationship, or add a source. " +
    "ADDITIVE ONLY: corrections and removals " +
    "(update_fact/update_name/update_person/update_source/update_relationship/remove) live in the " +
    "tree_correct tool. add_fact targets a person (personId) or an existing Couple " +
    "relationship (relationshipId) — a Marriage/Divorce fact lives on the Couple, " +
    "never duplicated onto each spouse. Use materialize_facts to write a record " +
    "persona's sourced facts onto a tree person, or merge_tree_persons to collapse " +
    "duplicate persons (this tool never deletes a person).\n" +
    "\n" +
    "add_relationship requires a non-null source-ref on the edge. Prefer " +
    "`sourceAssertionId` (the research.json assertion this edge comes from — any " +
    "that establishes a link between two parties: relationship, marriage, parentage " +
    "or parentchild. A marriage register is what establishes a Couple, so source a " +
    "Couple edge with the marriage assertion itself) over a " +
    "literal `relationship.sources` — the tool resolves " +
    "assertion.source_id -> research source -> tree S-entry itself (the same " +
    "resolver materialize_facts uses), so you never hand-walk the chain. Any inline " +
    "Couple fact (e.g. Marriage) with no ref of its own inherits the same resolved " +
    "ref. Supply one or the other, not both.\n" +
    "\n" +
    "Pick the `operation` and supply the content (snake_case simplified-GedcomX " +
    "fields) WITHOUT ids — the tool assigns the next F/N/I/R/S id, swaps the " +
    "primary/preferred flag, resolves standard_place for a place, validates the " +
    "whole project, and writes only tree.gedcomx.json. " +
    "Returns a compact summary (the assigned ids); on a validation failure nothing " +
    "is written and `{ ok: false, errors }` is returned. Run check-warnings after " +
    "for genealogical-plausibility checks.\n" +
    "\n" +
    "To make several edits at once (e.g. a source plus a fact), pass an `ops` " +
    "array instead of the top-level operation: each op is `{ operation, ...fields }` " +
    "(the same per-op fields). The tool applies all ops to one in-memory tree, " +
    "validates ONCE, and writes ONCE — all-or-nothing (on any op's failure nothing is " +
    "written and the error is `ops[i]: <msg>`). Ids assigned by an earlier op are " +
    "visible to later ops. Returns `results: [{operation, assignedIds}]`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding tree.gedcomx.json and research.json.",
      },
      operation: {
        type: "string",
        enum: [
          "add_fact",
          "add_name",
          "add_person",
          "add_relationship",
          "add_source",
        ],
        description: "The addition to perform. Corrections/removals: use tree_correct.",
      },
      personId: {
        type: "string",
        description:
          "Target person id — for add_fact (person-held facts; exactly one of personId or " +
          "relationshipId) and add_name.",
      },
      relationshipId: {
        type: "string",
        description:
          "Target relationship id — for add_fact on a Couple relationship's own facts " +
          "(e.g. a Marriage lives on the Couple, not on each spouse; exactly one of personId or " +
          "relationshipId).",
      },
      fact: {
        type: "object",
        description:
          "The fact to add (full, no id). date/standard_date/place/" +
          "standard_place/value are plain strings (date: \"2 October 1876\"), never nested objects. " +
          "Set `primary: true` to make it the primary of its type; `primary: false` " +
          "adds it without one, leaving any existing primary of that type alone.",
      },
      name: {
        type: "object",
        description: "The name to add (full, no id). Set `preferred: true` to make it the preferred name.",
      },
      person: {
        type: "object",
        description:
          "The person to add (gender + at least one name; no ids — the tool assigns I, N, and F ids, " +
          "including for any inline `facts`). Omit `ark` for a synthesized stub.",
      },
      relationship: {
        type: "object",
        description: "The relationship to add (no id). Use `parent`/`child` for ParentChild, `person1`/`person2` for Couple; endpoints must be existing person ids.",
      },
      sourceAssertionId: {
        type: "string",
        description:
          "add_relationship only: the research.json assertion this edge comes from — any type " +
          "that establishes a link between two parties (relationship, marriage, parentage, " +
          "parentchild; a Couple edge is sourced with the marriage assertion itself). The tool " +
          "resolves its source-ref itself (assertion.source_id -> " +
          "research source -> tree S-entry) instead of you supplying a literal " +
          "`relationship.sources` — mutually exclusive with one.",
      },
      source: {
        type: "object",
        description: "The source description to add (full, no id — the tool assigns the next S id). Fields: `title` (required), optional `author`, `url`, `citation` — a plain top-level entry, so no place resolution or primary/preferred handling applies. This is the lightweight tree sources[] entry, distinct from the rich research.json source. To refine an existing S entry, use tree_correct's update_source.",
      },
      resolveStandardPlace: {
        type: "boolean",
        description: "Default true: auto-resolve standard_place when a fact place is set. Pass false to skip the lookup.",
      },
      ops: {
        type: "array",
        description:
          "Batch form: apply many additions in one validate-once/write-once call " +
          "(all-or-nothing). When present, the top-level operation/fields are ignored. " +
          "Each op is the same `{ operation, ...fields }` the single form takes.",
        items: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: [
                "add_fact",
                "add_name",
                "add_person",
                "add_relationship",
                "add_source",
              ],
              description: "The addition to perform. Corrections/removals: use tree_correct.",
            },
            personId: { type: "string" },
            relationshipId: { type: "string" },
            fact: { type: "object" },
            name: { type: "object" },
            person: { type: "object" },
            relationship: { type: "object" },
            sourceAssertionId: { type: "string" },
            source: { type: "object" },
            resolveStandardPlace: { type: "boolean" },
          },
          required: ["operation"],
        },
      },
      warningJustifications: {
        type: "array",
        description:
          "Justifications for genealogical warnings this write introduces. " +
          "If the write introduces warnings and this is absent or incomplete, the tool " +
          "refuses with { ok: false, reason: 'unjustified_warnings', warnings: [...] }. " +
          "Re-call with each warningId and a justification string.",
        items: {
          type: "object",
          properties: {
            warningId: { type: "string", description: "The warning id from the refusal." },
            justification: { type: "string", description: "Why this warning is acceptable." },
          },
          required: ["warningId", "justification"],
        },
      },
    },
    required: ["projectPath"],
  },
};
