import { placesTool } from "../src/tools/places.js";

const query = process.argv[2] ?? "Ohio";

const result = await placesTool({ query });
console.log(JSON.stringify(result, null, 2));
