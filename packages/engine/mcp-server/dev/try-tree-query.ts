// Manual smoke test for tree_query — also the dispatch check the drift test
// cannot make (a missing server.ts arm is a runtime "Unknown tool").
//   npx tsx dev/try-tree-query.ts <projectPath> [personId,personId] [factType,factType]
// e.g. npx tsx dev/try-tree-query.ts /path/to/project I1,I2 Birth,Marriage
import { treeQuery, type TreeQueryInput } from "../src/tools/tree-query.js";

const [projectPath, personIds, factTypes] = process.argv.slice(2);
if (!projectPath) {
  console.error("usage: try-tree-query.ts <projectPath> [personId,personId] [factType,factType]");
  process.exit(1);
}

const input: TreeQueryInput = { projectPath };
if (personIds) input.personIds = personIds.split(",");
if (factTypes) input.factTypes = factTypes.split(",");

console.log(JSON.stringify(await treeQuery(input), null, 2));
