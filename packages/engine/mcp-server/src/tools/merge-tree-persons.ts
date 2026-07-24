// merge_tree_persons — collapse two persons already in the project tree.
//
// Mode 2 of the merge core (utils/merge-gedcomx.ts): reads tree.gedcomx.json
// and research.json fresh from disk, folds each collapsed person into its
// survivor within the single tree, repoints every research.json person-id
// reference collapsed→survivor, validates the would-be project, and writes both
// files both-or-neither. Use case: two persons (e.g. two fathers) that were
// kept separate turn out to be the same. Spec: merge-gedcomx-spec.md §5b.

import { join } from "path";
import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import { mergeGedcomx } from "../utils/merge-gedcomx.js";
import { validateParsed } from "../validation/validator.js";
import { atomicWriteBoth } from "../utils/project-io.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import {
  MergeInputError,
  readProjectJson,
  derivePairSummaries,
  personMapByIds,
  remapResearchPersonIds,
  backupIfExists,
  formatIssues,
} from "./merge-shared.js";
import type { MergeResult } from "./merge-shared.js";

export interface MergeTreePersonsInput {
  projectPath: string;
  merges: Array<[string, string]>;
}

export async function mergeTreePersons(
  input: MergeTreePersonsInput,
): Promise<MergeResult> {
  const { projectPath } = input;
  const merges = (input.merges ?? []) as Array<[string, string]>;

  try {
    // 1. Read both files fresh from disk.
    const treeSanitized = sanitizeTree(
      await readProjectJson(projectPath, "tree.gedcomx.json"),
    );
    const tree = treeSanitized.tree;
    const research = await readProjectJson(projectPath, "research.json");

    // 2. Capture pre-merge persons (both sides live in the one tree) for the
    //    summary, before the merge consumes them.
    const survivorIds = merges.map(([s]) => s);
    const collapsedIds = merges.map(([, c]) => c);
    const preSurvivors = personMapByIds(tree.persons, survivorIds);
    const preCollapsed = personMapByIds(tree.persons, collapsedIds);

    // 3. Merge in memory. The core throws on empty/duplicate/chained/unknown
    //    merges and on a survivor id absent from the on-disk tree.
    let merged: SimplifiedGedcomX;
    try {
      merged = mergeGedcomx(tree, null, merges);
    } catch (e) {
      return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
    }

    // 4. Repoint research.json person-id references collapsed→survivor.
    const collapseMap = new Map<string, string>();
    for (const [s, c] of merges) collapseMap.set(c, s);
    const researchRefsUpdated = remapResearchPersonIds(research, collapseMap);

    // 5. Validate the would-be project (remapped research + merged tree) before
    //    any write.
    const validation = await validateParsed(research, merged, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    // 6. Derive the compact summary.
    const pairs = derivePairSummaries(merges, preSurvivors, preCollapsed, merged);

    // 7. Persist both files both-or-neither, after backing up both. Order
    //    [tree, research] matches the documented residual window.
    const treePath = join(projectPath, "tree.gedcomx.json");
    const researchPath = join(projectPath, "research.json");
    await backupIfExists(treePath);
    await backupIfExists(researchPath);
    await atomicWriteBoth([
      { path: treePath, data: merged },
      { path: researchPath, data: research },
    ]);

    return {
      ok: true,
      filesWritten: ["tree.gedcomx.json", "research.json"],
      pairs,
      newRelatives: [],
      researchRefsUpdated,
      validation: {
        valid: true,
        warnings: [...treeSanitized.warnings, ...formatIssues(validation.warnings)],
      },
    };
  } catch (e) {
    if (e instanceof MergeInputError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const mergeTreePersonsSchema = {
  name: "merge_tree_persons",
  description:
    "Collapse two (or more) persons that already exist in the project tree into " +
    "one, when they turn out to be the same person. Use this when both people " +
    "are already in tree.gedcomx.json (e.g. two father records that were never " +
    "merged).\n" +
    "\n" +
    "`merges` is a list of `[survivorId, collapsedId]` pairs (both ids in the " +
    "tree): the survivor is kept, the collapsed person folds into it " +
    "(names/facts merged, never discarded) and is removed; relationships are " +
    "repointed. Every research.json reference to a collapsed id (subject persons, " +
    "person_evidence, timelines, known_holdings) is repointed to the survivor. " +
    "Both files are written both-or-neither and NOT returned — you get a compact " +
    "summary including how many research references were updated. One-deep " +
    ".bak backups of both files are written before the overwrite. On a validation " +
    "failure nothing is written and `{ ok: false, errors }` is returned.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the project directory holding tree.gedcomx.json and " +
          "research.json.",
      },
      merges: {
        type: "array",
        description:
          "Pairs of `[survivorId, collapsedId]` to collapse — both must be " +
          "`persons[].id` values in the on-disk tree. The survivor is kept; the " +
          "collapsed person folds into it. An id may not be both a survivor and " +
          "a collapsed id (chains are not supported).",
        items: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2,
        },
      },
    },
    required: ["projectPath", "merges"],
  },
};
