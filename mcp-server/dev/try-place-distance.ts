import { placeDistanceTool } from "../src/tools/distance.js";

const [place_id1, place_id2] = process.argv.slice(2);

if (!place_id1 || !place_id2) {
  console.error("Usage: npx tsx dev/try-place-distance.ts <place_id1> <place_id2>");
  console.error("Example: npx tsx dev/try-place-distance.ts 267 456");
  process.exit(1);
}

const result = await placeDistanceTool({ place_id1, place_id2 });
console.log(`Distance from ${result.place1Name} to ${result.place2Name}:`);
console.log(`  ${result.miles.toLocaleString()} miles`);
console.log(`  ${result.kilometers.toLocaleString()} km`);
