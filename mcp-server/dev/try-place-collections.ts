import { placeCollectionsTool } from "../src/tools/place-collections.js";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage:");
  console.error('  npx tsx dev/try-place-collections.ts "Schuylkill, Pennsylvania, United States"   # list by standardPlace');
  console.error('  npx tsx dev/try-place-collections.ts 1743384   # (a collection id triggers detail mode)');
  process.exit(1);
}

// A numeric-looking arg is treated as a collection id (detail mode); otherwise
// it is a standardPlace (or plain place query).
const result = /^\d+$/.test(arg)
  ? await placeCollectionsTool({ id: arg })
  : await placeCollectionsTool({ standardPlace: arg });

console.log(JSON.stringify(result, null, 2));
