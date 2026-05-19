/**
 * Smoke-test for the `tree_read` MCP tool against the live FamilySearch API.
 *
 * Usage:
 *   npx tsx dev/try-tree-read.ts KNDX-MKG                       # person only
 *   npx tsx dev/try-tree-read.ts KNDX-MKG --relatives           # person + family
 *   npx tsx dev/try-tree-read.ts KNDX-MKG --sources             # person + sources
 *   npx tsx dev/try-tree-read.ts KNDX-MKG --relatives --sources # everything
 */
import { treeReadTool } from "../src/tools/tree-read.js";

const personId = process.argv[2];
if (!personId) {
  console.error(
    "Usage: npx tsx dev/try-tree-read.ts <personId> [--relatives] [--sources]",
  );
  process.exit(1);
}

const relatives = process.argv.includes("--relatives");
const sourceDescriptions = process.argv.includes("--sources");

const result = await treeReadTool({ personId, relatives, sourceDescriptions });
console.log(JSON.stringify(result, null, 2));
