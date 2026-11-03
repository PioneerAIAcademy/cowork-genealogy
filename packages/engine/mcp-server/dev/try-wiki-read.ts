import { LOCAL } from "../src/auth/principal.js";
import { wikiReadTool } from "../src/tools/wiki-read.js";

// Usage: npx tsx dev/try-wiki-read.ts <url> [offset]
// Example: npx tsx dev/try-wiki-read.ts https://www.familysearch.org/en/wiki/Portugal_Genealogy
// A page too long for one answer comes back in parts: pass the printed next offset to read on.
// `dev/check-wiki-paging.ts` walks every part and checks them against the whole page.
const url = process.argv[2];
const offsetArg = process.argv[3];
if (!url) {
  console.error("Usage: npx tsx dev/try-wiki-read.ts <url> [offset]");
  console.error(
    "Example: npx tsx dev/try-wiki-read.ts https://www.familysearch.org/en/wiki/Portugal_Genealogy"
  );
  process.exit(1);
}
// The tool refuses a bad offset in its own words. Only an empty argument is caught here:
// Number("") is 0, which would read the first part as if it had been asked for.
if (offsetArg !== undefined && offsetArg.trim() === "") {
  console.error("offset must not be empty: pass a whole number, or leave it out");
  process.exit(1);
}
const offset = offsetArg === undefined ? undefined : Number(offsetArg);

const result = await wikiReadTool({ url, ...(offset === undefined ? {} : { offset }) }, LOCAL);
console.log(`URL: ${result.url}`);
console.log(`Content length: ${result.content.length} chars`);
if (result.totalChars !== undefined) {
  console.log(
    `Part: offset ${result.offset} of ${result.totalChars} chars, truncated: ${result.truncated}` +
      (result.nextOffset !== undefined ? `, next offset ${result.nextOffset}` : "")
  );
}
console.log("\n--- Content Preview (first 2000 chars) ---\n");
console.log(result.content.slice(0, 2000));
