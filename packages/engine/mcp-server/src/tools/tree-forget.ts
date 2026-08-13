// tree_forget — remove known information from tree.gedcomx.json so the agent
// must re-derive it from records.
//
// The engine behind the forget-and-rederive skill. A researcher who wants to
// know whether the agent can really *do* the research seeds a project from a
// well-documented FamilySearch person — at which point the answer is already in
// the local tree and "research" degrades to reading it back. This removes a
// chosen slice so the question becomes real again.
//
// Two rules shape the whole design (spec §2.1, §3.1):
//
//   1. It selects STRUCTURALLY, never by name. The caller passes
//      `{selector: "parents-of", personId: "I3"}`, not "remove Robert Smith";
//      the tool walks the tree's relationships to find the ids itself.
//   2. It reports COUNTS AND KINDS, never values. This result lands in the
//      context of the agent that is about to go looking for exactly this
//      information — printing what went would put the answer straight back and
//      make the exercise pointless. The researcher verifies in the viewer.
//
// Stripping the local copy is only half the mechanism: live FamilySearch still
// has the answer, so the agent must also be told not to look it up. That
// instruction lives in SKILL.md.
//
// Deliberately NOT part of tree_correct: that tool's `remove` never deletes a
// person, and that restriction is load-bearing for allowlist-enforceable write
// authority. Spec: docs/specs/tree-forget-tool-spec.md.

import { join } from "path";
import type {
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedFact,
  SimplifiedRelationship,
} from "../types/gedcomx.js";
import { validateParsed } from "../validation/validator.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import { atomicWriteJson, readProjectJson, fileExists } from "../utils/project-io.js";
import { formatIssues } from "./merge-shared.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import { getStandardDate } from "../utils/fact-helpers.js";
import { earliestYear, latestYear } from "../utils/date-helpers.js";

/** The pre-removal snapshot. Dot-prefixed on purpose — it still holds the
 *  answer, and both the agent's file browsing and the feedback bundler skip
 *  dot-prefixed entries. See spec §5. */
export const RESTORE_FILE = ".tree-before-forget.gedcomx.json";

export type ForgetSelectorKind =
  | "parents-of"
  | "children-of"
  | "spouses-of"
  | "birth-of"
  | "death-of"
  | "facts-of"
  | "facts-before"
  | "facts-after"
  | "facts-between"
  | "person"
  | "fact"
  | "relationship";

const SELECTOR_KINDS: ReadonlySet<string> = new Set<ForgetSelectorKind>([
  "parents-of",
  "children-of",
  "spouses-of",
  "birth-of",
  "death-of",
  "facts-of",
  "facts-before",
  "facts-after",
  "facts-between",
  "person",
  "fact",
  "relationship",
]);

export interface ForgetSelector {
  selector: ForgetSelectorKind;
  personId?: string;
  factType?: string;
  factId?: string;
  relationshipId?: string;
  /** facts-before/facts-after: the year threshold. */
  year?: number;
  /** facts-between: the inclusive range bounds. */
  fromYear?: number;
  toYear?: number;
}

export interface TreeForgetInput {
  projectPath: string;
  forget?: ForgetSelector[];
  dryRun?: boolean;
}

export interface TreeForgetRemoved {
  persons: number;
  relationships: number;
  relationshipsCascaded: number;
  factsByType: Record<string, number>;
}

export type TreeForgetResult =
  | {
      ok: true;
      dryRun: boolean;
      removed: TreeForgetRemoved;
      remaining: { persons: number; relationships: number };
      filesWritten: string[];
      restoreFile: string | null;
      validation: { valid: true; warnings: string[] };
    }
  | { ok: false; errors: string[] };

/** A user-correctable problem: bad selector, unknown id, nothing to remove,
 *  or an unreadable project file. Anything else propagates. */
class TreeForgetError extends Error {}

/** readProjectJson's two expected failures, mapped onto the user-correctable
 *  class so they surface as `{ ok: false, errors }` rather than as a throw. */
async function readJson(projectPath: string, filename: string): Promise<any> {
  try {
    return await readProjectJson(projectPath, filename);
  } catch (e) {
    throw new TreeForgetError(e instanceof Error ? e.message : String(e));
  }
}

// ─── tree helpers ────────────────────────────────────────────────────────────

const persons = (tree: SimplifiedGedcomX): SimplifiedPerson[] => tree.persons ?? [];
const relationships = (tree: SimplifiedGedcomX): SimplifiedRelationship[] =>
  tree.relationships ?? [];

/** The two person ids a relationship connects, whatever its type. */
function endpoints(rel: SimplifiedRelationship): string[] {
  return rel.type === "ParentChild"
    ? [rel.parent ?? "", rel.child ?? ""]
    : [rel.person1 ?? "", rel.person2 ?? ""];
}

function requirePerson(tree: SimplifiedGedcomX, personId: string | undefined, sel: string): string {
  if (!personId) throw new TreeForgetError(`'${sel}' requires personId`);
  if (!persons(tree).some((p) => p.id === personId)) {
    throw new TreeForgetError(
      `no person '${personId}' in tree.gedcomx.json. Use the tree's own person id ` +
        `(the \`id\` field), not a FamilySearch PID unless they happen to match.`,
    );
  }
  return personId;
}

/**
 * (related person ids, relationship ids) for one structural relation.
 * Returns ids only — never names, which is the whole point.
 */
function relatives(
  tree: SimplifiedGedcomX,
  personId: string,
  kind: "parents" | "children" | "spouses",
): { people: Set<string>; rels: Set<string> } {
  const people = new Set<string>();
  const rels = new Set<string>();
  for (const rel of relationships(tree)) {
    const rid = rel.id ?? "";
    if (kind === "parents" || kind === "children") {
      if (rel.type !== "ParentChild") continue;
      const parent = rel.parent ?? "";
      const child = rel.child ?? "";
      if (kind === "parents" && child === personId) {
        people.add(parent);
        rels.add(rid);
      } else if (kind === "children" && parent === personId) {
        people.add(child);
        rels.add(rid);
      }
    } else {
      if (rel.type === "ParentChild") continue;
      const [p1, p2] = [rel.person1 ?? "", rel.person2 ?? ""];
      if (p1 === personId || p2 === personId) {
        people.add(p1 === personId ? p2 : p1);
        rels.add(rid);
      }
    }
  }
  return { people, rels };
}

function factIdsOfType(
  tree: SimplifiedGedcomX,
  personId: string,
  factType: string,
): Set<string> {
  const person = persons(tree).find((p) => p.id === personId);
  const wanted = factType.toLowerCase();
  return new Set(
    (person?.facts ?? [])
      .filter((f) => (f.type ?? "").toLowerCase() === wanted && f.id)
      .map((f) => f.id as string),
  );
}

function personOwnsFact(tree: SimplifiedGedcomX, personId: string, factId: string): boolean {
  const person = persons(tree).find((p) => p.id === personId);
  return (person?.facts ?? []).some((f) => f.id === factId);
}

/** A person and a relationship are two different id spaces — nothing in the
 *  tree or its validator guarantees they stay disjoint (a relationship's own
 *  id is never checked against person ids). factKey below carries this so an
 *  id shared across the two spaces can't collide the same way a bare factId
 *  did across persons (#1574). */
type OwnerKind = "person" | "relationship";

interface FactOwner {
  kind: OwnerKind;
  id: string;
}

/**
 * Every person or relationship whose facts array contains a fact with this
 * literal id. FamilySearch does not guarantee a fact id is unique across
 * persons (#1574) — more than one owner here is the collision this function
 * exists to surface, not a bug in this function.
 */
function findFactOwners(tree: SimplifiedGedcomX, factId: string): FactOwner[] {
  const owners: FactOwner[] = [];
  for (const p of persons(tree)) {
    if ((p.facts ?? []).some((f) => f.id === factId)) owners.push({ kind: "person", id: p.id ?? "" });
  }
  for (const r of relationships(tree)) {
    if ((r.facts ?? []).some((f) => f.id === factId)) {
      owners.push({ kind: "relationship", id: r.id ?? "" });
    }
  }
  return owners;
}

/**
 * Whether a resolved fact's id ALSO exists on some OTHER owner not being
 * touched by this call — a heads-up that the id is not unique, not a sign
 * anything is wrong; removal is already correctly scoped to (ownerKind,
 * ownerId) regardless (#1574). Null when the id is unique to this owner.
 */
function noteIfFactShared(
  tree: SimplifiedGedcomX,
  ownerKind: OwnerKind,
  ownerId: string,
  factId: string,
  label: string,
): string | null {
  const others = findFactOwners(tree, factId).filter(
    (o) => !(o.kind === ownerKind && o.id === ownerId),
  );
  if (others.length === 0) return null;
  const named = others.map((o) => `${o.id} (${o.kind})`).join(", ");
  return `${label} fact '${factId}' also exists on: ${named}`;
}

/** noteIfFactShared over a batch of ids resolved for one person — the
 *  `birth-of`/`death-of`/`facts-of` shape, where every id shares one owner. */
function notesSharedFactIds(
  tree: SimplifiedGedcomX,
  pid: string,
  ids: Iterable<string>,
  label: string,
): string[] {
  const notices: string[] = [];
  for (const f of ids) {
    const notice = noteIfFactShared(tree, "person", pid, f, label);
    if (notice) notices.push(notice);
  }
  return notices;
}

/**
 * Encodes an (ownerKind, ownerId, factId) triple as one Set entry.
 * JSON-encoded so no delimiter choice can collide with a real id's own
 * content. ownerKind is load-bearing, not decoration: a person and a
 * relationship can share a literal id (nothing checks the two id spaces
 * against each other), so (ownerId, factId) alone would silently reunite the
 * exact cross-owner leak this scoping exists to prevent, just across a
 * different pair of fields (#1574).
 */
function factKey(ownerKind: OwnerKind, ownerId: string, factId: string): string {
  return JSON.stringify([ownerKind, ownerId, factId]);
}

// ─── date-range selectors (#1574) ───────────────────────────────────────────
//
// `forget-and-rederive/SKILL.md` tells the agent NOT to read tree.gedcomx.json
// — the file holds the very answer it is about to go looking for. A date
// cutoff like "before 1850" therefore has to resolve to fact ids INSIDE the
// tool, never by the agent reading dates itself. These three selectors are
// that resolution: the year the caller passes is their own input, not tree
// data, so echoing it back in an error is not a redaction violation; a fact's
// OWN date value is never read into anything the caller receives.

interface DatedFact {
  ownerKind: OwnerKind;
  ownerId: string;
  fact: SimplifiedFact;
  earliest: number;
  latest: number;
}

/**
 * Every fact in scope that has a parseable date, with its earliest/latest
 * possible year. Scoped to one person's own facts when personId is given,
 * or every person AND relationship in the tree otherwise (the "tree-wide
 * variant" #1574 asks for). `skipped` counts facts in scope whose date
 * could not be parsed at all — they never match any date predicate, and the
 * caller is told the count (not which facts) so a dry run's silence about
 * them is never mistaken for "there were none."
 */
function datedFacts(
  tree: SimplifiedGedcomX,
  personId: string | undefined,
): { entries: DatedFact[]; skipped: number } {
  const entries: DatedFact[] = [];
  let skipped = 0;
  const consider = (ownerKind: OwnerKind, ownerId: string, facts: SimplifiedFact[] | undefined) => {
    for (const fact of facts ?? []) {
      // An id-less fact could never be targeted by factKey (its id would
      // collapse to the same "" as every other id-less fact on this owner),
      // so it must never become a match candidate here either — the same
      // guard factIdsOfType already applies for birth-of/facts-of. Not
      // currently reachable (validate-before-persist requires every fact to
      // carry an id), but this keeps the two resolution paths' guarantees
      // identical rather than relying on that being true forever.
      if (!fact.id) {
        skipped += 1;
        continue;
      }
      const std = getStandardDate(fact);
      const earliest = std === null ? null : earliestYear(std);
      const latest = std === null ? null : latestYear(std);
      if (earliest === null || latest === null) {
        skipped += 1;
        continue;
      }
      entries.push({ ownerKind, ownerId, fact, earliest, latest });
    }
  };
  if (personId !== undefined) {
    consider("person", personId, persons(tree).find((p) => p.id === personId)?.facts);
  } else {
    for (const p of persons(tree)) consider("person", p.id ?? "", p.facts);
    for (const r of relationships(tree)) consider("relationship", r.id ?? "", r.facts);
  }
  return { entries, skipped };
}

function requireYear(value: unknown, sel: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TreeForgetError(`'${sel}' requires a numeric ${field}`);
  }
  return value;
}

// ─── selector resolution ─────────────────────────────────────────────────────

interface Targets {
  persons: Set<string>;
  /** (ownerKind, ownerId, factId) triples, each encoded by factKey.
   *  Owner-scoped so a fact id FamilySearch handed to more than one person
   *  (#1574) is only ever removed from the owner a selector actually
   *  resolved. */
  facts: Set<string>;
  relationships: Set<string>;
  /** Advisory only — removal above is already correctly scoped regardless.
   *  One entry per resolved fact (birth-of/death-of/facts-of) whose literal
   *  id ALSO exists on a different owner not being touched by this call
   *  (#1574). */
  factSharingNotices: string[];
}

function resolveSelectors(tree: SimplifiedGedcomX, forget: ForgetSelector[]): Targets {
  const t: Targets = {
    persons: new Set(),
    facts: new Set(),
    relationships: new Set(),
    factSharingNotices: [],
  };

  for (let i = 0; i < forget.length; i++) {
    const entry = forget[i];
    if (typeof entry !== "object" || entry === null) {
      throw new TreeForgetError(`forget[${i}] must be an object`);
    }
    const kind = entry.selector;
    if (!SELECTOR_KINDS.has(kind)) {
      throw new TreeForgetError(
        `forget[${i}]: unknown selector '${kind}'. Valid: ${[...SELECTOR_KINDS].join(", ")}`,
      );
    }

    switch (kind) {
      case "parents-of":
      case "children-of":
      case "spouses-of": {
        const pid = requirePerson(tree, entry.personId, kind);
        const relation = (
          { "parents-of": "parents", "children-of": "children", "spouses-of": "spouses" } as const
        )[kind];
        const { people, rels } = relatives(tree, pid, relation);
        if (people.size === 0 && rels.size === 0) {
          throw new TreeForgetError(
            `'${kind}' matched nothing — ${pid} has no ${relation} in the tree, ` +
              `so there is nothing to forget.`,
          );
        }
        people.forEach((p) => t.persons.add(p));
        rels.forEach((r) => t.relationships.add(r));
        break;
      }
      case "birth-of":
      case "death-of": {
        const pid = requirePerson(tree, entry.personId, kind);
        const factType = kind === "birth-of" ? "Birth" : "Death";
        const ids = factIdsOfType(tree, pid, factType);
        if (ids.size === 0) {
          throw new TreeForgetError(
            `'${kind}' matched nothing — ${pid} has no ${factType} fact.`,
          );
        }
        ids.forEach((f) => t.facts.add(factKey("person", pid, f)));
        t.factSharingNotices.push(...notesSharedFactIds(tree, pid, ids, factType));
        break;
      }
      case "facts-of": {
        const pid = requirePerson(tree, entry.personId, kind);
        const factType = (entry.factType ?? "").trim();
        if (!factType) {
          throw new TreeForgetError("'facts-of' requires factType (e.g. Marriage, Residence)");
        }
        const ids = factIdsOfType(tree, pid, factType);
        if (ids.size === 0) {
          throw new TreeForgetError(
            `'facts-of' matched nothing — ${pid} has no ${factType} fact.`,
          );
        }
        ids.forEach((f) => t.facts.add(factKey("person", pid, f)));
        t.factSharingNotices.push(...notesSharedFactIds(tree, pid, ids, factType));
        break;
      }
      case "facts-before":
      case "facts-after":
      case "facts-between": {
        // personId is OPTIONAL here — omitted means tree-wide, the variant
        // #1574 asks for alongside the person-scoped form. `!== undefined`,
        // not a truthy check: an explicitly-passed personId: "" must still
        // reach requirePerson's own "requires personId" error, the same as
        // every mandatory-personId selector already gives it — not silently
        // read as "omitted" and fall through to a full tree-wide sweep on
        // what is otherwise a destructive tool (found by review).
        const pid =
          entry.personId !== undefined ? requirePerson(tree, entry.personId, kind) : undefined;

        let matches: (earliest: number, latest: number) => boolean;
        let label: string;
        if (kind === "facts-before") {
          const year = requireYear(entry.year, kind, "year");
          // Confident match only: the fact's LATEST possible year must be
          // before the threshold, or a date that might actually be at/after
          // it would be swept by a selector named "before" — the same
          // over-broad-removal shape #1574 exists to eliminate, just moved
          // from id-collision onto date uncertainty.
          matches = (_earliest, latest) => latest < year;
          label = `before ${year}`;
        } else if (kind === "facts-after") {
          const year = requireYear(entry.year, kind, "year");
          matches = (earliest, _latest) => earliest > year;
          label = `after ${year}`;
        } else {
          const fromYear = requireYear(entry.fromYear, kind, "fromYear");
          const toYear = requireYear(entry.toYear, kind, "toYear");
          if (fromYear > toYear) {
            throw new TreeForgetError(`'facts-between' requires fromYear <= toYear`);
          }
          // Confident match: the fact's entire possible range must fit
          // inside [fromYear, toYear], not merely overlap it.
          matches = (earliest, latest) => earliest >= fromYear && latest <= toYear;
          label = `between ${fromYear} and ${toYear}`;
        }

        const { entries, skipped } = datedFacts(tree, pid);
        const matched = entries.filter((e) => matches(e.earliest, e.latest));
        if (matched.length === 0) {
          throw new TreeForgetError(
            `'${kind}' matched nothing${pid ? ` for ${pid}` : ""} — no fact's date is ` +
              `confidently ${label}.`,
          );
        }
        for (const m of matched) {
          const factId = m.fact.id ?? "";
          t.facts.add(factKey(m.ownerKind, m.ownerId, factId));
          // The fact's own type here, not the predicate label — consistent
          // with birth-of/facts-of's notices, and reads naturally ("Residence
          // fact ... also exists on"), whereas the predicate belongs in the
          // "matched nothing" error above, where restating it explains why.
          const notice = noteIfFactShared(
            tree,
            m.ownerKind,
            m.ownerId,
            factId,
            m.fact.type ?? "Unknown",
          );
          if (notice) t.factSharingNotices.push(notice);
        }
        if (skipped > 0) {
          t.factSharingNotices.push(
            `${skipped} fact(s) in scope had no parseable date and were not ` +
              `considered for '${kind}'.`,
          );
        }
        break;
      }
      case "person": {
        t.persons.add(requirePerson(tree, entry.personId, kind));
        break;
      }
      case "fact": {
        if (!entry.factId) throw new TreeForgetError("'fact' requires factId");
        const factId = entry.factId;
        if (entry.personId !== undefined) {
          // Caller named the owner explicitly — the only way to disambiguate
          // a factId FamilySearch handed to more than one person (#1574).
          // `!== undefined`, not a truthy check: personId: "" must still
          // reach requirePerson's error rather than silently falling through
          // to the ambiguous-owner path below (found by review).
          const pid = requirePerson(tree, entry.personId, kind);
          if (!personOwnsFact(tree, pid, factId)) {
            throw new TreeForgetError(
              `'fact' factId '${factId}' does not belong to person '${pid}'.`,
            );
          }
          t.facts.add(factKey("person", pid, factId));
        } else {
          const owners = findFactOwners(tree, factId);
          if (owners.length > 1) {
            const named = owners.map((o) => `${o.id} (${o.kind})`).join(", ");
            throw new TreeForgetError(
              `'fact' factId '${factId}' exists on more than one owner: ${named} — ` +
                `add personId to target whichever one is a person.`,
            );
          }
          // owners.length === 0 uses the "" sentinel: no real owner has that
          // id, so applyForget's existing "not in the tree" check still
          // fires below, unchanged. owners.length === 1 resolves unambiguously,
          // carrying its real kind so it can't be confused with a same-id
          // owner of the other kind.
          const owner = owners[0];
          t.facts.add(factKey(owner?.kind ?? "person", owner?.id ?? "", factId));
        }
        break;
      }
      case "relationship": {
        if (!entry.relationshipId) {
          throw new TreeForgetError("'relationship' requires relationshipId");
        }
        t.relationships.add(entry.relationshipId);
        break;
      }
    }
  }
  return t;
}

// ─── the removal ─────────────────────────────────────────────────────────────

/**
 * Remove the targets in place, cascading relationships off removed persons.
 * Returns the redacted summary — how many of what kind went, never a value.
 */
function applyForget(tree: SimplifiedGedcomX, t: Targets): TreeForgetRemoved {
  // A removed person takes every relationship touching them, or the tree is
  // left with links pointing at people who no longer exist.
  const cascaded = new Set(
    relationships(tree)
      .filter((r) => endpoints(r).some((id) => t.persons.has(id)))
      .map((r) => r.id ?? ""),
  );
  const deadRels = new Set([...t.relationships, ...cascaded]);

  const keptPersons = persons(tree).filter((p) => !t.persons.has(p.id ?? ""));
  const removedPersons = persons(tree).length - keptPersons.length;

  const keptRels = relationships(tree).filter((r) => !deadRels.has(r.id ?? ""));
  const removedRels = relationships(tree).length - keptRels.length;

  // Facts live on persons and on Couple relationships alike.
  const factsByType: Record<string, number> = {};
  const unmatched = new Set(t.facts);

  const pruneFacts = (ownerKind: OwnerKind) => (owner: { id?: string; facts?: SimplifiedFact[] }): void => {
    if (owner.facts === undefined) return;
    const ownerId = owner.id ?? "";
    owner.facts = owner.facts.filter((f) => {
      const fid = f.id ?? "";
      const key = factKey(ownerKind, ownerId, fid);
      if (!t.facts.has(key)) return true;
      const ftype = f.type ?? "Unknown";
      factsByType[ftype] = (factsByType[ftype] ?? 0) + 1;
      unmatched.delete(key);
      return false;
    });
  };
  keptPersons.forEach(pruneFacts("person"));
  keptRels.forEach(pruneFacts("relationship"));

  // A fact selector can target a fact whose owner is ALSO being wholesale-
  // removed by a person/relationship selector in the same call (e.g. `person:
  // I1` + `fact: <I1's own Birth fact>`). pruneFacts only ever visits KEPT
  // owners, so that fact's key is never touched above — but the request is
  // already satisfied, since the owner and everything on it is going away
  // regardless. Treating it as "not in the tree" would be wrong: the fact
  // unambiguously existed the instant before this call. Not counted in
  // factsByType either, consistent with a removed owner's OTHER facts, which
  // were never individually counted to begin with.
  for (const key of [...unmatched]) {
    const [ownerKind, ownerId] = JSON.parse(key) as [OwnerKind, string, string];
    const ownerAlsoRemoved =
      (ownerKind === "person" && t.persons.has(ownerId)) ||
      (ownerKind === "relationship" && deadRels.has(ownerId));
    if (ownerAlsoRemoved) unmatched.delete(key);
  }

  if (unmatched.size > 0) {
    // t.facts holds factKey-encoded (ownerKind, ownerId, factId) triples —
    // decode back to the bare factId for the message, matching the
    // pre-#1574 wording.
    const danglingFactIds = [...unmatched].map((k) => JSON.parse(k)[2] as string);
    throw new TreeForgetError(
      `these fact ids are not in the tree: ${danglingFactIds.sort().join(", ")}`,
    );
  }

  tree.persons = keptPersons;
  tree.relationships = keptRels;

  return {
    persons: removedPersons,
    relationships: removedRels,
    relationshipsCascaded: [...cascaded].filter((r) => !t.relationships.has(r)).length,
    factsByType,
  };
}

// ─── entry point ─────────────────────────────────────────────────────────────

export async function treeForget(input: TreeForgetInput): Promise<TreeForgetResult> {
  const { projectPath } = input;
  const dryRun = input.dryRun === true;

  // Recover an array the model serialized as a JSON string (see coerceJsonArg)
  // before any shape check, so a correct-but-stringified payload isn't rejected.
  const forget = coerceJsonArg(input.forget) as ForgetSelector[] | undefined;

  try {
    if (!Array.isArray(forget) || forget.length === 0) {
      return { ok: false, errors: ["`forget` must be a non-empty array of selectors"] };
    }

    const raw = await readJson(projectPath, "tree.gedcomx.json");
    // The pre-removal snapshot, taken before both the heal and the removal so
    // it reproduces the file exactly as it sits on disk. applyForget mutates in
    // place, so this has to be a copy, not a reference. (JSON round-trip rather
    // than structuredClone: the value came from JSON.parse, so it is faithful.)
    const original = JSON.parse(JSON.stringify(raw));

    // Heal legacy shapes before anything touches the document — the closed tree
    // shapes would otherwise refuse the write on a pre-tightening tree, with no
    // selector able to express the repair.
    const sanitized = sanitizeTree(raw);
    const tree = sanitized.tree;
    const research = await readJson(projectPath, "research.json");

    const targets = resolveSelectors(tree, forget);
    const removed = applyForget(tree, targets);

    // Validate the WHOLE project before persisting. The realistic failure is a
    // dangling person reference from research.json (person_evidence,
    // subject_person_ids, timelines, known holdings) — this tool does not
    // repair those, by design, so the error names them and the caller decides.
    const validation = await validateParsed(research, tree, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    const result: TreeForgetResult = {
      ok: true,
      dryRun,
      removed,
      remaining: { persons: persons(tree).length, relationships: relationships(tree).length },
      filesWritten: [],
      restoreFile: null,
      // factSharingNotices resolved against the PRE-removal tree (targets was
      // built before applyForget mutated it), which is the only point a fact
      // still on its "other" owner is visible to check for (#1574).
      validation: {
        valid: true,
        warnings: [...sanitized.warnings, ...targets.factSharingNotices],
      },
    };
    if (dryRun) return result;

    // Snapshot the pre-removal tree — but only if there isn't one already, so
    // the restore point keeps pointing at the ORIGINAL rather than at an
    // already-forgotten intermediate (spec §5). No `.bak`: backupIfExists would
    // write a non-dot-prefixed copy of the answer, which is the one thing the
    // dot-prefix exists to prevent.
    const restorePath = join(projectPath, RESTORE_FILE);
    if (!(await fileExists(restorePath))) {
      await atomicWriteJson(restorePath, original);
    }

    await atomicWriteJson(join(projectPath, "tree.gedcomx.json"), tree);

    result.filesWritten = ["tree.gedcomx.json"];
    result.restoreFile = RESTORE_FILE;
    return result;
  } catch (e) {
    if (e instanceof TreeForgetError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const treeForgetSchema = {
  name: "tree_forget",
  description:
    "Set up a practice run: remove information the researcher already has from " +
    "the project's tree.gedcomx.json so it must be re-derived from records. " +
    "This is the ONLY tool that deletes tree persons outright (tree_correct's " +
    "remove never does, and merge_tree_persons collapses duplicates instead). " +
    "Use it only for the forget-and-rederive exercise — never to correct a " +
    "wrong fact (tree_correct) or to clean up a duplicate (merge_tree_persons).\n" +
    "\n" +
    "Selection is STRUCTURAL: pass tree person/fact/relationship ids and the " +
    "tool walks the tree's own relationships to resolve relatives. You do not " +
    "need to read — and are better off not reading — the names and dates you " +
    "are about to remove.\n" +
    "\n" +
    "The result reports COUNTS AND KINDS ONLY, never names, dates, or places: " +
    "printing the removed values would put the answer straight back into your " +
    "context and make the exercise worthless. The researcher confirms the gap " +
    "in the viewer. Do not restate removed values even if you know them.\n" +
    "\n" +
    "ALWAYS call with `dryRun: true` first and show the researcher the counts — " +
    "removing a person also removes every relationship touching them, so " +
    "forgetting a father can cut siblings, his own parents, and his marriage " +
    "(reported as `relationshipsCascaded`). Fact-level selectors (birth-of, " +
    "death-of, facts-of, facts-before, facts-after, facts-between, fact) " +
    "never cascade.\n" +
    "\n" +
    "FamilySearch does not guarantee a fact id is unique across owners. " +
    "Removal is always scoped correctly to the owner a selector resolved — " +
    "but if a resolved fact's id ALSO exists on a different owner not being " +
    "touched, `validation.warnings` says so (ids only, never a value). Not " +
    "an error; just tell the researcher.\n" +
    "\n" +
    "For a date-bounded request ('forget everything before 1850'), use " +
    "facts-before/facts-after/facts-between with a year, NOT your own reading " +
    "of tree.gedcomx.json's dates — the whole point of these selectors is " +
    "that the year threshold is your own input, never a value read off the " +
    "tree. Only a fact whose date is CONFIDENTLY inside the requested range " +
    "is removed; an uncertain or ranged date that only partly overlaps the " +
    "boundary is left alone rather than guessed. A fact with no parseable " +
    "date is never matched either; validation.warnings reports how many " +
    "were skipped this way (a count, not which ones).\n" +
    "\n" +
    "Validates the whole project before writing; on failure nothing is written " +
    "and `{ok: false, errors}` comes back — most often because research.json " +
    "still references a person being removed. A selector that matches nothing " +
    "is an error, not a no-op: read it as 'this was already forgotten'. " +
    "Writes tree.gedcomx.json plus a dot-prefixed restore file; NEVER read " +
    "that file — it still contains everything that was removed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the project directory holding tree.gedcomx.json and research.json.",
      },
      forget: {
        type: "array",
        description:
          "What to forget; one or more selectors, all applied to one in-memory tree " +
          "and written once (all-or-nothing).",
        items: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              enum: [
                "parents-of",
                "children-of",
                "spouses-of",
                "birth-of",
                "death-of",
                "facts-of",
                "facts-before",
                "facts-after",
                "facts-between",
                "person",
                "fact",
                "relationship",
              ],
              description:
                "parents-of/children-of/spouses-of: the person's relatives AND the links to " +
                "them (cascades). birth-of/death-of: that person's Birth/Death facts. " +
                "facts-of: that person's facts of one type (needs factType). " +
                "facts-before/facts-after: that person's facts confidently before/after a " +
                "year (needs year). facts-between: that person's facts confidently within " +
                "an inclusive year range (needs fromYear, toYear). All three date selectors " +
                "omit personId to apply tree-wide instead of to one person. person: one " +
                "person, cascading every relationship touching them. fact: one fact by id " +
                "(add personId if that id exists on more than one person). relationship: " +
                "one relationship by id.",
            },
            personId: {
              type: "string",
              description:
                "Tree person id (the `id` field, not a FamilySearch PID) — required for " +
                "parents-of, children-of, spouses-of, birth-of, death-of, facts-of, person. " +
                "Optional for fact: FamilySearch does not guarantee a fact id is unique " +
                "across persons, so pass this to say which person's copy to remove when " +
                "the tool reports the id exists on more than one. Optional for " +
                "facts-before/facts-after/facts-between: omit to apply tree-wide.",
            },
            factType: {
              type: "string",
              description:
                "Fact type for facts-of, e.g. Marriage or Residence. Matched case-insensitively.",
            },
            factId: { type: "string", description: "Fact id — required for the `fact` selector." },
            relationshipId: {
              type: "string",
              description: "Relationship id — required for the `relationship` selector.",
            },
            year: {
              type: "number",
              description:
                "Year threshold for facts-before (strictly before) or facts-after (strictly " +
                "after). Your own input, not a value read from the tree.",
            },
            fromYear: {
              type: "number",
              description: "facts-between: inclusive start year of the range.",
            },
            toYear: {
              type: "number",
              description: "facts-between: inclusive end year of the range. Must be >= fromYear.",
            },
          },
          required: ["selector"],
        },
      },
      dryRun: {
        type: "boolean",
        description:
          "Report what would go and write nothing. Always do this first and get the " +
          "researcher's agreement before applying — the cascade depends on the tree's " +
          "current shape, so a second forget's blast radius is not the first one's.",
      },
    },
    required: ["projectPath", "forget"],
  },
};
