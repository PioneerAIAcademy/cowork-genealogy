/**
 * Smoke test for the volume_search tool.
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-volume-search.ts --standardPlace "Edensor, Derbyshire, England, United Kingdom" --startYear 1730 --endYear 1810
 *   npx tsx dev/try-volume-search.ts --standardPlace "Harjager, Malmöhus, Sweden" --startYear 1650 --endYear 1720 --recordTypeGroups Tax,Census
 *   npx tsx dev/try-volume-search.ts --standardPlace "Kings, New York, United States" --startYear 1890 --endYear 1910 --summary
 *
 * Requires a valid FamilySearch session (run the login tool first).
 * Edensor, Derbyshire is a known small result set.
 */

import { LOCAL } from "../src/auth/principal.js";
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
const pageSizeArg = getArg("--pageSize");
const pageSize = pageSizeArg != null ? Number(pageSizeArg) : undefined;
const summary = args.includes("--summary");
// --sizeOnly skips the dump and prints only the counts and the size of the
// compact answer the server sends — the form the 50k tool-result limit applies to.
const sizeOnly = args.includes("--sizeOnly");
// Comma-separated so a filtered search is expressible from the shell, e.g.
// --recordTypeGroups Tax  or  --recordTypeGroups "Legal,Census"
const recordTypeGroups = getArg("--recordTypeGroups")
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

console.log("volume_search smoke test");
console.log("Input:", { standardPlace, startYear, endYear, recordTypeGroups, pageSize, pageToken });
console.log("---");

try {
  const result = await volumeSearchTool({
    standardPlace,
    ...(startYear != null ? { startYear } : {}),
    ...(endYear != null ? { endYear } : {}),
    ...(recordTypeGroups?.length ? { recordTypeGroups } : {}),
    ...(pageSize != null ? { pageSize } : {}),
    ...(pageToken ? { pageToken } : {}),
    ...(summary ? { summary } : {}),
  }, LOCAL);
  const serialized = JSON.stringify(result);
  // With --summary the page itself is noise; print the rollup.
  if (!sizeOnly) console.log(JSON.stringify(summary ? result.summary : result, null, 2));
  console.log("---");
  console.log(`Total results: ${result.totalResults}, returned: ${result.results.length}`);
  const capped = result.results.filter((g) => g.coverageCount != null).length;
  console.log(`Answer size: ${serialized.length} characters; volumes with shortened coverages: ${capped}`);
  if (result.nextPageToken) {
    console.log(`Next page token: ${result.nextPageToken}`);
  }
} catch (error) {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
}
