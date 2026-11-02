import { LOCAL } from "../src/auth/principal.js";
import { wikiPlacePageTool } from "../src/tools/wiki-place-page.js";
import { WIKI_PAGE_SECTIONS, type WikiPageSection } from "../src/types/wikiPage.js";

// Usage: npx tsx dev/try-wiki-place-page.ts "<standardPlace>" <home|getting_started|online_records|research_tips> [offset]
// Example: npx tsx dev/try-wiki-place-page.ts "Portugal" home
// A page too long for one answer comes back in parts: pass the printed next offset to read on.
// `dev/check-wiki-paging.ts` walks every part and checks them against the whole page.
const standardPlace = process.argv[2];
const section = (process.argv[3] ?? "home") as WikiPageSection;
const offsetArg = process.argv[4];

const VALID: readonly WikiPageSection[] = WIKI_PAGE_SECTIONS;

if (!standardPlace) {
  console.error(
    'Usage: npx tsx dev/try-wiki-place-page.ts "<standardPlace>" <home|getting_started|online_records|research_tips> [offset]'
  );
  console.error('Example: npx tsx dev/try-wiki-place-page.ts "Portugal" home');
  process.exit(1);
}

if (!VALID.includes(section)) {
  console.error(`Unknown section: ${section}`);
  console.error(`Valid options: ${VALID.join(", ")}`);
  process.exit(1);
}

// The tool refuses a bad offset in its own words. Only an empty argument is caught here:
// Number("") is 0, which would read the first part as if it had been asked for.
if (offsetArg !== undefined && offsetArg.trim() === "") {
  console.error("offset must not be empty: pass a whole number, or leave it out");
  process.exit(1);
}
const offset = offsetArg === undefined ? undefined : Number(offsetArg);

const result = await wikiPlacePageTool({ standardPlace, section, offset }, LOCAL);
console.log(`Place: ${result.placeName}`);
console.log(`Section: ${section}`);
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
