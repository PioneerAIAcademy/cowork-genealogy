// A merge the user instructed (Decision 13 of docs/plan/conclusion-tree.md): when
// the only warnings are that no identity claim covers a pair, the user's
// instruction is the justification. Any other warning still refuses. Tests that
// pin the identity warning itself call the tool directly.
import { mergeTreePersons as mergeRaw } from "../../src/tools/merge-tree-persons.js";

type Input = Parameters<typeof mergeRaw>[0];

export async function instructedMerge(input: Input): ReturnType<typeof mergeRaw> {
  const r: any = await mergeRaw(input);
  if (r?.ok !== false || r.reason !== "unjustified_warnings" || input.warningJustifications !== undefined) return r;
  const warnings: any[] = Array.isArray(r.warnings) ? r.warnings : [];
  if (warnings.length === 0 || !warnings.every((w) => w?.issueType === "mergeIdentity")) return r;
  return mergeRaw({
    ...input,
    warningJustifications: warnings.map((w) => ({ warningId: w.warningId, justification: "The user instructed this merge." })),
  });
}
