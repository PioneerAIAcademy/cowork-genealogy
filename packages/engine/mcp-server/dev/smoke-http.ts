/**
 * smoke-http — drive a RUNNING Streamable HTTP tool server (build/http.js) and
 * call every advertised tool but the four named auth exclusions, through the
 * shared plan in dev/smoke-calls.ts. Proves the per-request principal reached
 * each FamilySearch tool (no bearer → HOSTED_REAUTH_INSTRUCTION), the
 * ProjectStore writers work over HTTP, and the public-network tools answer.
 *
 *   node build/http.js --port 8787 &
 *   npx tsx dev/smoke-http.ts [--base http://127.0.0.1:8787] [--project-root DIR] [--bearer TOKEN]
 *
 * `--project-root` that is not a directory on this host means the server runs
 * elsewhere (compose: /projects) and no host-side fixture can be written.
 * Exit 0 with one line per call; exit 1 naming every failure.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseArgs } from "node:util";
import {
  assertCoverage,
  callViaClient,
  detectBearer,
  hostOpenRouterKeyConfigured,
  prepareProject,
  printHeader,
  report,
  runPlan,
  type SmokeCtx,
} from "./smoke-calls.js";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:8787" },
    "project-root": { type: "string" },
    bearer: { type: "string" },
  },
});

const base = (values.base as string).replace(/\/$/, "");
const bearer = await detectBearer(values.bearer);
const project = await prepareProject(values["project-root"]);
const ctx: SmokeCtx = {
  mode: bearer ? "bearer" : "no-bearer",
  projectPath: project.projectPath,
  hostProjectDir: project.hostProjectDir,
  missingProjectPath: project.missingProjectPath,
  openRouterKeyConfigured: await hostOpenRouterKeyConfigured(project.hostProjectDir !== null),
  values: {},
};

const headers: Record<string, string> = bearer ? { Authorization: `Bearer ${bearer}` } : {};
const client = new Client({ name: "smoke-http", version: "0" });
const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers },
});

printHeader("smoke-http", ctx, [`base=${base}`]);

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

console.log(`${calls} call(s), mode=${ctx.mode}, ${failures.length} failed`);
if (failures.length > 0) {
  console.error(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
