/**
 * Smoke test for the volume_search tool.
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-volume-search.ts --standardPlace "Edensor, Derbyshire, England, United Kingdom" --startYear 1730 --endYear 1810
 *
 * Requires a valid FamilySearch session (run the login tool first).
 * Edensor, Derbyshire is a known small result set.
 */

import { volumeSearchTool } from "../src/tools/volume-search.js";

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const standardPlace =
  getArg("--standardPlace") ?? "Edensor, Derbyshire, England, United Kingdom";
const startYearArg = getArg("--startYear");
const endYearArg = getArg("--endYear");
const startYear = startYearArg != null ? Number(startYearArg) : undefined;
const endYear = endYearArg != null ? Number(endYearArg) : undefined;
const pageToken = getArg("--pageToken");

console.log("volume_search smoke test");
console.log("Input:", { standardPlace, startYear, endYear, pageToken });
console.log("---");

try {
  const result = await volumeSearchTool({
    standardPlace,
    ...(startYear != null ? { startYear } : {}),
    ...(endYear != null ? { endYear } : {}),
    ...(pageToken ? { pageToken } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
  console.log("---");
  console.log(`Total results: ${result.totalResults}, returned: ${result.results.length}`);
  if (result.nextPageToken) {
    console.log(`Next page token: ${result.nextPageToken}`);
  }
} catch (error) {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
}
