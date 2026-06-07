/**
 * Smoke-test for the `record_read` MCP tool against the live FamilySearch recapi.
 *
 * Usage:
 *   npx tsx dev/try-record-read.ts QVS9-DHDB
 *   npx tsx dev/try-record-read.ts "ark:/61903/1:1:QVS9-DHDB"
 */
import { recordReadTool } from "../src/tools/record-read.js";

const recordId = process.argv[2];
if (!recordId) {
  console.error(
    'Usage: npx tsx dev/try-record-read.ts <recordId>\n' +
      '  recordId can be a bare entity ID (e.g., QVS9-DHDB) or\n' +
      '  a full ARK (e.g., "ark:/61903/1:1:QVS9-DHDB")',
  );
  process.exit(1);
}

const result = await recordReadTool({ recordId });
console.log(JSON.stringify(result, null, 2));
