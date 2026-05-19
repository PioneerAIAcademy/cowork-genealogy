/**
 * Smoke-test for the `tree` MCP tool against the live FamilySearch API.
 *
 * Usage:
 *   npx tsx dev/try-tree.ts KNDX-MKG                       # person only
 *   npx tsx dev/try-tree.ts KNDX-MKG --relatives           # person + family
 *   npx tsx dev/try-tree.ts KNDX-MKG --sources             # person + sources
 *   npx tsx dev/try-tree.ts KNDX-MKG --relatives --sources # everything
 */
import { treeTool } from "../src/tools/tree.js";

const personId = process.argv[2];
if (!personId) {
  console.error(
    "Usage: npx tsx dev/try-tree.ts <personId> [--relatives] [--sources]",
  );
  process.exit(1);
}

const relatives = process.argv.includes("--relatives");
const sourceDescriptions = process.argv.includes("--sources");

const result = await treeTool({ personId, relatives, sourceDescriptions });
console.log(JSON.stringify(result, null, 2));
