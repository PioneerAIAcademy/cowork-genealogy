import { placeSearchTool } from "../src/tools/place-search.js";

const placeName = process.argv[2] ?? "Paris";
const contextName = process.argv[3];

const result = await placeSearchTool({ placeName, contextName });
console.log(JSON.stringify(result, null, 2));
