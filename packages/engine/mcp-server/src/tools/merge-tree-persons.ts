// merge_tree_persons — collapse two persons already in the project tree.
//
// Mode 2 of the merge core (utils/merge-gedcomx.ts): reads tree.gedcomx.json
// and research.json fresh from disk, folds each collapsed person into its
// survivor within the single tree, repoints every research.json person-id
// reference collapsed→survivor, validates the would-be project, and writes both
// files both-or-neither. Use case: two persons (e.g. two fathers) that were
// kept separate turn out to be the same. Spec: merge-gedcomx-spec.md §5b.

import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import { mergeGedcomx } from "../utils/merge-gedcomx.js";
import { validateIntroduced } from "../validation/introduced-errors.js";
import { checkWarningGate } from "./tree-edit.js";
import { atomicWriteBoth, withProjectLock } from "../utils/project-io.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import {
  MergeInputError,
  readProjectJson,
  derivePairSummaries,
  personMapByIds,
  remapResearchPersonIds,
  formatIssues,
  NoProjectError,
  noProjectResult,
} from "./merge-shared.js";
import type { MergeResult } from "./merge-shared.js";
import {
  mergeCarryRefusals,
  mergeNamesakeRefusals,
  pidOrStartingPerson,
} from "./research-append.js";
import { readStartingTree, startingPersonIdsOf } from "../utils/starting-tree.js";

export interface MergeTreePersonsInput {
  projectPath: string;
  merges: Array<[string, string]>;
  warningJustifications?: Array<{ warningId: string; justification: string }>;
}

export async function mergeTreePersons(
  input: MergeTreePersonsInput,
): Promise<MergeResult> {
  const { projectPath } = input;
  const merges = (input.merges ?? []) as Array<[string, string]>;

  // Serialize the read-modify-write against every other writer on this project
  // (issue #1715) — writes tree + research together, so the per-project lock is
  // what keeps a concurrent tree-only writer from clobbering half of it.
  return withProjectLock(projectPath, async () => {
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
    // Snapshot research before the in-place person-id remap: block only on
    // errors this merge introduces, not pre-existing drift (#1572). The
    // pre-merge `tree` is the before-tree; `merged` is the after-tree.
    const beforeResearch = structuredClone(research);
    const researchRefsUpdated = remapResearchPersonIds(research, collapseMap);

    // 5. Validate the would-be project (remapped research + merged tree) before
    //    any write.
    const validation = await validateIntroduced({ research: beforeResearch, tree }, { research, tree: merged }, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    // 5a. The pair and namesake checks (issue #3363), on the project before
    //     the merge and before the warning gate, so a caller is never asked to
    //     justify warnings for a merge that is then refused.
    const startingPersonIds = startingPersonIdsOf(await readStartingTree(projectPath));
    const before = { research: beforeResearch, tree };
    const refusals = [
      ...joinedPairRefusals(tree, merges),
      ...survivorOrderRefusals(merges, startingPersonIds),
      ...mergeNamesakeRefusals(before, merges, startingPersonIds),
      ...mergeCarryRefusals(before, merges, startingPersonIds),
    ];
    if (refusals.length > 0) return { ok: false, errors: refusals };

    // 5b. Warning gate: refuse if the merge introduces unjustified warnings.
    //     Pass collapseMap so pre-existing warnings on collapsed persons are
    //     matched against their survivor and not read as introduced.
    const mergeGateResult = await checkWarningGate(
      tree, merged, research, projectPath,
      input.warningJustifications, "merge_tree_persons",
      collapseMap,
    );
    if (mergeGateResult && "ok" in mergeGateResult) return mergeGateResult;

    // 6. Derive the compact summary.
    const pairs = derivePairSummaries(merges, preSurvivors, preCollapsed, merged);

    // 7. Persist both files both-or-neither. Order [tree, research] matches
    //    the documented residual window.
    await atomicWriteBoth(projectPath, [
      { ref: "tree.gedcomx.json", data: merged },
      { ref: "research.json", data: research },
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
    if (e instanceof NoProjectError) return noProjectResult();
    if (e instanceof MergeInputError) return { ok: false, errors: [e.message] };
    throw e;
  }
  });
}

/** Part 2: a pair a Couple or ParentChild relationship joins. The merge would
 *  make it a self-relationship and drop it with its facts and sources, in any
 *  project, with or without a namesake row. */
export function joinedPairRefusals(tree: SimplifiedGedcomX, merges: Array<[string, string]>): string[] {
  const lines: string[] = [];
  for (const [s, c] of merges) {
    for (const r of tree.relationships ?? []) {
      const ends = r.type === "ParentChild" ? [r.parent, r.child] : r.type === "Couple" ? [r.person1, r.person2] : [];
      if (!ends.includes(s) || !ends.includes(c)) continue;
      lines.push(
        `relationship '${r.id}' (${r.type}) joins '${ends[0]}' and '${ends[1]}', a pair in this merge: merging ` +
          "them would turn it into a self-relationship and drop it, with its facts and sources.",
      );
    }
  }
  if (lines.length === 0) return [];
  return [
    ...lines,
    "Two people a relationship joins are not one person. If they are, remove that relationship with " +
      "tree_correct (operation 'remove', relationshipId) and merge again; otherwise do not merge.",
  ];
}

/** A pair that would fold a FamilySearch or starting-tree person into one made
 *  during the run. The survivor keeps its id, and that id is what tells every
 *  later check the person was not made from one record. */
export function survivorOrderRefusals(
  merges: Array<[string, string]>,
  startingPersonIds: ReadonlySet<string>,
): string[] {
  const lines = merges
    .filter(([s, c]) => pidOrStartingPerson(c, startingPersonIds) && !pidOrStartingPerson(s, startingPersonIds))
    .map(
      ([s, c]) =>
        `pair ['${s}', '${c}'] would fold '${c}', a FamilySearch or starting-tree person, into '${s}', which is neither.`,
    );
  if (lines.length === 0) return [];
  return [...lines, "Write each listed pair the other way round, so the FamilySearch or starting-tree person survives."];
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
    "person_evidence, rejected_links, timelines, known_holdings, proof_summaries, namesakes) is " +
    "repointed to the survivor. A merge is refused when a relationship joins the pair, " +
    "when it would fold a FamilySearch or starting-tree person into one made during the " +
    "run, or when it would move a link, or carry a record's data, under a recorded " +
    "namesake with nothing in that record tying it to the person. " +
    "Both files are written both-or-neither and NOT returned — you get a compact " +
    "summary including how many research references were updated. On a validation " +
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
    required: ["projectPath", "merges"],
  },
};
