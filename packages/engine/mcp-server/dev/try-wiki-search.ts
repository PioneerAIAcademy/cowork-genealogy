import { LOCAL } from "../src/auth/principal.js";
import { wikiSearch } from "../src/tools/wiki-search.js";

// npx tsx dev/try-wiki-search.ts ["question"] [--include-text]
const args = process.argv.slice(2);
const includeText = args.includes("--include-text");
const query = args.find((a) => !a.startsWith("--")) ?? "How do I find Italian birth records?";

const result = await wikiSearch({ query, includeText }, LOCAL);
console.log(JSON.stringify(result, null, 2));
console.log(`JSON chars: ${JSON.stringify(result).length}`);
