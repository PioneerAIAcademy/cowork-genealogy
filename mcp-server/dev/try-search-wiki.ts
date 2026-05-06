import { searchWiki } from "../src/tools/searchWiki.js";

const query = process.argv[2] ?? "How do I find Italian birth records?";

const result = await searchWiki({ query });
console.log(JSON.stringify(result, null, 2));
