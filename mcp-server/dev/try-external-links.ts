import { externalLinks } from "../src/tools/external-links.js";

const placeId = process.argv[2];
const startYear = process.argv[3];
const endYear = process.argv[4];

if (!placeId || !startYear || !endYear) {
  console.error("Usage:");
  console.error(
    "  npx tsx dev/try-external-links.ts <placeId> <startYear> <endYear>"
  );
  console.error("");
  console.error("Examples:");
  console.error(
    "  npx tsx dev/try-external-links.ts 1927089 1880 1950   # France"
  );
  console.error(
    "  npx tsx dev/try-external-links.ts 1927164 1880 1950   # Canada"
  );
  process.exit(1);
}

const result = await externalLinks({
  placeId,
  startYear: Number.parseInt(startYear, 10),
  endYear: Number.parseInt(endYear, 10),
});

console.log(JSON.stringify(result, null, 2));
