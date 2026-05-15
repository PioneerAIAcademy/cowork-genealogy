import { wikiFetchPageTool } from "../src/tools/wikiFetchPage.js";

// Usage: npx tsx dev/try-wiki-fetch-page.ts <url>
// Example: npx tsx dev/try-wiki-fetch-page.ts https://www.familysearch.org/en/wiki/Portugal_Genealogy
const url = process.argv[2];
if (!url) {
  console.error("Usage: npx tsx dev/try-wiki-fetch-page.ts <url>");
  console.error(
    "Example: npx tsx dev/try-wiki-fetch-page.ts https://www.familysearch.org/en/wiki/Portugal_Genealogy"
  );
  process.exit(1);
}

const result = await wikiFetchPageTool({ url });
console.log(`URL: ${result.url}`);
console.log(`Content length: ${result.content.length} chars`);
console.log("\n--- Content Preview (first 2000 chars) ---\n");
console.log(result.content.slice(0, 2000));
