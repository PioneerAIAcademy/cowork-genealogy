import { writeFileSync } from "node:fs";
import { LOCAL } from "../src/auth/principal.js";
import { wikiPlacePageTool } from "../src/tools/wiki-place-page.js";
import type { WikiPageSection } from "../src/types/wikiPage.js";

// Usage: npx tsx dev/capture-wiki-place-page-fixture.ts "<standardPlace>" <section> <match> <out.json> "<description>"
// Writes an eval mcp fixture holding the live wiki_place_page answer, matched on `~<match>` and the section.
const [standardPlace, section, match, out, description] = process.argv.slice(2);
if (!standardPlace || !section || !match || !out || !description) {
  console.error('Usage: npx tsx dev/capture-wiki-place-page-fixture.ts "<standardPlace>" <section> <match> <out.json> "<description>"');
  process.exit(1);
}
const response = await wikiPlacePageTool({ standardPlace, section: section as WikiPageSection }, LOCAL);
const fixture = { tool: "wiki_place_page", description, args: { standardPlace: `~${match}`, section }, response };
writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n", "utf-8");
console.log(`${out}: ${response.url} ${(response as { content?: string }).content?.length ?? 0} chars, truncated=${(response as { truncated?: boolean }).truncated ?? false}`);
