/**
 * smoke-http — drive a RUNNING Streamable HTTP tool server (build/http.js) and
 * call every advertised tool but the four named auth exclusions, through the
 * shared plan in dev/smoke-calls.ts. Proves the per-request principal reached
 * each FamilySearch tool (no bearer → HOSTED_REAUTH_INSTRUCTION), the
 * per-request ProjectStore bound from `X-Genealogy-Project-Id` takes the
 * writers, and the public-network tools answer.
 *
 *   GENEALOGY_PG_DSN=… GENEALOGY_S3_… node build/http.js --port 8787 &
 *   npx tsx dev/smoke-http.ts [--base http://127.0.0.1:8787] [--project-id ID]
 *                             [--project-path /project] [--host-config] [--bearer TOKEN]
 *
 * `--project-id` (default: a fresh `smoke-<uuid>`) is sent as the header on every
 * request; `--project-path` (default `/project`, the store's anchor) is the
 * projectPath every call passes. The server has no file root, so no host-side
 * fixture is ever written. `--host-config` says the server's base config is THIS
 * host's ~/.familysearch-mcp/config.json (build/http.js on the host, not the
 * compose `tools` service), which decides the `image_transcribe` expectation.
 * Exit 0 with one line per call; exit 1 naming every failure.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import {
  anchoredProject,
  assertCoverage,
  callViaClient,
  detectBearer,
  hostOpenRouterKeyConfigured,
  printHeader,
  report,
  runPlan,
  type SmokeCtx,
} from "./smoke-calls.js";

/** The wire spelling of the per-request project header (src/http-server.ts PROJECT_ID_HEADER). */
const PROJECT_ID_HEADER = "X-Genealogy-Project-Id";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:8787" },
    "project-id": { type: "string" },
    "project-path": { type: "string", default: "/project" },
    "host-config": { type: "boolean", default: false },
    bearer: { type: "string" },
  },
});

const base = (values.base as string).replace(/\/$/, "");
const projectId = values["project-id"] ?? `smoke-${randomUUID()}`;
const hostConfig = values["host-config"] === true;
const bearer = await detectBearer(values.bearer);
const project = anchoredProject(values["project-path"] as string);
const ctx: SmokeCtx = {
  mode: bearer ? "bearer" : "no-bearer",
  projectPath: project.projectPath,
  hostProjectDir: project.hostProjectDir,
  missingProjectPath: project.missingProjectPath,
  openRouterKeyConfigured: await hostOpenRouterKeyConfigured(hostConfig),
  values: {},
};

const headers: Record<string, string> = { [PROJECT_ID_HEADER]: projectId };
if (bearer) headers.Authorization = `Bearer ${bearer}`;
const client = new Client({ name: "smoke-http", version: "0" });
const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers },
});

printHeader("smoke-http", ctx, [`base=${base}`, `project-id=${projectId}`, `host-config=${hostConfig}`]);

let failures: string[] = [];
let calls = 0;
try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const problems = assertCoverage(tools.map((t) => t.name));
  report("tools/list coverage", problems.length === 0, problems.length === 0 ? `${tools.length} tools advertised, all planned or excluded` : problems.join("; "));
  if (problems.length > 0) failures.push("tools/list coverage");

  const run = await runPlan((tool, args) => callViaClient(client, tool, args), ctx);
  calls = run.calls;
  failures = failures.concat(run.failures);
} catch (error) {
  report("transport", false, error instanceof Error ? error.message : String(error));
  failures.push("transport");
} finally {
  await client.close().catch(() => {});
  await project.cleanup();
}

console.log(`${calls} call(s), mode=${ctx.mode}, project-id=${projectId}, ${failures.length} failed`);
if (failures.length > 0) {
  console.error(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
