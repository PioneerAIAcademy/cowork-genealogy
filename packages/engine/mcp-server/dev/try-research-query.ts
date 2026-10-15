// Manual smoke test for research_query — also the dispatch check the drift
// test cannot make (a missing index.ts if-block is a runtime "Unknown tool").
//   npx tsx dev/try-research-query.ts <projectPath> <section> [filterKey=value ...]
// e.g. npx tsx dev/try-research-query.ts /path/to/project assertions recordId=REC1 recordRole=child
//      npx tsx dev/try-research-query.ts /path/to/project assertions offset=50
//      npx tsx dev/try-research-query.ts /path/to/project person_evidence personId=I1,I2
//      npx tsx dev/try-research-query.ts /path/to/project person_evidence 'personId=["I1","I2"]'
import { PLURAL_KEYS, researchQuery, type ResearchQueryInput } from "../src/tools/research-query.js";

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
  const key = arg.slice(0, eq);
  const value = arg.slice(eq + 1);
  // Filters are strings, except that PLURAL_KEYS also take a list: `a,b` is sent
  // as an array, and a JSON-array string is passed through for the tool to parse.
  // offset is the one numeric param, and the tool rejects a stringified offset —
  // coerce it so `offset=50` works from the shell.
  (input as any)[key] =
    key === "offset"
      ? Number(value)
      : PLURAL_KEYS.includes(key as never) && value.includes(",") && !value.trim().startsWith("[")
        ? value.split(",")
        : value;
}

const result = await researchQuery(input);
console.log(JSON.stringify(result, null, 2));
