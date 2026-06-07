import { externalLinksSearchTool } from "../src/tools/external-links-search.js";

const standardPlace = process.argv[2];
const startYear = process.argv[3];
const endYear = process.argv[4];

if (!standardPlace) {
  console.error("Usage:");
  console.error(
    '  npx tsx dev/try-external-links-search.ts "<standardPlace>" [startYear] [endYear]'
  );
  console.error("");
  console.error("Examples:");
  console.error(
    '  npx tsx dev/try-external-links-search.ts "France" 1880 1950'
  );
  console.error(
    '  npx tsx dev/try-external-links-search.ts "Canada"'
  );
  process.exit(1);
}

const result = await externalLinksSearchTool({
  standardPlace,
  ...(startYear ? { startYear: Number.parseInt(startYear, 10) } : {}),
  ...(endYear ? { endYear: Number.parseInt(endYear, 10) } : {}),
});

console.log(JSON.stringify(result, null, 2));
