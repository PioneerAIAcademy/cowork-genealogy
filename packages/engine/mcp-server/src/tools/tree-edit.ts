// tree_edit — single-entity ad-hoc mutations of tree.gedcomx.json.
//
// The sibling of the merge tools: where those collapse persons, this one does
// the add/correct/remove edits the tree-edit skill performs by hand today. It
// reuses the shipped write layer (atomicWriteJson, backupIfExists, validateParsed)
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

import { join } from "path";
import { readFile } from "fs/promises";
import type {
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedName,
  SimplifiedFact,
  SimplifiedRelationship,
  SimplifiedSourceDescription,
} from "../types/gedcomx.js";
import { validateParsed } from "../validation/validator.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import type { ValidationError } from "../validation/types.js";
import { atomicWriteJson, backupIfExists } from "../utils/project-io.js";
import { maxIdNum, nextId } from "../utils/gedcomx-ids.js";
import { resolveStandardPlace } from "../utils/place-resolver.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";

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
  | "remove"
  | "add_household_children";

/** The additive ops — the only operations `tree_edit` accepts. */
export const ADD_OPERATIONS = [
  "add_fact",
  "add_name",
  "add_person",
  "add_relationship",
  "add_source",
  "add_household_children",
] as const;

/** The correction/removal ops — the only operations `tree_correct` accepts. */
export const CORRECT_OPERATIONS = [
  "update_fact",
  "update_name",
  "update_person",
  "update_source",
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

/** One record-side household member for `add_household_children` — the name
 *  and gender as the RECORD states them; the tool does the tree matching. */
export interface HouseholdMemberInput {
  given?: string;
  surname?: string;
  gender?: string;
}

/** The `add_household_children` checklist — compact, relayable verbatim. */
export interface HouseholdChecklist {
  parentsMatched: { name: string; id: string }[];
  created: { name: string; id: string }[];
  skipped: { name: string; reason: string; id?: string }[];
  edgesAdded: number;
}

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
  /** add_household_children: the record's parent / child_N rosters. */
  parents?: HouseholdMemberInput[];
  children?: HouseholdMemberInput[];
  /** Auto-resolve standard_place when a place is set (default true). */
  resolveStandardPlace?: boolean;
}

export interface TreeEditInput extends Partial<TreeEditOp> {
  projectPath: string;
  // Batch form — supply ops; when present the single-op fields above are ignored.
  // Every op applies to one in-memory tree; the tool validates once and writes
  // once (all-or-nothing). Ids assigned earlier in the batch are visible to
  // later ops (the allocator rescans the live tree).
  ops?: TreeEditOp[];
}

interface AssignedIds {
  person?: string;
  fact?: string;
  name?: string;
  relationship?: string;
  source?: string;
  names?: string[];
  facts?: string[];
  /** add_household_children stub persons / ParentChild edges. */
  persons?: string[];
  relationships?: string[];
}

interface PerOpResult {
  operation: TreeEditOperation;
  assignedIds?: AssignedIds;
  household?: HouseholdChecklist;
  action?: "skipped_no_parent_in_tree";
}

export type TreeEditResult =
  | ({
      ok: true;
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    } & PerOpResult)
  | {
      ok: true;
      results: PerOpResult[];
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    }
  | { ok: false; errors: string[] };

class TreeEditError extends Error {}

/** Reject an operation the calling tool does not admit (redirecting to the
 *  sibling tool when the op exists there), before anything is applied. */
function gateOperation(operation: string | undefined, gate: OpGate): void {
  if (!operation || gate.allowed.has(operation)) return;
  if (ALL_OPERATIONS.has(operation)) throw new TreeEditError(gate.rejection(operation));
  throw new TreeEditError(`unknown operation '${operation}'`);
}

function formatIssues(issues: ValidationError[]): string[] {
  return issues.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
}

async function readJson(projectPath: string, filename: string): Promise<any> {
  let text: string;
  try {
    text = await readFile(join(projectPath, filename), "utf-8");
  } catch {
    throw new TreeEditError(`${filename} not found in projectPath`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TreeEditError(`${filename} is not valid JSON`);
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
function requireFactShape(fact: SimplifiedFact, op: string): void {
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

// ─── add_household_children helpers (spec §4.4) ──────────────────────────────

/** Name-token normalization: casefold, Unicode-decompose (NFKD), strip every
 *  character outside [a-z0-9] — so `Sóstenes` ≡ `sostenes`, `O'Brien` ≡
 *  `obrien`. */
function normalizeNameToken(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

/** Tolerant given-name match on NORMALIZED tokens: exact (incl. both empty),
 *  or — both ≥2 chars — one a prefix of the other (Will/William), or the
 *  shorter a first-letter-anchored subsequence of the longer (the
 *  Wm/William, Thos/Thomas, Chas/Charles contraction class). An empty token
 *  matches only an empty token. */
function givenTokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.startsWith(short)) return true;
  if (short[0] !== long[0]) return false;
  let j = 0;
  for (const ch of long) {
    if (ch === short[j]) j++;
    if (j === short.length) return true;
  }
  return false;
}

/** Normalize a member/person gender to Male/Female/Unknown; null = invalid. */
function normalizeGender(v: unknown): string | null {
  const g = String(v ?? "")
    .trim()
    .toLowerCase();
  if (g === "male" || g === "m") return "Male";
  if (g === "female" || g === "f") return "Female";
  if (g === "unknown" || g === "u") return "Unknown";
  return null;
}

/** Record-side display name for checklist echoes. */
function memberDisplayName(m: HouseholdMemberInput): string {
  return [m.given, m.surname].filter((p) => typeof p === "string" && p.trim() !== "").join(" ");
}

/** Does any names[] entry of `person` match the record-side member? Gender
 *  equality + surname normalized-equal + tolerant given match. */
function personMatchesMember(person: SimplifiedPerson, member: HouseholdMemberInput, memberGender: string): boolean {
  if (normalizeGender(person.gender) !== memberGender) return false;
  const wantGiven = normalizeNameToken(member.given);
  const wantSurname = normalizeNameToken(member.surname);
  for (const n of person.names ?? []) {
    if (!n || typeof n !== "object") continue;
    if (normalizeNameToken(n.surname) !== wantSurname) continue;
    if (givenTokenMatches(normalizeNameToken(n.given), wantGiven)) return true;
  }
  return false;
}

interface ValidatedMember {
  member: HouseholdMemberInput;
  gender: string;
  name: string;
}

/** Validate a parents/children array: non-empty, each entry an object with a
 *  normalizable gender and at least one name part. */
function requireHouseholdMembers(list: unknown, field: "parents" | "children"): ValidatedMember[] {
  if (!Array.isArray(list) || list.length === 0) {
    throw new TreeEditError(`add_household_children requires a non-empty \`${field}\` array`);
  }
  return list.map((m, i) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      throw new TreeEditError(`add_household_children ${field}[${i}] must be an object { given?, surname?, gender }`);
    }
    const member = m as HouseholdMemberInput;
    const gender = normalizeGender(member.gender);
    if (!gender) {
      throw new TreeEditError(
        `add_household_children ${field}[${i}] requires a gender (Male/Female/Unknown; M/F/U accepted)`,
      );
    }
    if (normalizeNameToken(member.given) === "" && normalizeNameToken(member.surname) === "") {
      throw new TreeEditError(`add_household_children ${field}[${i}] requires a given and/or surname`);
    }
    return { member, gender, name: memberDisplayName(member) };
  });
}

/** Remove the `primary` flag from the holder's other facts of the same type. */
function clearPrimaryOfType(holder: FactHolder, type: string | undefined, exceptId: string | undefined): void {
  for (const f of holder.facts ?? []) {
    if (f.id !== exceptId && f.type === type && "primary" in f) delete f.primary;
  }
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
  household?: HouseholdChecklist;
  action?: "skipped_no_parent_in_tree";
  /** false when the op verifiably left the tree untouched (the
   *  add_household_children no-op paths) — the caller may skip the write. */
  mutated?: boolean;
}

async function applyOperation(
  tree: SimplifiedGedcomX,
  input: TreeEditInput,
): Promise<AppliedOperation> {
  const assignedIds: AssignedIds = {};
  const warnings: string[] = [];
  const wantResolve = input.resolveStandardPlace !== false;

  // Resolve a fact's standard_place in place when it has a place and no explicit
  // standard_place; best-effort — never fail the edit on a resolution miss.
  const maybeResolvePlace = async (fact: SimplifiedFact, explicitStandardPlace: boolean): Promise<void> => {
    if (!wantResolve || !fact.place || explicitStandardPlace) return;
    try {
      fact.standard_place = (await resolveStandardPlace(fact.place)) ?? undefined;
      if (fact.standard_place === undefined) delete fact.standard_place;
    } catch {
      delete fact.standard_place;
      warnings.push(`could not resolve standard_place for '${fact.place}' (left unset)`);
    }
  };

  switch (input.operation) {
    case "add_fact": {
      // Target is a person OR an existing Couple relationship (a Marriage
      // fact lives on the Couple, not duplicated onto each spouse).
      const holder = requireFactHolder(tree, input, "add_fact");
      if (!input.fact) throw new TreeEditError("add_fact requires a `fact`");
      if (input.fact.id) throw new TreeEditError("add_fact `fact` must not carry an id — the tool assigns it");
      requireFactShape(input.fact, "add_fact");
      const fact: SimplifiedFact = { ...input.fact, id: nextId(tree, "F") };
      await maybeResolvePlace(fact, input.fact.standard_place !== undefined);
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
      for (const [k, v] of Object.entries(input.fact)) {
        if (k === "id") continue;
        (existing as any)[k] = v;
      }
      if (input.fact.place !== undefined) await maybeResolvePlace(existing, input.fact.standard_place !== undefined);
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
      for (const [k, v] of Object.entries(input.name)) {
        if (k === "id") continue;
        (existing as any)[k] = v;
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
          f.id = nextId(tree, "F");
          await maybeResolvePlace(f, f.standard_place !== undefined);
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
      tree.relationships = [...(tree.relationships ?? []), rel];
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
          f.id = nextId(tree, "F");
          await maybeResolvePlace(f, f.standard_place !== undefined);
          factIds.push(f.id);
        }
        assignedIds.facts = factIds;
      }
      assignedIds.relationship = rel.id;
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
    case "add_household_children": {
      // Record-extraction §5d, internalized: match the record's parents
      // against the tree, dedup the record's children tolerantly, create
      // stubs + ParentChild edges for the rest — one transaction, checklist
      // out. Spec: tree-edit-tool-spec.md §4.4.
      const parents = requireHouseholdMembers(input.parents, "parents");
      const children = requireHouseholdMembers(input.children, "children");

      // 1. Match parents — first match in persons order; two inputs hitting
      // the same tree person collapse to one (edges are per distinct parent).
      const parentsMatched: { name: string; id: string }[] = [];
      const matchedParentIds: string[] = [];
      for (const p of parents) {
        const hit = (tree.persons ?? []).find(
          (tp) => tp && typeof tp.id === "string" && personMatchesMember(tp, p.member, p.gender),
        );
        if (hit && hit.id && !matchedParentIds.includes(hit.id)) {
          matchedParentIds.push(hit.id);
          parentsMatched.push({ name: p.name, id: hit.id });
        }
      }
      if (matchedParentIds.length === 0) {
        return {
          assignedIds,
          warnings,
          action: "skipped_no_parent_in_tree",
          household: {
            parentsMatched: [],
            created: [],
            skipped: children.map((c) => ({ name: c.name, reason: "no_parent_in_tree" })),
            edgesAdded: 0,
          },
          mutated: false,
        };
      }

      // Existing children of the matched parents, via ParentChild edges.
      const matchedParentSet = new Set(matchedParentIds);
      const existingChildIds = new Set<string>();
      for (const r of tree.relationships ?? []) {
        if (
          r &&
          r.type === "ParentChild" &&
          typeof r.parent === "string" &&
          matchedParentSet.has(r.parent) &&
          typeof r.child === "string"
        ) {
          existingChildIds.add(r.child);
        }
      }

      // 2 + 3. Dedup each child against the LIVE tree (so an in-request
      // duplicate dedups against the stub just created), then stub + edges.
      const created: { name: string; id: string }[] = [];
      const skipped: { name: string; reason: string; id?: string }[] = [];
      const createdPersonIds: string[] = [];
      const createdEdgeIds: string[] = [];
      for (const c of children) {
        const childOfParent = (tree.persons ?? []).find(
          (tp) =>
            tp && typeof tp.id === "string" && existingChildIds.has(tp.id) && personMatchesMember(tp, c.member, c.gender),
        );
        if (childOfParent) {
          skipped.push({ name: c.name, reason: "already_child_of_parent", id: childOfParent.id });
          continue;
        }
        const anywhere = (tree.persons ?? []).find(
          (tp) => tp && typeof tp.id === "string" && personMatchesMember(tp, c.member, c.gender),
        );
        if (anywhere) {
          skipped.push({ name: c.name, reason: "person_exists_in_tree", id: anywhere.id });
          continue;
        }
        // The established stub shape: gender + ONE preferred BirthName —
        // NO facts, no ark (simplified-gedcomx-spec.md §4.6). The record's
        // facts live on the per-sibling assertions in research.json.
        const personId = nextId(tree, "I");
        const name: SimplifiedName = { id: nextId(tree, "N"), type: "BirthName", preferred: true };
        if (typeof c.member.given === "string" && c.member.given.trim() !== "") name.given = c.member.given;
        if (typeof c.member.surname === "string" && c.member.surname.trim() !== "") name.surname = c.member.surname;
        tree.persons = [...(tree.persons ?? []), { id: personId, gender: c.gender, names: [name] }];
        created.push({ name: c.name, id: personId });
        createdPersonIds.push(personId);
        for (const parentId of matchedParentIds) {
          const relId = nextId(tree, "R");
          tree.relationships = [
            ...(tree.relationships ?? []),
            { id: relId, type: "ParentChild", parent: parentId, child: personId },
          ];
          createdEdgeIds.push(relId);
        }
      }

      if (createdPersonIds.length > 0) {
        assignedIds.persons = createdPersonIds;
        assignedIds.relationships = createdEdgeIds;
      }
      return {
        assignedIds,
        warnings,
        household: { parentsMatched, created, skipped, edgesAdded: createdEdgeIds.length },
        mutated: createdPersonIds.length > 0,
      };
    }
    case "remove": {
      if (input.personId) {
        throw new TreeEditError("remove does not delete persons — use merge_tree_persons to collapse a person");
      }
      const targets = [input.factId, input.relationshipId].filter(Boolean);
      if (targets.length !== 1) {
        throw new TreeEditError("remove requires exactly one of `factId` or `relationshipId`");
      }
      if (input.factId) {
        let found = false;
        for (const p of tree.persons ?? []) {
          const before = (p.facts ?? []).length;
          if (before) {
            p.facts = p.facts!.filter((f) => f.id !== input.factId);
            if (p.facts.length !== before) found = true;
          }
        }
        for (const r of tree.relationships ?? []) {
          const before = (r.facts ?? []).length;
          if (before) {
            r.facts = r.facts!.filter((f) => f.id !== input.factId);
            if (r.facts.length !== before) found = true;
          }
        }
        if (!found) throw new TreeEditError(`fact '${input.factId}' not found in tree`);
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

/** Shared core behind `tree_edit` and `tree_correct` — identical batched-op,
 *  id-assignment, validate-on-write, and `.bak` semantics; only the admitted
 *  op set (the gate) differs. */
export async function executeTreeOps(input: TreeEditInput, gate: OpGate): Promise<TreeEditResult> {
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
  input.parents = coerceJsonArg(input.parents) as HouseholdMemberInput[] | undefined;
  input.children = coerceJsonArg(input.children) as HouseholdMemberInput[] | undefined;

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

    const treePath = join(projectPath, "tree.gedcomx.json");

    // ─── Batch form: apply every op in-memory, then validate + write once ─────
    if (input.ops !== undefined) {
      if (!Array.isArray(input.ops) || input.ops.length === 0) {
        return { ok: false, errors: ["`ops` must be a non-empty array"] };
      }
      const results: PerOpResult[] = [];
      const opWarnings: string[] = [];
      let anyMutated = false;
      for (let i = 0; i < input.ops.length; i++) {
        const op = input.ops[i];
        try {
          gateOperation(op?.operation, gate);
          const applied = await applyOperation(tree, { ...op, projectPath });
          opWarnings.push(...applied.warnings);
          if (applied.mutated !== false) anyMutated = true;
          const r: PerOpResult = { operation: op.operation };
          if (Object.keys(applied.assignedIds).length > 0) r.assignedIds = applied.assignedIds;
          if (applied.household) r.household = applied.household;
          if (applied.action) r.action = applied.action;
          results.push(r);
        } catch (e) {
          if (e instanceof TreeEditError) {
            // Identify the failing op; nothing has been written.
            return { ok: false, errors: [`ops[${i}]: ${e.message}`] };
          }
          throw e;
        }
      }

      // Every op verifiably left the tree untouched (add_household_children
      // no-op paths) → nothing to validate or write.
      if (!anyMutated) {
        return {
          ok: true,
          results,
          filesWritten: [],
          validation: { valid: true, warnings: opWarnings },
        };
      }

      const validation = await validateParsed(research, tree, { projectPath });
      if (!validation.valid) {
        return { ok: false, errors: formatIssues(validation.errors) };
      }
      await backupIfExists(treePath);
      await atomicWriteJson(treePath, tree);
      return {
        ok: true,
        results,
        filesWritten: ["tree.gedcomx.json"],
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
    const applied = await applyOperation(tree, input);
    const { assignedIds, warnings } = applied;

    // A verifiable no-op (add_household_children skip paths) writes nothing.
    if (applied.mutated === false) {
      const result: TreeEditResult = {
        ok: true,
        operation: input.operation,
        filesWritten: [],
        validation: { valid: true, warnings },
      };
      if (Object.keys(assignedIds).length > 0) result.assignedIds = assignedIds;
      if (applied.household) result.household = applied.household;
      if (applied.action) result.action = applied.action;
      return result;
    }

    const validation = await validateParsed(research, tree, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    await backupIfExists(treePath);
    await atomicWriteJson(treePath, tree);

    const result: TreeEditResult = {
      ok: true,
      operation: input.operation,
      filesWritten: ["tree.gedcomx.json"],
      validation: {
        valid: true,
        warnings: [...sanitized.warnings, ...formatIssues(validation.warnings), ...warnings],
      },
    };
    if (Object.keys(assignedIds).length > 0) result.assignedIds = assignedIds;
    if (applied.household) result.household = applied.household;
    return result;
  } catch (e) {
    if (e instanceof TreeEditError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const treeEditSchema = {
  name: "tree_edit",
  description:
    "Add to the project's tree.gedcomx.json — add a fact or name, add a person or " +
    "relationship, add a source, or add a household's children as sibling stubs. " +
    "ADDITIVE ONLY: corrections and removals " +
    "(update_fact/update_name/update_person/update_source/remove) live in the " +
    "tree_correct tool. add_fact targets a person (personId) or an existing Couple " +
    "relationship (relationshipId) — a Marriage/Divorce fact lives on the Couple, " +
    "never duplicated onto each spouse. Use merge_record_into_tree / " +
    "merge_tree_persons to fold in a record or collapse duplicate persons (this " +
    "tool never deletes a person).\n" +
    "\n" +
    "Pick the `operation` and supply the content (snake_case simplified-GedcomX " +
    "fields) WITHOUT ids — the tool assigns the next F/N/I/R/S id, swaps the " +
    "primary/preferred flag, resolves standard_place for a place, validates the " +
    "whole project, and writes only tree.gedcomx.json (with a one-deep .bak). " +
    "Returns a compact summary (the assigned ids); on a validation failure nothing " +
    "is written and `{ ok: false, errors }` is returned. Run check-warnings after " +
    "for genealogical-plausibility checks.\n" +
    "\n" +
    "add_household_children takes the RECORD's household roster — `parents` and " +
    "`children` arrays of { given, surname, gender } — and does the rest itself: " +
    "matches the parents against tree persons (tolerant of Wm/William-class name " +
    "variants), skips children already in the tree, creates minimal stubs for the " +
    "rest (gender + one preferred BirthName, never facts) with a ParentChild edge " +
    "to every matched parent, and returns a checklist { parentsMatched, created, " +
    "skipped, edgesAdded } to relay. No parent in the tree → " +
    "{ ok: true, action: 'skipped_no_parent_in_tree' }, nothing written. Never " +
    "pre-check the tree yourself — list who is on the record and let the tool " +
    "match and dedup.\n" +
    "\n" +
    "To make several edits at once (e.g. a source plus sibling stubs), pass an `ops` " +
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
          "add_household_children",
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
          "Set `primary: true` to make it the primary of its type.",
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
      source: {
        type: "object",
        description: "The source description to add (full, no id — the tool assigns the next S id). Fields: `title` (required), optional `author`, `url`, `citation` — a plain top-level entry, so no place resolution or primary/preferred handling applies. This is the lightweight tree sources[] entry, distinct from the rich research.json source. To refine an existing S entry, use tree_correct's update_source.",
      },
      parents: {
        type: "array",
        description:
          "add_household_children: the record's parent roles (head_of_household, wife, " +
          "father_of_*, mother_of_*) as the RECORD names them — the tool matches them " +
          "against tree persons.",
        items: {
          type: "object",
          properties: {
            given: { type: "string" },
            surname: { type: "string" },
            gender: { type: "string", description: "Male/Female/Unknown (M/F/U accepted)." },
          },
          required: ["gender"],
        },
      },
      children: {
        type: "array",
        description:
          "add_household_children: the record's child_N roles (the subject included — " +
          "the tool skips anyone already in the tree).",
        items: {
          type: "object",
          properties: {
            given: { type: "string" },
            surname: { type: "string" },
            gender: { type: "string", description: "Male/Female/Unknown (M/F/U accepted)." },
          },
          required: ["gender"],
        },
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
                "add_household_children",
              ],
              description: "The addition to perform. Corrections/removals: use tree_correct.",
            },
            personId: { type: "string" },
            relationshipId: { type: "string" },
            fact: { type: "object" },
            name: { type: "object" },
            person: { type: "object" },
            relationship: { type: "object" },
            source: { type: "object" },
            parents: { type: "array", items: { type: "object" } },
            children: { type: "array", items: { type: "object" } },
            resolveStandardPlace: { type: "boolean" },
          },
          required: ["operation"],
        },
      },
    },
    required: ["projectPath"],
  },
};
