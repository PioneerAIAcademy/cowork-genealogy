// Manual smoke test for tree_query — also the dispatch check the drift test
// cannot make (a missing server.ts arm is a runtime "Unknown tool").
//   npx tsx dev/try-tree-query.ts <projectPath> [personId,personId] [factType,factType] [--sources | --source-ids S1,S2]
// e.g. npx tsx dev/try-tree-query.ts /path/to/project I1,I2 Birth,Marriage --sources
import { treeQuery, type TreeQueryInput } from "../src/tools/tree-query.js";

const args = process.argv.slice(2);
const sourcesAt = args.indexOf("--sources");
const sourceIdsAt = args.indexOf("--source-ids");
const input: TreeQueryInput = { projectPath: "" };
if (sourcesAt >= 0) input.includeSources = true;
if (sourceIdsAt >= 0) input.sourceIds = (args[sourceIdsAt + 1] ?? "").split(",").filter(Boolean);
const positional = args.filter((a, i) => i !== sourcesAt && i !== sourceIdsAt && i !== sourceIdsAt + 1);
const [projectPath, personIds, factTypes] = positional;
if (!projectPath) {
  console.error("usage: try-tree-query.ts <projectPath> [personId,personId] [factType,factType] [--sources | --source-ids S1,S2]");
  process.exit(1);
}

input.projectPath = projectPath;
if (personIds) input.personIds = personIds.split(",");
if (factTypes) input.factTypes = factTypes.split(",");

const result = await treeQuery(input);
console.log(JSON.stringify(result, null, 2));
console.error(`${JSON.stringify(result).length} characters`);
