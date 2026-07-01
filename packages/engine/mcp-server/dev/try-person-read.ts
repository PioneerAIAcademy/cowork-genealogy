/**
 * Smoke-test for the `person_read` MCP tool against the live FamilySearch API.
 *
 * Usage:
 *   npx tsx dev/try-person-read.ts KNDX-MKG                       # person only
 *   npx tsx dev/try-person-read.ts KNDX-MKG --relatives           # person + family
 *   npx tsx dev/try-person-read.ts KNDX-MKG --sources             # person + sources
 *   npx tsx dev/try-person-read.ts KNDX-MKG --relatives --sources # everything
 */
import { personReadTool } from "../src/tools/person-read.js";

const personId = process.argv[2];
if (!personId) {
  console.error(
    "Usage: npx tsx dev/try-person-read.ts <personId> [--relatives] [--sources]",
  );
  process.exit(1);
}

const relatives = process.argv.includes("--relatives");
const sourceDescriptions = process.argv.includes("--sources");

const result = await personReadTool({ personId, relatives, sourceDescriptions });
console.log(JSON.stringify(result, null, 2));
