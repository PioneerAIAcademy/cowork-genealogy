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

// ─── selector resolution ─────────────────────────────────────────────────────

interface Targets {
  persons: Set<string>;
  facts: Set<string>;
  relationships: Set<string>;
}

function resolveSelectors(tree: SimplifiedGedcomX, forget: ForgetSelector[]): Targets {
  const t: Targets = { persons: new Set(), facts: new Set(), relationships: new Set() };

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
        ids.forEach((f) => t.facts.add(f));
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
        ids.forEach((f) => t.facts.add(f));
        break;
      }
      case "person": {
        t.persons.add(requirePerson(tree, entry.personId, kind));
        break;
      }
      case "fact": {
        if (!entry.factId) throw new TreeForgetError("'fact' requires factId");
        t.facts.add(entry.factId);
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

  const pruneFacts = (owner: { facts?: SimplifiedFact[] }): void => {
    if (owner.facts === undefined) return;
    owner.facts = owner.facts.filter((f) => {
      const fid = f.id ?? "";
      if (!t.facts.has(fid)) return true;
      const ftype = f.type ?? "Unknown";
      factsByType[ftype] = (factsByType[ftype] ?? 0) + 1;
      unmatched.delete(fid);
      return false;
    });
  };
  keptPersons.forEach(pruneFacts);
  keptRels.forEach(pruneFacts);

  if (unmatched.size > 0) {
    throw new TreeForgetError(
      `these fact ids are not in the tree: ${[...unmatched].sort().join(", ")}`,
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
      validation: { valid: true, warnings: sanitized.warnings },
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
    "death-of, facts-of, fact) never cascade.\n" +
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
                "person",
                "fact",
                "relationship",
              ],
              description:
                "parents-of/children-of/spouses-of: the person's relatives AND the links to " +
                "them (cascades). birth-of/death-of: that person's Birth/Death facts. " +
                "facts-of: that person's facts of one type (needs factType). person: one " +
                "person, cascading every relationship touching them. fact/relationship: one " +
                "specific entity by id.",
            },
            personId: {
              type: "string",
              description:
                "Tree person id (the `id` field, not a FamilySearch PID) — required for " +
                "parents-of, children-of, spouses-of, birth-of, death-of, facts-of, person.",
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
