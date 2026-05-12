import { placeDistanceTool } from "../src/tools/distance.js";

const [placeId1, placeId2] = process.argv.slice(2);

if (!placeId1 || !placeId2) {
  console.error("Usage: npx tsx dev/try-place-distance.ts <placeId1> <placeId2>");
  console.error("Example: npx tsx dev/try-place-distance.ts 267 456");
  process.exit(1);
}

const result = await placeDistanceTool({ placeId1, placeId2 });
console.log(`Distance from ${result.place1Name} to ${result.place2Name}:`);
console.log(`  ${result.miles.toLocaleString()} miles`);
console.log(`  ${result.kilometers.toLocaleString()} km`);
