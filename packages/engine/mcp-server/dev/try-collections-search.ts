import { LOCAL } from "../src/auth/principal.js";
import { collectionsSearchTool } from "../src/tools/collections-search.js";

const standardPlace = process.argv[2];
const startYear = process.argv[3];
const endYear = process.argv[4];

if (!standardPlace) {
  console.error("Usage:");
  console.error('  npx tsx dev/try-collections-search.ts "Schuylkill, Pennsylvania, United States" [startYear] [endYear]');
  process.exit(1);
}

const result = await collectionsSearchTool({
  standardPlace,
  ...(startYear ? { startYear: Number.parseInt(startYear, 10) } : {}),
  ...(endYear ? { endYear: Number.parseInt(endYear, 10) } : {}),
}, LOCAL);

console.log(JSON.stringify(result, null, 2));
