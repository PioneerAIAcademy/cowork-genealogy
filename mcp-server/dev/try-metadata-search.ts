/**
 * Smoke test for the metadata_search tool.
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-metadata-search.ts --standardPlace "Edensor, Derbyshire, England, United Kingdom" --from 1730-01-01 --to 1810-12-31
 *
 * Requires a valid FamilySearch session (run the login tool first).
 * Edensor, Derbyshire is a known small result set.
 */

import { metadataSearchTool } from "../src/tools/metadata-search.js";

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const standardPlace =
  getArg("--standardPlace") ?? "Edensor, Derbyshire, England, United Kingdom";
const fromDate = getArg("--from");
const toDate = getArg("--to");
const pageToken = getArg("--pageToken");

console.log("metadata_search smoke test");
console.log("Input:", { standardPlace, fromDate, toDate, pageToken });
console.log("---");

try {
  const result = await metadataSearchTool({
    standardPlace,
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    ...(pageToken ? { pageToken } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
  console.log("---");
  console.log(`Total groups: ${result.totalGroups}, returned: ${result.returned}`);
  if (result.nextPageToken) {
    console.log(`Next page token: ${result.nextPageToken}`);
  }
} catch (error) {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
}
