import { placeSearchTool } from "../src/tools/place-search.js";

const query = process.argv[2] ?? "Ohio";

const result = await placeSearchTool({ query });
console.log(JSON.stringify(result, null, 2));
