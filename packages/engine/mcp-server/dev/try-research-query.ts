// Manual smoke test for research_query — also the dispatch check the drift
// test cannot make (a missing index.ts if-block is a runtime "Unknown tool").
//   npx tsx dev/try-research-query.ts <projectPath> <section> [filterKey=value ...]
// e.g. npx tsx dev/try-research-query.ts /path/to/project assertions recordId=REC1 recordRole=child
import { researchQuery, type ResearchQueryInput } from "../src/tools/research-query.js";

const [projectPath, section, ...filterArgs] = process.argv.slice(2);
if (!projectPath || !section) {
  console.error("usage: try-research-query.ts <projectPath> <section> [filterKey=value ...]");
  process.exit(1);
}

const input: ResearchQueryInput = { projectPath, section: section as ResearchQueryInput["section"] };
for (const arg of filterArgs) {
  const eq = arg.indexOf("=");
  if (eq === -1) {
    console.error(`ignoring malformed filter arg (expected key=value): ${arg}`);
    continue;
  }
  (input as any)[arg.slice(0, eq)] = arg.slice(eq + 1);
}

const result = await researchQuery(input);
console.log(JSON.stringify(result, null, 2));
