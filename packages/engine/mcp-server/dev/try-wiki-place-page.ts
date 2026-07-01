import { wikiPlacePageTool } from "../src/tools/wiki-place-page.js";
import type { WikiPageSection } from "../src/types/wikiPage.js";

// Usage: npx tsx dev/try-wiki-place-page.ts "<standardPlace>" <home|getting_started|online_records|research_tips>
// Example: npx tsx dev/try-wiki-place-page.ts "Portugal" home
const standardPlace = process.argv[2];
const section = (process.argv[3] ?? "home") as WikiPageSection;

const VALID: WikiPageSection[] = [
  "home",
  "getting_started",
  "online_records",
  "research_tips",
];

if (!standardPlace) {
  console.error(
    'Usage: npx tsx dev/try-wiki-place-page.ts "<standardPlace>" <home|getting_started|online_records|research_tips>'
  );
  console.error('Example: npx tsx dev/try-wiki-place-page.ts "Portugal" home');
  process.exit(1);
}

if (!VALID.includes(section)) {
  console.error(`Unknown section: ${section}`);
  console.error(`Valid options: ${VALID.join(", ")}`);
  process.exit(1);
}

const result = await wikiPlacePageTool({ standardPlace, section });
console.log(`Place: ${result.placeName}`);
console.log(`Section: ${section}`);
console.log(`URL: ${result.url}`);
console.log(`Content length: ${result.content.length} chars`);
console.log("\n--- Content Preview (first 2000 chars) ---\n");
console.log(result.content.slice(0, 2000));
