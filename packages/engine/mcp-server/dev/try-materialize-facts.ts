// Manual smoke test for materialize_facts — also the dispatch check the drift
// test cannot make (a missing index.ts if-block is a runtime "Unknown tool").
//   npx tsx dev/try-materialize-facts.ts <projectPath> <recordId> <recordRole> [personId]
//
// Batch form (materialize several personas in one validate-once/write-once
// call):
//   npx tsx dev/try-materialize-facts.ts <projectPath> --ops '[{"recordId":"R1","recordRole":"subject"},{"recordId":"R1","recordRole":"child","personId":"I5"}]'
import { materializeFacts } from "../src/tools/materialize-facts.js";

const [projectPath, second, third] = process.argv.slice(2);
if (!projectPath) {
  console.error(
    "usage: try-materialize-facts.ts <projectPath> <recordId> <recordRole> [personId]\n" +
      "   or: try-materialize-facts.ts <projectPath> --ops '<json ops array>'",
  );
  process.exit(1);
}

let result;
if (second === "--ops") {
  if (!third) {
    console.error("--ops requires a JSON array argument, e.g. --ops '[{\"recordId\":\"R1\",\"recordRole\":\"subject\"}]'");
    process.exit(1);
  }
  const ops = JSON.parse(third);
  result = await materializeFacts({ projectPath, ops });
} else {
  const [recordId, recordRole, personId] = [second, third, process.argv[5]];
  if (!recordId || !recordRole) {
    console.error("usage: try-materialize-facts.ts <projectPath> <recordId> <recordRole> [personId]");
    process.exit(1);
  }
  result = await materializeFacts({ projectPath, recordId, recordRole, personId });
}
console.log(JSON.stringify(result, null, 2));
