/**
 * smoke-stdio — drive the BUILT server (build/index.js) over the real stdio
 * transport and run the OFFLINE subset of the shared call plan in
 * dev/smoke-calls.ts, so the dispatch chain in src/server.ts — which no
 * vitest file imports — is exercised end to end: the principal binding, the
 * ProjectStore-backed writers, and the two tools the e2e corpus never calls
 * (`project_create`, `tree_forget`). Every call passes a fresh temp dir as its
 * projectPath, removed afterwards.
 *
 *   npm run build && npx tsx dev/smoke-stdio.ts            # or: make engine-smoke-stdio
 *
 * Exit 0 with one line per call on success; exit 1 naming every failure.
 * No FamilySearch credentials and no network — `auth_status` merely reports.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  assertCoverage,
  callViaClient,
  prepareProject,
  printHeader,
  report,
  runPlan,
  type SmokeCtx,
} from "./smoke-calls.js";

const entry = "build/index.js";
const project = await prepareProject();
const ctx: SmokeCtx = {
  mode: "no-bearer",
  projectPath: project.projectPath,
  hostProjectDir: project.hostProjectDir,
  missingProjectPath: project.missingProjectPath,
  openRouterKeyConfigured: false,
  values: {},
};

const client = new Client({ name: "smoke-stdio", version: "0" });
const transport = new StdioClientTransport({
  command: "node",
  args: [entry],
  stderr: "inherit",
});

printHeader("smoke-stdio", ctx, [`entry=${entry}`, "(offline steps only)"]);

let failures: string[] = [];
let calls = 0;
try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const problems = assertCoverage(tools.map((t) => t.name));
  report("tools/list coverage", problems.length === 0, problems.length === 0 ? `${tools.length} tools advertised, all planned or excluded` : problems.join("; "));
  if (problems.length > 0) failures.push("tools/list coverage");

  const status = await callViaClient(client, "auth_status", {});
  const statusOk = !status.isError && typeof status.body.loggedIn === "boolean";
  report("auth_status", statusOk, JSON.stringify(status.body));
  if (!statusOk) failures.push("auth_status");
  calls++;

  // #2126 — the build stamp is on the wire and on the tool return, and they agree.
  const wireVersion = client.getServerVersion()?.version;
  const stampOk =
    typeof wireVersion === "string" &&
    /^\d+\.\d+\.\d+\+/.test(wireVersion) &&
    status.body.buildId === wireVersion;
  report("build stamp", stampOk, `serverInfo.version=${wireVersion} auth_status.buildId=${status.body.buildId}`);
  if (!stampOk) failures.push("build stamp");

  const run = await runPlan((tool, args) => callViaClient(client, tool, args), ctx, { offlineOnly: true });
  calls += run.calls;
  failures = failures.concat(run.failures);
} catch (error) {
  report("transport", false, error instanceof Error ? error.message : String(error));
  failures.push("transport");
} finally {
  await client.close().catch(() => {});
  await project.cleanup();
}

console.log(`${calls} call(s), mode=${ctx.mode}, ${failures.length} failed`);
if (failures.length > 0) {
  console.error(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
