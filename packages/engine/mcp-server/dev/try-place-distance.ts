import { placeDistanceTool } from "../src/tools/distance.js";

const [standardPlace1, standardPlace2] = process.argv.slice(2);

if (!standardPlace1 || !standardPlace2) {
  console.error('Usage: npx tsx dev/try-place-distance.ts "<standardPlace1>" "<standardPlace2>"');
  console.error('Example: npx tsx dev/try-place-distance.ts "England, United Kingdom" "Ohio, United States"');
  process.exit(1);
}

const result = await placeDistanceTool({ standardPlace1, standardPlace2 });
console.log(`Distance from ${result.standardPlace1} to ${result.standardPlace2}:`);
console.log(`  ${result.miles.toLocaleString()} miles`);
console.log(`  ${result.kilometers.toLocaleString()} km`);
