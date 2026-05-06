import { wikipediaSearch } from "../src/tools/wikipedia.js";

const query = process.argv[2] ?? "Albert Einstein";

const result = await wikipediaSearch({ query });
console.log(JSON.stringify(result, null, 2));
