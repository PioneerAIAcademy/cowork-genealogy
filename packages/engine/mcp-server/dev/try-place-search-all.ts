import { placeSearchAllTool } from "../src/tools/place-search.js";

const placeName = process.argv[2] ?? "Schuylkill County";
const contextName = process.argv[3];

const result = await placeSearchAllTool({ placeName, contextName });
console.log(JSON.stringify(result, null, 2));
