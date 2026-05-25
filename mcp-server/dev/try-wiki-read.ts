import { wikiReadTool } from "../src/tools/wiki-read.js";

// Usage: npx tsx dev/try-wiki-read.ts <url>
// Example: npx tsx dev/try-wiki-read.ts https://www.familysearch.org/en/wiki/Portugal_Genealogy
const url = process.argv[2];
if (!url) {
  console.error("Usage: npx tsx dev/try-wiki-read.ts <url>");
  console.error(
    "Example: npx tsx dev/try-wiki-read.ts https://www.familysearch.org/en/wiki/Portugal_Genealogy"
  );
  process.exit(1);
}

const result = await wikiReadTool({ url });
console.log(`URL: ${result.url}`);
console.log(`Content length: ${result.content.length} chars`);
console.log("\n--- Content Preview (first 2000 chars) ---\n");
console.log(result.content.slice(0, 2000));
