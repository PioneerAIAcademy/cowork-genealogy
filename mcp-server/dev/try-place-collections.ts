import { placeCollectionsTool } from "../src/tools/place-collections.js";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage:");
  console.error('  npx tsx dev/try-place-collections.ts Alabama   # Search by place name');
  console.error('  npx tsx dev/try-place-collections.ts 1743384   # (a collection id triggers detail mode)');
  process.exit(1);
}

// A numeric-looking arg is treated as a collection id (detail mode); otherwise
// it is a place-name query.
const result = /^\d+$/.test(arg)
  ? await placeCollectionsTool({ id: arg })
  : await placeCollectionsTool({ query: arg });

console.log(JSON.stringify(result, null, 2));
