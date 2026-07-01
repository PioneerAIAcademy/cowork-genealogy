import { wikiSearch } from "../src/tools/wiki-search.js";

const query = process.argv[2] ?? "How do I find Italian birth records?";

const result = await wikiSearch({ query });
console.log(JSON.stringify(result, null, 2));
