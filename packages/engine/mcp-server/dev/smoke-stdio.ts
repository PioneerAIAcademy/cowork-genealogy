/**
 * smoke-stdio — drive the BUILT server (build/index.js) over the real stdio
 * transport and run the OFFLINE subset of the shared call plan in
 * dev/smoke-calls.ts, so the dispatch chain in src/server.ts — which no
 * vitest file imports — is exercised end to end: the principal binding, the
 * ProjectStore-backed writers, and the two tools the e2e corpus never calls
 * (`project_create`, `tree_forget`).
 *
 *   npm run build && npx tsx dev/smoke-stdio.ts            # build/index.js, file backend
 *   make engine-smoke-stdio-pg                             # build/hosted-stdio.js, Postgres + minio
 *
 *   SMOKE_ENTRY         the entrypoint to fork (default build/index.js)
 *   SMOKE_PROJECT_PATH  the projectPath every call passes, verbatim (default: a
 *                       fresh temp dir, removed afterwards; the hosted entrypoint
 *                       wants its anchor, /project, which is not a directory here)
 *   GENEALOGY_*, FS_ACCESS_TOKEN, WIKI_API_URL, POP_STATS_URL, OPENROUTER_*
 *                       passed through to the child (the SDK's transport forwards
 *                       only a fixed safe list of variables by default)
 *
 * Exit 0 with one line per call on success; exit 1 naming every failure.
 * No FamilySearch credentials and no network — `auth_status` merely reports.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { posix } from "node:path";
import {
  assertCoverage,
  callViaClient,
  prepareProject,
  printHeader,
  report,
  runPlan,
  type PreparedProject,
  type SmokeCtx,
} from "./smoke-calls.js";

const entry = process.env.SMOKE_ENTRY ?? "build/index.js";
const requestedPath = process.env.SMOKE_PROJECT_PATH;
const project: PreparedProject = requestedPath
  ? {
      projectPath: requestedPath,
      hostProjectDir: existsSync(requestedPath) ? requestedPath : null,
      missingProjectPath: posix.join(requestedPath, "nope"),
      cleanup: async () => {},
    }
  : await prepareProject();
const ctx: SmokeCtx = {
  mode: "no-bearer",
  projectPath: project.projectPath,
  hostProjectDir: project.hostProjectDir,
  missingProjectPath: project.missingProjectPath,
  openRouterKeyConfigured: false,
  values: {},
};

const PASS_THROUGH = /^(GENEALOGY_|OPENROUTER_|FS_ACCESS_TOKEN$|WIKI_API_URL$|POP_STATS_URL$)/;
const childEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (PASS_THROUGH.test(key) && value !== undefined) childEnv[key] = value;
}

const client = new Client({ name: "smoke-stdio", version: "0" });
const transport = new StdioClientTransport({
  command: "node",
  args: [entry],
  env: childEnv,
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
