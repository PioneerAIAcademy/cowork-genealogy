// merge_record_into_tree — fold a candidate record into the project tree.
//
// Mode 1 of the merge core (utils/merge-gedcomx.ts): reads tree.gedcomx.json
// fresh from disk, folds the inline candidate record's paired persons into the
// named tree survivors (carrying unpaired candidate persons in as new
// relatives), validates the would-be project, and atomically writes ONLY
// tree.gedcomx.json. research.json is untouched — every target id is preserved
// and the candidate ids it does not reference. Spec: merge-gedcomx-spec.md §5b.

import { join } from "path";
import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import { mergeGedcomx } from "../utils/merge-gedcomx.js";
import { validateParsed } from "../validation/validator.js";
import { atomicWriteJson } from "../utils/project-io.js";
import {
  MergeInputError,
  readProjectJson,
  validateCandidateGedcomx,
  derivePairSummaries,
  personMapByIds,
  backupIfExists,
  formatIssues,
} from "./merge-shared.js";
import type { MergeResult } from "./merge-shared.js";

export interface MergeRecordIntoTreeInput {
  projectPath: string;
  candidateGedcomx: SimplifiedGedcomX;
  merges: Array<[string, string]>;
}

export async function mergeRecordIntoTree(
  input: MergeRecordIntoTreeInput,
): Promise<MergeResult> {
  const { projectPath } = input;
  const merges = (input.merges ?? []) as Array<[string, string]>;

  try {
    // 1. Read the tree fresh from disk (merges checked against current state).
    const tree = (await readProjectJson(
      projectPath,
      "tree.gedcomx.json",
    )) as SimplifiedGedcomX;

    // 2. Validate the inline candidate before merging anything.
    const candidateErrors = validateCandidateGedcomx(input.candidateGedcomx);
    if (candidateErrors.length > 0) {
      return { ok: false, errors: candidateErrors };
    }
    const candidate = input.candidateGedcomx;

    // 3. Merge in memory. The core throws on empty/duplicate/unknown merges and
    //    on a survivor id absent from the on-disk tree (a staleness signal).
    let merged: SimplifiedGedcomX;
    try {
      merged = mergeGedcomx(tree, candidate, merges);
    } catch (e) {
      return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
    }

    // 4. Validate the would-be project before any write. research.json is
    //    unchanged in Mode 1, but the validator needs it for cross-file checks.
    const research = await readProjectJson(projectPath, "research.json");
    const validation = await validateParsed(research, merged, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    // 5. Derive the compact summary from inputs + merged document.
    const survivorIds = merges.map(([s]) => s);
    const collapsedIds = merges.map(([, c]) => c);
    const pairs = derivePairSummaries(
      merges,
      personMapByIds(tree.persons, survivorIds),
      personMapByIds(candidate.persons, collapsedIds),
      merged,
    );
    const originalTargetIds = new Set((tree.persons ?? []).map((p) => p.id));
    const newRelatives = (merged.persons ?? [])
      .map((p) => p.id)
      .filter((id): id is string => id !== undefined && !originalTargetIds.has(id));

    // 6. Persist — back up the tree (irreversible overwrite), then write it.
    const treePath = join(projectPath, "tree.gedcomx.json");
    await backupIfExists(treePath);
    await atomicWriteJson(treePath, merged);

    return {
      ok: true,
      filesWritten: ["tree.gedcomx.json"],
      pairs,
      newRelatives,
      validation: { valid: true, warnings: formatIssues(validation.warnings) },
    };
  } catch (e) {
    if (e instanceof MergeInputError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const mergeRecordIntoTreeSchema = {
  name: "merge_record_into_tree",
  description:
    "Fold a candidate record (e.g. one just read with `record_read`) into the " +
    "project's tree.gedcomx.json, collapsing the person pairs you specify. Use " +
    "this after deciding (via `same_person` / proof reasoning) which people in " +
    "the record are the same as people already in the tree — typically " +
    "focus↔focus and likely father↔father, mother↔mother.\n" +
    "\n" +
    "`merges` is a list of `[treeId, candidateId]` pairs: the tree person's id " +
    "survives and the candidate person folds into it (names/facts merged, never " +
    "discarded). Unpaired candidate persons are carried in as new relatives with " +
    "fresh ids. The merged tree is written to disk and NOT returned — you get a " +
    "compact summary (per-pair name/fact counts, new-relative ids). research.json " +
    "is not modified. A one-deep tree.gedcomx.json.bak is written before the " +
    "overwrite. On a validation failure nothing is written and `{ ok: false, " +
    "errors }` is returned.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the project directory holding tree.gedcomx.json and " +
          "research.json.",
      },
      candidateGedcomx: {
        type: "object",
        description:
          "The record to fold in, as a simplified-GedcomX document — the " +
          "`gedcomx` field of a `record_read` result, passed through verbatim. " +
          "If you hold full GedcomX, convert it to simplified first.",
      },
      merges: {
        type: "array",
        description:
          "Pairs of `[treeId, candidateId]` to collapse. The treeId (a " +
          "`persons[].id` in the on-disk tree) survives; the candidateId (a " +
          "`persons[].id` in candidateGedcomx) folds into it.",
        items: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2,
        },
      },
    },
    required: ["projectPath", "candidateGedcomx", "merges"],
  },
};
