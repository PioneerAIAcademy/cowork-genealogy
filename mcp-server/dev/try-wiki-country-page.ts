import {
  wikiCountryHomeTool,
  wikiCountryGettingStartedTool,
  wikiCountryRecordsTool,
  wikiCountryResearchTipsTool,
} from "../src/tools/wikiCountryPage.js";

// Usage: npx tsx dev/try-wiki-country-page.ts <placeRepId> <home|getting_started|records|research_tips>
// Example: npx tsx dev/try-wiki-country-page.ts 267 getting_started
const placeRepId = process.argv[2] ?? "267";
const endpoint = process.argv[3] ?? "home";

const tools = {
  home: wikiCountryHomeTool,
  getting_started: wikiCountryGettingStartedTool,
  records: wikiCountryRecordsTool,
  research_tips: wikiCountryResearchTipsTool,
} as const;

type Endpoint = keyof typeof tools;

if (!Object.keys(tools).includes(endpoint)) {
  console.error(`Unknown endpoint: ${endpoint}`);
  console.error("Valid options: home, getting_started, records, research_tips");
  process.exit(1);
}

const result = await tools[endpoint as Endpoint]({ placeRepId });
console.log(`Place: ${result.placeName} (repId: ${result.placeRepId})`);
console.log(`Endpoint: wiki_country_${endpoint}`);
console.log(`URL: ${result.url}`);
console.log(`Cached: ${result.cached}`);
console.log(`Content length: ${result.content.length} chars`);
console.log("\n--- Content Preview (first 2000 chars) ---\n");
console.log(result.content.slice(0, 2000));
