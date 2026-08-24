/**
 * Smoke test for the volume_search tool.
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-volume-search.ts --standardPlace "Edensor, Derbyshire, England, United Kingdom" --startYear 1730 --endYear 1810
 *   npx tsx dev/try-volume-search.ts --standardPlace "Harjager, Malmöhus, Sweden" --startYear 1650 --endYear 1720 --recordTypeGroups Tax,Census
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
// Comma-separated so a filtered search is expressible from the shell, e.g.
// --recordTypeGroups Tax  or  --recordTypeGroups "Legal,Census"
const recordTypeGroups = getArg("--recordTypeGroups")
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

console.log("volume_search smoke test");
console.log("Input:", { standardPlace, startYear, endYear, recordTypeGroups, pageToken });
console.log("---");

try {
  const result = await volumeSearchTool({
    standardPlace,
    ...(startYear != null ? { startYear } : {}),
    ...(endYear != null ? { endYear } : {}),
    ...(recordTypeGroups?.length ? { recordTypeGroups } : {}),
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
