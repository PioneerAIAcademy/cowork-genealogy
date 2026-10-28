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
 *                             [--pg-dsn DSN]
 *
 * Two clients, because the server admits a project request only for the bearer
 * stamped on an open attempt of that project (U4):
 *   - client one sends no project header and the real bearer when there is one
 *     (`--bearer`, else this host's unexpired token). It lists the tools and runs
 *     every row that passes no `projectPath`: the FamilySearch and store-less rows.
 *   - client two sends a synthetic random bearer, the project header and the claim
 *     fence (`X-Genealogy-Turn-Id` / `X-Genealogy-Claim-Epoch`) of a `turns` row
 *     this smoke seeds in Postgres, open at epoch 1 and stamped with the bearer's
 *     sha256 the way the worker stamps a real attempt. It runs every row that
 *     passes a `projectPath`. The row is deleted on every exit path.
 * Seeding needs the database the server reads: `--pg-dsn`, else GENEALOGY_PG_DSN.
 *
 * `--project-id` (default: a fresh `smoke-<uuid>`) is client two's project
 * header; `--project-path` (default `/project`, the store's anchor) is the
 * projectPath every call passes. The server has no file root, so no host-side
 * fixture is ever written. `--host-config` says the server's base config is THIS
 * host's ~/.familysearch-mcp/config.json (build/http.js on the host, not the
 * compose `tools` service), which decides the `image_transcribe` expectation.
 * Exit 0 with one line per call; exit 1 naming every failure; exit 2 on usage.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";
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

/** The wire spellings of the per-request headers (src/http-server.ts). */
const PROJECT_ID_HEADER = "X-Genealogy-Project-Id";
const TURN_ID_HEADER = "X-Genealogy-Turn-Id";
const CLAIM_EPOCH_HEADER = "X-Genealogy-Claim-Epoch";
const CLAIM_EPOCH = 1;

/** The seeded attempt: an open turn at CLAIM_EPOCH carrying the bearer's hash.
 *  `message` is NOT NULL (001_schema.sql); nothing else without a default is. */
const SEED_TURN_SQL =
  "INSERT INTO turns (turn_id, session_id, project_id, message, claimed_at, claim_epoch, bearer_sha256) " +
  "VALUES ($1, $2, $3, '{}'::jsonb, now(), $4, $5)";
const DELETE_TURN_SQL = "DELETE FROM turns WHERE turn_id = $1";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:8787" },
    "project-id": { type: "string" },
    "project-path": { type: "string", default: "/project" },
    "host-config": { type: "boolean", default: false },
    bearer: { type: "string" },
    "pg-dsn": { type: "string" },
  },
});

const pgDsn = values["pg-dsn"] || process.env.GENEALOGY_PG_DSN;
if (!pgDsn) {
  console.error(
    "smoke-http: the project rows need a turns row stamped with their bearer, so pass --pg-dsn " +
      "or set GENEALOGY_PG_DSN to the Postgres the tool server reads (make engine-smoke-http passes it).",
  );
  process.exit(2);
}

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

const turnId = randomUUID();
const sessionId = `smoke-${randomUUID()}`;
const projectBearer = `smoke-${randomBytes(32).toString("hex")}`;
const projectBearerSha256 = createHash("sha256").update(projectBearer).digest("hex");

/** An error's message; node's connect AggregateError has an empty one, so fall back to its code. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message || (error as NodeJS.ErrnoException).code || String(error);
}

function transportFor(headers: Record<string, string>): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } });
}

const plainHeaders: Record<string, string> = {};
if (bearer) plainHeaders.Authorization = `Bearer ${bearer}`;
const plainClient = new Client({ name: "smoke-http", version: "0" });
const projectClient = new Client({ name: "smoke-http-project", version: "0" });

printHeader("smoke-http", ctx, [
  `base=${base}`,
  `project-id=${projectId}`,
  `turn-id=${turnId}`,
  `host-config=${hostConfig}`,
]);

const db = new pg.Client({ connectionString: pgDsn, connectionTimeoutMillis: 10_000 });
let connected = false;
let seeded = false;
let cleaning: Promise<string | null> | null = null;

/** Delete the seeded row and close Postgres, once; the error message, or null. */
function cleanup(): Promise<string | null> {
  cleaning ??= (async () => {
    let error: string | null = null;
    // Once connected, always delete: an INSERT interrupted mid-flight may still have
    // committed, and deleting a turn_id never inserted is a no-op.
    if (connected) {
      try {
        await db.query(DELETE_TURN_SQL, [turnId]);
      } catch (e) {
        error = describe(e);
      }
    }
    await db.end().catch(() => {});
    return error;
  })();
  return cleaning;
}

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(code));
  });
}

let failures: string[] = [];
let calls = 0;
let stage = "seed turns row";
try {
  await db.connect();
  connected = true;
  await db.query(SEED_TURN_SQL, [turnId, sessionId, projectId, CLAIM_EPOCH, projectBearerSha256]);
  seeded = true;

  stage = "client one connect";
  await plainClient.connect(transportFor(plainHeaders));
  const { tools } = await plainClient.listTools();
  const problems = assertCoverage(tools.map((t) => t.name));
  report("tools/list coverage", problems.length === 0, problems.length === 0 ? `${tools.length} tools advertised, all planned or excluded` : problems.join("; "));
  if (problems.length > 0) failures.push("tools/list coverage");

  stage = "client two connect (stamped turn)";
  await projectClient.connect(
    transportFor({
      [PROJECT_ID_HEADER]: projectId,
      [TURN_ID_HEADER]: turnId,
      [CLAIM_EPOCH_HEADER]: String(CLAIM_EPOCH),
      Authorization: `Bearer ${projectBearer}`,
    }),
  );

  // A row that passes projectPath reaches the store, so it needs the project
  // header and the door, as does project_list, which reads the bound store with
  // no projectPath; every other row must work with no project bound.
  stage = "plan";
  const run = await runPlan(
    (tool, args) =>
      callViaClient("projectPath" in args || tool === "project_list" ? projectClient : plainClient, tool, args),
    ctx,
  );
  calls = run.calls;
  failures = failures.concat(run.failures);
} catch (error) {
  report(stage, false, describe(error));
  failures.push(stage);
} finally {
  await plainClient.close().catch(() => {});
  await projectClient.close().catch(() => {});
  await project.cleanup();
  const cleanupError = await cleanup();
  if (seeded) {
    report("delete seeded turns row", cleanupError === null, cleanupError ?? `turn_id=${turnId}`);
    if (cleanupError !== null) failures.push("delete seeded turns row");
  }
}

console.log(`${calls} call(s), mode=${ctx.mode}, project-id=${projectId}, ${failures.length} failed`);
if (failures.length > 0) {
  console.error(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
