import { collectionsSearchTool } from "../src/tools/collections-search.js";

const standardPlace = process.argv[2];
const startYear = process.argv[3];
const endYear = process.argv[4];

if (!standardPlace) {
  console.error("Usage:");
  console.error('  npx tsx dev/try-collections-search.ts "Schuylkill, Pennsylvania, United States" [startYear] [endYear]');
  console.error("");
  console.error("For single-collection detail, use dev/try-collection-read.ts <id>.");
  process.exit(1);
}

const result = await collectionsSearchTool({
  standardPlace,
  ...(startYear ? { startYear: Number.parseInt(startYear, 10) } : {}),
  ...(endYear ? { endYear: Number.parseInt(endYear, 10) } : {}),
});

console.log(JSON.stringify(result, null, 2));
