/**
 * Smoke-test the merge_warnings tool against a real project on disk.
 *
 *   npx tsx dev/try-merge-warnings.ts <projectPath> <candidateJsonPath> <treeId=candidateId> [<treeId=candidateId> ...]
 *
 * Example:
 *   npx tsx dev/try-merge-warnings.ts \
 *     ~/projects/flynn \
 *     ./record.json \
 *     LZ1-ABC=1:1:68Q9-K34P MNO-2=1:1:68Q9-XYZ
 *
 * <candidateJsonPath> is a file holding a simplified-GedcomX document (the
 * `gedcomx` field of a record_read result). Each pair is `treeId=candidateId`
 * (`=` delimiter, since FamilySearch ids contain colons). Writes nothing —
 * prints the warnings JSON.
 */
import { readFileSync } from "node:fs";
import { mergeWarnings } from "../src/tools/merge-warnings.js";

const [projectPath, candidatePath, ...pairArgs] = process.argv.slice(2);
if (!projectPath || !candidatePath || pairArgs.length === 0) {
  console.error(
    "Usage: npx tsx dev/try-merge-warnings.ts <projectPath> <candidateJsonPath> <treeId:candidateId> [...]",
  );
  process.exit(1);
}

const candidateGedcomx = JSON.parse(readFileSync(candidatePath, "utf-8"));
const merges = pairArgs.map((p) => {
  const idx = p.indexOf("=");
  if (idx <= 0) {
    console.error(`Bad pair "${p}" — expected <treeId>=<candidateId>`);
    process.exit(1);
  }
  return [p.slice(0, idx), p.slice(idx + 1)] as [string, string];
});

try {
  const result = await mergeWarnings({ projectPath, candidateGedcomx, merges });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
