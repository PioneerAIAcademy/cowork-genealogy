// tree_edit — single-entity ad-hoc mutations of tree.gedcomx.json.
//
// The sibling of the merge tools: where those collapse persons, this one does
// the add/correct/remove edits the tree-edit skill performs by hand today. It
// reuses the shipped write layer (atomicWriteJson, backupIfExists, validateParsed)
// and the shared id allocator, so the LLM passes only the content judgment and
// the tool does id assignment, the primary/preferred swaps, standard_place
// resolution, validate-before-persist, and the atomic write. Writes only
// tree.gedcomx.json. Spec: docs/specs/tree-edit-tool-spec.md.

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
import type { ValidationError } from "../validation/types.js";
import { atomicWriteJson, backupIfExists } from "../utils/project-io.js";
import { maxIdNum, nextId } from "../utils/gedcomx-ids.js";
import { resolveStandardPlace } from "../utils/place-resolver.js";

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
  | "remove";

export interface TreeEditInput {
  projectPath: string;
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
  /** Auto-resolve standard_place when a place is set (default true). */
  resolveStandardPlace?: boolean;
}

interface AssignedIds {
  person?: string;
  fact?: string;
  name?: string;
  relationship?: string;
  source?: string;
  names?: string[];
}

export type TreeEditResult =
  | {
      ok: true;
      operation: TreeEditOperation;
      assignedIds?: AssignedIds;
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    }
  | { ok: false; errors: string[] };

class TreeEditError extends Error {}

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

/** Remove the `primary` flag from the person's other facts of the same type. */
function clearPrimaryOfType(person: SimplifiedPerson, type: string | undefined, exceptId: string | undefined): void {
  for (const f of person.facts ?? []) {
    if (f.id !== exceptId && f.type === type && f.primary) delete f.primary;
  }
}

/** Remove the `preferred` flag from the person's other names. */
function clearPreferred(person: SimplifiedPerson, exceptId: string | undefined): void {
  for (const n of person.names ?? []) {
    if (n.id !== exceptId && n.preferred) delete n.preferred;
  }
}

async function applyOperation(
  tree: SimplifiedGedcomX,
  input: TreeEditInput,
): Promise<{ assignedIds: AssignedIds; warnings: string[] }> {
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
      const person = requirePerson(tree, input.personId);
      if (!input.fact) throw new TreeEditError("add_fact requires a `fact`");
      if (input.fact.id) throw new TreeEditError("add_fact `fact` must not carry an id — the tool assigns it");
      const fact: SimplifiedFact = { ...input.fact, id: nextId(tree, "F") };
      await maybeResolvePlace(fact, input.fact.standard_place !== undefined);
      if (fact.primary === true) clearPrimaryOfType(person, fact.type, fact.id);
      person.facts = [...(person.facts ?? []), fact];
      assignedIds.fact = fact.id;
      break;
    }
    case "update_fact": {
      const person = requirePerson(tree, input.personId);
      if (!input.factId) throw new TreeEditError("update_fact requires a `factId`");
      if (!input.fact) throw new TreeEditError("update_fact requires `fact` fields to set");
      const existing = (person.facts ?? []).find((f) => f.id === input.factId);
      if (!existing) throw new TreeEditError(`fact '${input.factId}' not found on person '${input.personId}'`);
      for (const [k, v] of Object.entries(input.fact)) {
        if (k === "id") continue;
        (existing as any)[k] = v;
      }
      if (input.fact.place !== undefined) await maybeResolvePlace(existing, input.fact.standard_place !== undefined);
      if (existing.primary === true) clearPrimaryOfType(person, existing.type, existing.id);
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
      assignedIds.person = personId;
      assignedIds.names = names.map((n) => n.id!).filter(Boolean);
      break;
    }
    case "add_relationship": {
      if (!input.relationship) throw new TreeEditError("add_relationship requires a `relationship`");
      if (input.relationship.id) throw new TreeEditError("add_relationship `relationship` must not carry an id");
      const rel: SimplifiedRelationship = { ...input.relationship, id: nextId(tree, "R") };
      tree.relationships = [...(tree.relationships ?? []), rel];
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
  const { projectPath, operation } = input;
  try {
    const tree = (await readJson(projectPath, "tree.gedcomx.json")) as SimplifiedGedcomX;
    const research = await readJson(projectPath, "research.json");

    const { assignedIds, warnings } = await applyOperation(tree, input);

    const validation = await validateParsed(research, tree, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    const treePath = join(projectPath, "tree.gedcomx.json");
    await backupIfExists(treePath);
    await atomicWriteJson(treePath, tree);

    const result: TreeEditResult = {
      ok: true,
      operation,
      filesWritten: ["tree.gedcomx.json"],
      validation: { valid: true, warnings: [...formatIssues(validation.warnings), ...warnings] },
    };
    if (Object.keys(assignedIds).length > 0) result.assignedIds = assignedIds;
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
    "Make a single ad-hoc edit to the project's tree.gedcomx.json — add or correct " +
    "a fact or name, add a person or relationship, add or correct a source, or remove " +
    "a fact/relationship on a tier downgrade. Use this for direct corrections; use " +
    "merge_record_into_tree / merge_tree_persons to fold in a record or collapse " +
    "duplicate persons (this tool never deletes a person).\n" +
    "\n" +
    "Pick the `operation` and supply the content (snake_case simplified-GedcomX " +
    "fields) WITHOUT ids — the tool assigns the next F/N/I/R/S id, swaps the " +
    "primary/preferred flag, resolves standard_place for a place, validates the " +
    "whole project, and writes only tree.gedcomx.json (with a one-deep .bak). " +
    "Returns a compact summary (the assigned ids); on a validation failure nothing " +
    "is written and `{ ok: false, errors }` is returned. Run check-warnings after " +
    "for genealogical-plausibility checks.",
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
          "update_fact",
          "add_name",
          "update_name",
          "update_person",
          "add_person",
          "add_relationship",
          "add_source",
          "update_source",
          "remove",
        ],
        description: "The edit to perform.",
      },
      personId: {
        type: "string",
        description: "Target person id — for add_fact, add_name, update_fact, update_name, update_person.",
      },
      factId: { type: "string", description: "Target fact id — for update_fact and remove." },
      nameId: { type: "string", description: "Target name id — for update_name." },
      relationshipId: { type: "string", description: "Target relationship id — for remove." },
      sourceId: { type: "string", description: "Target source id — for update_source." },
      fact: {
        type: "object",
        description: "The fact to add (full, no id) or the fields to set (update_fact). Set `primary: true` to make it the primary of its type.",
      },
      name: {
        type: "object",
        description: "The name to add (full, no id) or fields to set (update_name). Set `preferred: true` to make it the preferred name.",
      },
      person: {
        type: "object",
        description: "The person to add (gender + at least one name; no ids — the tool assigns I and N ids). Omit `ark` for a synthesized stub.",
      },
      relationship: {
        type: "object",
        description: "The relationship to add (no id). Use `parent`/`child` for ParentChild, `person1`/`person2` for Couple; endpoints must be existing person ids.",
      },
      source: {
        type: "object",
        description: "The source description to add (full, no id — the tool assigns the next S id) or the fields to set (update_source). Fields: `title` (required on add), optional `author`, `url`, `citation` — a plain top-level entry, so no place resolution or primary/preferred handling applies. This is the lightweight tree sources[] entry, distinct from the rich research.json source.",
      },
      gender: { type: "string", description: "update_person: new gender (Male/Female/Unknown)." },
      ark: { type: "string", description: "update_person: the FamilySearch ARK to set." },
      resolveStandardPlace: {
        type: "boolean",
        description: "Default true: auto-resolve standard_place when a fact place is set. Pass false to skip the lookup.",
      },
    },
    required: ["projectPath", "operation"],
  },
};
