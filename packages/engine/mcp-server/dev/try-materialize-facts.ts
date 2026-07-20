// Manual smoke test for materialize_facts — also the dispatch check the drift
// test cannot make (a missing index.ts if-block is a runtime "Unknown tool").
//   npx tsx dev/try-materialize-facts.ts <projectPath> <recordId> <recordRole> [personId]
import { materializeFacts } from "../src/tools/materialize-facts.js";

const [projectPath, recordId, recordRole, personId] = process.argv.slice(2);
if (!projectPath || !recordId || !recordRole) {
  console.error("usage: try-materialize-facts.ts <projectPath> <recordId> <recordRole> [personId]");
  process.exit(1);
}

const result = await materializeFacts({ projectPath, recordId, recordRole, personId });
console.log(JSON.stringify(result, null, 2));
