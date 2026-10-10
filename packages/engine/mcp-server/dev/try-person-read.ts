/**
 * Smoke-test for the `person_read` MCP tool against the live FamilySearch API.
 *
 * Usage:
 *   npx tsx dev/try-person-read.ts KNDX-MKG                 # person, family, sources
 *   npx tsx dev/try-person-read.ts KNDX-MKG --project /tmp/p
 *       # also stages the read under /tmp/p/results/.staging/ (an existing
 *       # folder) and checks the staged document equals the printed result
 *   npx tsx dev/try-person-read.ts KNDX-MKG --project /tmp/p --build
 *       # then builds the starting tree from the staged read (`project_create`
 *       # with `personReadRef` and a fixed objective) and prints how many edges
 *       # carry a source other than the FamilySearch-tree one. /tmp/p must hold
 *       # no project yet: `project_create` never overwrites one.
 *
 * `--relatives` and `--sources` are accepted and do nothing: person_read always
 * reads both. Kept because eval/harness/e2e/author.py passes them.
 */
import { LOCAL } from "../src/auth/principal.js";
import { personReadTool } from "../src/tools/person-read.js";
import { projectCreate } from "../src/tools/project-create.js";
import { getProjectStore } from "../src/store/project-store.js";

const personId = process.argv[2];
if (!personId) {
  console.error(
    "Usage: npx tsx dev/try-person-read.ts <personId> [--project <dir> [--build]]  (--relatives/--sources: accepted, no-ops)",
  );
  process.exit(1);
}

const projectFlag = process.argv.indexOf("--project");
const projectPath = projectFlag === -1 ? undefined : process.argv[projectFlag + 1];
if (projectFlag !== -1 && !projectPath) {
  console.error("--project needs a directory");
  process.exit(1);
}
const build = process.argv.includes("--build");
if (build && !projectPath) {
  console.error("--build needs --project <dir>: it builds from the staged read");
  process.exit(1);
}

const result = await personReadTool(
  { personId, ...(projectPath ? { projectPath } : {}) },
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

  if (build) {
    // The response's side of the check, printed before the build so a refused build cannot
    // hide it: edges carrying refs, and every ref resolving in `sources[]`.
    const sourceIds = new Set(result.sources.map((s) => s.id));
    const edgeRefs = result.relationships.flatMap((r) => r.sources ?? []);
    console.error(
      `response: ${result.relationships.filter((r) => (r.sources ?? []).length > 0).length} of ` +
        `${result.relationships.length} edges carry refs, ` +
        `${edgeRefs.filter((r) => !sourceIds.has(r.ref)).length} unresolved`,
    );

    const created = await projectCreate({
      projectPath,
      objective: "Smoke test: build the starting tree from the staged person_read.",
      personReadRef: result.staged.resultsRef,
    });
    if (!created.ok) {
      console.error(`NOT BUILT: ${created.errors.join("; ")}`);
      process.exit(1);
    }
    // The tree's side: a ref other than the FamilySearch-tree source (`S1`), which every
    // edge carries. `remapRefs` drops an unresolved ref silently, so this count is the
    // check that the refs survived the build.
    const tree = JSON.parse(await getProjectStore().readText(projectPath, "tree.gedcomx.json"));
    const fsTree = created.idMap.familySearchTreeSource;
    const treeEdges: Array<{ sources?: Array<{ ref: string }> }> = tree.relationships;
    const own = treeEdges.filter((r) => (r.sources ?? []).some((x) => x.ref !== fsTree));
    console.error(
      `built tree: ${own.length} of ${treeEdges.length} edges carry a source other than ${fsTree}`,
    );
  }
}
