/**
 * Smoke test for the fulltext_search tool.
 * Requires a valid FamilySearch session (run try-login.ts first).
 *
 * Usage:
 *   npx tsx dev/try-fulltext-search.ts "+Patrick +Flynn"
 *   npx tsx dev/try-fulltext-search.ts "+Patrick +Flynn" --name "Patrick Flynn"
 *   npx tsx dev/try-fulltext-search.ts "+Deed" --collection 3158865
 *   npx tsx dev/try-fulltext-search.ts "+Patrick +Flynn" --facets
 */

import { fulltextSearchTool } from "../src/tools/fulltext-search.js";
import type { FulltextSearchInput } from "../src/types/fulltext-search.js";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    'Usage: npx tsx dev/try-fulltext-search.ts "+keywords" [--name NAME] [--place PLACE] [--collection ID] [--facets] [--count N]'
  );
  process.exit(1);
}

const input: FulltextSearchInput = {};

let i = 0;
// First positional arg is keywords
if (args[0] && !args[0].startsWith("--")) {
  input.keywords = args[0];
  i = 1;
}

while (i < args.length) {
  const flag = args[i];
  if (flag === "--name" && args[i + 1]) {
    input.name = args[++i];
  } else if (flag === "--place" && args[i + 1]) {
    input.place = args[++i];
  } else if (flag === "--collection" && args[i + 1]) {
    input.collectionId = args[++i];
  } else if (flag === "--dgs" && args[i + 1]) {
    input.dgsNumber = args[++i];
  } else if (flag === "--year-from" && args[i + 1]) {
    input.yearFrom = Number(args[++i]);
  } else if (flag === "--year-to" && args[i + 1]) {
    input.yearTo = Number(args[++i]);
  } else if (flag === "--count" && args[i + 1]) {
    input.count = Number(args[++i]);
  } else if (flag === "--nl" && args[i + 1]) {
    input.nlQuery = args[++i];
  } else if (flag === "--facets") {
    input.includeFacets = true;
  }
  i++;
}

console.log("Input:", JSON.stringify(input, null, 2));
console.log();

const result = await fulltextSearchTool(input);
console.log(JSON.stringify(result, null, 2));
