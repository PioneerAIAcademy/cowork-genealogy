/**
 * Smoke-test for the `person_read` MCP tool against the live FamilySearch API.
 *
 * Usage:
 *   npx tsx dev/try-person-read.ts KNDX-MKG                       # person only
 *   npx tsx dev/try-person-read.ts KNDX-MKG --relatives           # person + family
 *   npx tsx dev/try-person-read.ts KNDX-MKG --sources             # person + sources
 *   npx tsx dev/try-person-read.ts KNDX-MKG --relatives --sources # everything
 *   npx tsx dev/try-person-read.ts KNDX-MKG --relatives --project /tmp/p
 *       # also stages the read under /tmp/p/results/.staging/ (an existing
 *       # folder) and checks the staged document equals the printed result
 */
import { LOCAL } from "../src/auth/principal.js";
import { personReadTool } from "../src/tools/person-read.js";
import { getProjectStore } from "../src/store/project-store.js";

const personId = process.argv[2];
if (!personId) {
  console.error(
    "Usage: npx tsx dev/try-person-read.ts <personId> [--relatives] [--sources] [--project <dir>]",
  );
  process.exit(1);
}

const relatives = process.argv.includes("--relatives");
const sourceDescriptions = process.argv.includes("--sources");
const projectFlag = process.argv.indexOf("--project");
const projectPath = projectFlag === -1 ? undefined : process.argv[projectFlag + 1];
if (projectFlag !== -1 && !projectPath) {
  console.error("--project needs a directory");
  process.exit(1);
}

const result = await personReadTool(
  { personId, relatives, sourceDescriptions, ...(projectPath ? { projectPath } : {}) },
  LOCAL,
);
console.log(JSON.stringify(result, null, 2));

if (projectPath) {
  if (!result.staged) {
    console.error(`NOT STAGED: ${result.stagingError ?? "no staged handle"}`);
    process.exit(1);
  }
  const envelope = JSON.parse(
    await getProjectStore().readText(projectPath, result.staged.resultsRef),
  );
  const { staged: _s, stagingError: _e, ...returned } = result;
  const same = JSON.stringify(envelope.payload.results[0].gedcomx) === JSON.stringify(returned);
  console.error(
    `staged ${result.staged.resultsRef}: tool=${envelope.tool} ` +
      `query=${JSON.stringify(envelope.payload.query)} ` +
      `element personId=${envelope.payload.results[0].personId} ` +
      `document ${same ? "EQUALS" : "DIFFERS FROM"} the printed result`,
  );
  if (!same) process.exit(1);
}
