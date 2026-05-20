import {
  wikiCountryHomeTool,
  wikiCountryGettingStartedTool,
  wikiCountryOnlineRecordsTool,
  wikiCountryResearchTipsTool,
} from "../src/tools/wiki-country-page.js";

// Usage: npx tsx dev/try-wiki-country-page.ts <placeId> <home|getting_started|records|research_tips>
// Example: npx tsx dev/try-wiki-country-page.ts 1927089 home
const placeId = process.argv[2];
const endpoint = process.argv[3] ?? "home";

if (!placeId) {
  console.error(
    "Usage: npx tsx dev/try-wiki-country-page.ts <placeId> <home|getting_started|records|research_tips>"
  );
  console.error("Example: npx tsx dev/try-wiki-country-page.ts 1927089 home");
  process.exit(1);
}

const tools = {
  home: wikiCountryHomeTool,
  getting_started: wikiCountryGettingStartedTool,
  records: wikiCountryOnlineRecordsTool,
  research_tips: wikiCountryResearchTipsTool,
} as const;

type Endpoint = keyof typeof tools;

if (!Object.keys(tools).includes(endpoint)) {
  console.error(`Unknown endpoint: ${endpoint}`);
  console.error("Valid options: home, getting_started, records, research_tips");
  process.exit(1);
}

const result = await tools[endpoint as Endpoint]({ placeId });
console.log(`Place: ${result.placeName} (placeId: ${result.placeId})`);
console.log(`Endpoint: wiki_country_${endpoint}`);
console.log(`URL: ${result.url}`);
console.log(`Content length: ${result.content.length} chars`);
console.log("\n--- Content Preview (first 2000 chars) ---\n");
console.log(result.content.slice(0, 2000));
