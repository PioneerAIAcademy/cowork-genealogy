import { collectionsTool } from "../src/tools/collections.js";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage:");
  console.error("  npx tsx scripts/try-collections.ts Alabama          # Search by place name");
  console.error("  npx tsx scripts/try-collections.ts --ids 33         # Filter by internal place IDs");
  console.error("  npx tsx scripts/try-collections.ts --ids 33,325     # Multiple internal IDs");
  process.exit(1);
}

let result;
if (arg === "--ids") {
  const idsArg = process.argv[3];
  if (!idsArg) {
    console.error("Provide comma-separated place IDs after --ids");
    process.exit(1);
  }
  const placeIds = idsArg.split(",").map((s) => parseInt(s.trim(), 10));
  result = await collectionsTool({ placeIds });
} else {
  result = await collectionsTool({ query: arg });
}

console.log(JSON.stringify(result, null, 2));
