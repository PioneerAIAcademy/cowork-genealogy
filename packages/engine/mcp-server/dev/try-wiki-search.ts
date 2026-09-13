import { LOCAL } from "../src/auth/principal.js";
import { wikiSearch } from "../src/tools/wiki-search.js";

const query = process.argv[2] ?? "How do I find Italian birth records?";

const result = await wikiSearch({ query }, LOCAL);
console.log(JSON.stringify(result, null, 2));
