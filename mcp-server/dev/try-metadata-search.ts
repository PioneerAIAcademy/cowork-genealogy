/**
 * Smoke test for the metadata_search tool.
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-metadata-search.ts --placeId 6137147 --from 1730-01-01 --to 1810-12-31
 *
 * Requires a valid FamilySearch session (run the login tool first).
 * The Edensor, Derbyshire placeId 6137147 is a known small result set.
 */

import { metadataSearchTool } from "../src/tools/metadata-search.js";

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const placeId = getArg("--placeId") ?? "6137147";
const fromDate = getArg("--from");
const toDate = getArg("--to");
const pageToken = getArg("--pageToken");

console.log("metadata_search smoke test");
console.log("Input:", { placeId, fromDate, toDate, pageToken });
console.log("---");

try {
  const result = await metadataSearchTool({
    placeId,
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
