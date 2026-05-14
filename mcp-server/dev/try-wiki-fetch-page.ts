import { wikiFetchPageTool } from "../src/tools/wikiFetchPage.js";

const url =
  process.argv[2] ?? "https://www.familysearch.org/en/wiki/Portugal_Genealogy";

const result = await wikiFetchPageTool({ url });
console.log(`URL: ${result.url}`);
console.log(`Cached: ${result.cached}`);
console.log(`Content length: ${result.content.length} chars`);
console.log("\n--- Content Preview (first 2000 chars) ---\n");
console.log(result.content.slice(0, 2000));
