// The write-once starting-tree.gedcomx.json baseline: the tree as the project
// began, before any run added a person. research_append and materialize_facts
// both read it to tell a pre-existing person from one a run minted, so it lives
// here rather than in either tool.

import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import { getProjectStore } from "../store/project-store.js";

/** Read the write-once starting-tree.gedcomx.json baseline, or null when it is
 *  absent or unreadable. Fail-open by design: legacy projects created before the
 *  baseline shipped have no such file, and a tree-encoding WARNING must never
 *  block a completion for a project that simply predates it. */
export async function readStartingTree(projectPath: string): Promise<SimplifiedGedcomX | null> {
  try {
    const raw = await getProjectStore().readText(projectPath, "starting-tree.gedcomx.json");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SimplifiedGedcomX) : null;
  } catch {
    return null;
  }
}

/** The ids of the persons in a baseline, or an empty set when there is none.
 *  Array.isArray, not `?? []`: `readStartingTree` is fail-open for a read or
 *  parse failure but returns any parsed object as-is, so a baseline whose
 *  `persons` is not an array reached `.map` and threw a raw TypeError out of
 *  `researchAppend` -- not a ResearchAppendError, and from `prepareOps`, so it
 *  killed every call including ones with no person_evidence op at all. */
export function startingPersonIdsOf(baseline: SimplifiedGedcomX | null): ReadonlySet<string> {
  return new Set(
    ((Array.isArray(baseline?.persons) ? baseline.persons : []) as any[])
      .map((p: any) => p?.id)
      .filter((id: any): id is string => typeof id === "string" && id !== ""),
  );
}
