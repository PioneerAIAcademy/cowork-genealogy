import { placeExternalLinksTool } from "../src/tools/place-external-links.js";

const standardPlace = process.argv[2];
const startYear = process.argv[3];
const endYear = process.argv[4];

if (!standardPlace || !startYear || !endYear) {
  console.error("Usage:");
  console.error(
    '  npx tsx dev/try-place-external-links.ts "<standardPlace>" <startYear> <endYear>'
  );
  console.error("");
  console.error("Examples:");
  console.error(
    '  npx tsx dev/try-place-external-links.ts "France" 1880 1950'
  );
  console.error(
    '  npx tsx dev/try-place-external-links.ts "Canada" 1880 1950'
  );
  process.exit(1);
}

const result = await placeExternalLinksTool({
  standardPlace,
  startYear: Number.parseInt(startYear, 10),
  endYear: Number.parseInt(endYear, 10),
});

console.log(JSON.stringify(result, null, 2));
