import { collectionsTool } from "../src/tools/collections.js";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: npx tsx scripts/try-collections.ts <placeId>[,<placeId>,...]");
  console.error("Example: npx tsx scripts/try-collections.ts 33");
  console.error("Example: npx tsx scripts/try-collections.ts 33,325");
  process.exit(1);
}

const placeIds = arg.split(",").map((s) => parseInt(s.trim(), 10));

const result = await collectionsTool({ placeIds });
console.log(JSON.stringify(result, null, 2));
