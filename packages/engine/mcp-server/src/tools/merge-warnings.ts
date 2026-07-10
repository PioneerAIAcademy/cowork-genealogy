// merge_warnings — merge-mode ("what-if") warnings for a proposed merge.
//
// Read-only analog of merge_record_into_tree (utils/merge-gedcomx.ts Mode 1):
// reads tree.gedcomx.json fresh, folds the candidate record into the named
// survivors IN MEMORY via the SAME pure mergeGedcomx, then — instead of
// writing — runs the merge-mode warning checks (warnings.java's
// getWarnings(target, candidate, merged, isFinalWarnings=false)) on each pair
// and returns the warnings. Writes nothing.
//
// Gate-validity invariant: merge_warnings and merge_record_into_tree call the
// identical mergeGedcomx with the identical `merges` shape, so the dry-run
// merged mob is byte-for-byte the persisted merge — that equivalence is what
// makes the coherence gate trustworthy. Spec: match-merge-workflow-spec.md §7.

import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import type {
  MergeWarningsInput,
  MergeWarningsResult,
} from "../types/merge-warnings.js";
import type { PersonWarning } from "../types/person-warnings.js";
import { mergeGedcomx } from "../utils/merge-gedcomx.js";
import { validateParsed } from "../validation/validator.js";
import { Mob } from "../utils/mob.js";
import { calculateWarnings } from "./person-warnings.js";
import {
  MergeInputError,
  readProjectJson,
  sanitizeCandidate,
  validateCandidateGedcomx,
  formatIssues,
} from "./merge-shared.js";

export async function mergeWarnings(
  input: MergeWarningsInput,
): Promise<MergeWarningsResult> {
  const { projectPath } = input;
  const merges = (input.merges ?? []) as Array<[string, string]>;

  try {
    // 1. Read the tree fresh (same as merge_record_into_tree, so the dry-run
    //    sees exactly the state a real merge would).
    const tree = (await readProjectJson(
      projectPath,
      "tree.gedcomx.json",
    )) as SimplifiedGedcomX;

    // 2. Sanitize + validate the inline candidate exactly as the write path
    //    does — the dry-run must merge the same document the writer would.
    const { candidate } = sanitizeCandidate(input.candidateGedcomx);
    const candidateErrors = validateCandidateGedcomx(candidate);
    if (candidateErrors.length > 0) {
      return { ok: false, errors: candidateErrors };
    }

    // 3. Merge in memory with the SAME core the write path uses. The core
    //    throws on empty/duplicate/unknown/chained merges and on a survivor id
    //    absent from the on-disk tree — surface those as errors (the gate wants
    //    to know the proposed merge is malformed).
    let merged: SimplifiedGedcomX;
    try {
      merged = mergeGedcomx(tree, candidate, merges);
    } catch (e) {
      return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
    }

    // 3b. Validate the would-be project exactly as merge_record_into_tree does
    //     before writing, so the dry-run is a complete preview: a merge the
    //     writer would reject is surfaced here as { ok: false } rather than
    //     reported as clean. research.json is read but never written.
    const research = await readProjectJson(projectPath, "research.json");
    const validation = await validateParsed(research, merged, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    // 4. For each pair, build target (pre-merge tree person), candidate
    //    (pre-merge record persona), and merged (post-all-merges survivor)
    //    mobs, and run the merge-mode checks. Dedupe identical warnings that
    //    several pairs surface on the shared merged family.
    const warnings: PersonWarning[] = [];
    const seen = new Set<string>();
    for (const [treeId, candidateId] of merges) {
      let targetMob: Mob;
      let candidateMob: Mob;
      let mergedMob: Mob;
      try {
        targetMob = new Mob(tree, treeId);
        candidateMob = new Mob(candidate, candidateId);
        mergedMob = new Mob(merged, treeId);
      } catch (e) {
        // mergeGedcomx already validated the ids; this is defensive.
        return {
          ok: false,
          errors: [e instanceof Error ? e.message : String(e)],
        };
      }
      for (const w of calculateWarnings(
        targetMob,
        candidateMob,
        mergedMob,
        /* isFinalWarnings */ false,
      )) {
        const key = `${w.issueType}|${w.personId}|${w.relatedPersonId ?? ""}|${w.severity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        warnings.push(w);
      }
    }

    return { ok: true, warningCount: warnings.length, warnings };
  } catch (e) {
    if (e instanceof MergeInputError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const mergeWarningsSchema = {
  name: "merge_warnings",
  description:
    "Dry-run the coherence checks for a proposed merge WITHOUT writing — the " +
    "merge-mode analog of `person_warnings`. Pass the same `candidateGedcomx` " +
    "and `merges` (`[treeId, candidateId]` pairs) you would hand " +
    "`merge_record_into_tree`; it merges in memory with the identical core and " +
    "returns the warnings the merge would introduce.\n" +
    "\n" +
    "Use this as the coherence gate before merging: a `severity: \"error\"` " +
    "warning (e.g. `hasSameCensus` — two personas sharing a census collection " +
    "cannot be the same person; or an event outside the other record's " +
    "lifespan) is a biological/temporal impossibility that should block the " +
    "merge and prompt you to revisit the match. A `severity: \"warning\"` is " +
    "advisory. Returns `{ warningCount, warnings }` (each warning carries " +
    "`issueType`, `severity`, `personId`, `message`, and an optional `mobRole`). " +
    "On a malformed merge (unknown/duplicate ids, stale survivor) it returns " +
    "`{ ok: false, errors }`. Writes nothing; research.json and " +
    "tree.gedcomx.json are untouched.",
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
          "The record being merged, as a simplified-GedcomX document — the " +
          "`gedcomx` field of a `record_read` result, passed through verbatim.",
      },
      merges: {
        type: "array",
        description:
          "Pairs of `[treeId, candidateId]` that would be collapsed. The treeId " +
          "(a `persons[].id` in the on-disk tree, including any stub you just " +
          "added) survives; the candidateId (a `persons[].id` in " +
          "candidateGedcomx) folds into it.",
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
