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
 *                             [--pg-dsn DSN] [--offline-only]
 *
 * `--offline-only` runs just the SmokeStep.offline rows — no network and no
 * credentials — which is what the CI job uses. `assertCoverage` still runs over
 * the WHOLE plan, so a newly advertised tool with no row still fails.
 *
 * Two clients, because the server admits a project request only for the bearer
 * stamped on an open attempt of that project (U4):
 *   - client one presents the connector token under `--connector`, otherwise the
 *     stamped turn's headers
 *     (`--bearer`, else this host's unexpired token). It lists the tools and runs
 *     every row that passes no `projectPath`: the FamilySearch and store-less rows.
 *   - client two sends a synthetic random bearer, the project header and the claim
 *     fence (`X-Genealogy-Turn-Id` / `X-Genealogy-Claim-Epoch`) of a `turns` row
 *     this smoke seeds in Postgres, open at epoch 1 and stamped with the bearer's
 *     sha256 the way the worker stamps a real attempt. It runs every row that
 *     passes a `projectPath`, and under `--connector` it lists the tools too, because
 *     that list is the only sight of the worker door. The row is deleted on every
 *     exit path.
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
import { encrypt, DEV_FS_TOKEN_ENC_KEY } from "../src/auth/fernet.js";
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

// ── the connector caller (self-hosted beta E1) ──────────────────────────────
//
// Seeded only with `--connector`: a user, their Fernet-encrypted FamilySearch
// token, and a connector token for the same user. Without the flag the smoke
// runs against a tools tier with no encryption key, exactly as today.

const SEED_USER_SQL =
  "INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING";
const SEED_FS_TOKEN_SQL =
  "INSERT INTO familysearch_tokens (user_id, access_token_enc, expires_at, granted_at) " +
  "VALUES ($1, $2, now() + interval '1 hour', now()) " +
  "ON CONFLICT (user_id) DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc";
const SEED_CONNECTOR_TOKEN_SQL =
  "INSERT INTO connector_tokens (token_sha256, user_id, client_id, scopes, expires_at) " +
  "VALUES ($1, $2, 'smoke', ARRAY['mcp'], now() + interval '1 hour')";
const SEED_OWNED_PROJECT_SQL = "INSERT INTO projects (project_id, owner_id) VALUES ($1, $2)";
const SEED_RESEARCH_SQL =
  "INSERT INTO documents (project_id, name, doc) VALUES ($1, 'research.json', '{\"project\": {}}'::jsonb)";

/**
 * Teardown is ORDERED, and the order is the point.
 *
 * `projects.owner_id REFERENCES users(id)` carries NO `ON DELETE`
 * (008_auth_owner.sql), unlike connector_tokens and familysearch_tokens, which
 * both CASCADE. The connector client runs the store rows of the plan, so by
 * exit it owns a project — and deleting the user first raises 23503 on every
 * single run. Every project goes before any user.
 */
const CONNECTOR_PROJECT_TEARDOWN_SQL: readonly string[] = [
  "DELETE FROM staging WHERE project_id = $1",
  "DELETE FROM blobs WHERE project_id = $1",
  "DELETE FROM documents WHERE project_id = $1",
  "DELETE FROM projects WHERE project_id = $1",
];
/** Only after the projects: connector_tokens and familysearch_tokens go by CASCADE. */
const CONNECTOR_USER_TEARDOWN_SQL = "DELETE FROM users WHERE id = $1";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:8787" },
    "project-id": { type: "string" },
    "project-path": { type: "string", default: "/project" },
    "host-config": { type: "boolean", default: false },
    bearer: { type: "string" },
    "pg-dsn": { type: "string" },
    "offline-only": { type: "boolean", default: false },
    connector: { type: "boolean", default: false },
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
const offlineOnly = values["offline-only"] === true;

const connectorEnabled = values.connector === true;
/**
 * The connector's OWN project path. Not `--project-path` (which is the worker's
 * `/project`) and not `smoke_http_id`'s `smoke-<uuid>`: the door admits only
 * `/proj_<16 lowercase hex>`, so either of those is refused before a store
 * exists and every connector row fails for the wrong reason.
 */
const connectorProjectPath = `/proj_${randomBytes(8).toString("hex")}`;
const connectorProjectId = connectorProjectPath.slice(1);
/** Seeded for the listing check: the caller's second project, and another user's. */
const secondProjectPath = `/proj_${randomBytes(8).toString("hex")}`;
const foreignProjectPath = `/proj_${randomBytes(8).toString("hex")}`;
const connectorUserId = `smoke-user-${randomUUID()}`;
const foreignUserId = `smoke-user-${randomUUID()}`;
const connectorToken = `smoke-connector-${randomBytes(32).toString("hex")}`;
const connectorTokenSha256 = createHash("sha256").update(connectorToken).digest("hex");
/** All tiers agree on this when FS_TOKEN_ENC_KEY is unset (grants.py). */
const fsTokenEncKey = (process.env.FS_TOKEN_ENC_KEY ?? "").trim() || DEV_FS_TOKEN_ENC_KEY;

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
/**
 * The bearer the stamped turn carries, and the one every plan row now presents.
 *
 * The HOST'S FamilySearch token when there is one, so a FamilySearch row
 * actually reaches FamilySearch. A random value when there is none: the turn is
 * stamped with its hash, the door admits it, and the row is judged by `reauth`,
 * which accepts the 401 or "login tool" wording FamilySearch's refusal reaches
 * the tools as. A random bearer is NOT empty, so `getValidToken` hands it
 * straight to FamilySearch rather than raising the hosted reauth instruction —
 * which is why `reauth` had to widen with this.
 */
const projectBearer = bearer || `smoke-${randomBytes(32).toString("hex")}`;
const projectBearerSha256 = createHash("sha256").update(projectBearer).digest("hex");

/** An error's message; node's connect AggregateError has an empty one, so fall back to its code. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message || (error as NodeJS.ErrnoException).code || String(error);
}

function transportFor(headers: Record<string, string>): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } });
}

/**
 * "Client one" — the one that lists tools and reads auth_status. It used to
 * send no headers at all, which under one front door (E1) is an
 * unauthenticated connector request and a 401. It now presents an identity:
 * the connector token when that arm is on, otherwise the stamped turn's
 * headers, which is the only other door there is.
 *
 * A host FamilySearch token, when there is one, still rides along so
 * auth_status reports what it used to.
 */
const plainHeaders: Record<string, string> = connectorEnabled
  ? { Authorization: `Bearer ${connectorToken}` }
  : {
      [PROJECT_ID_HEADER]: projectId,
      [TURN_ID_HEADER]: turnId,
      [CLAIM_EPOCH_HEADER]: String(CLAIM_EPOCH),
      Authorization: `Bearer ${projectBearer}`,
    };
const plainClient = new Client({ name: "smoke-http", version: "0" });
const projectClient = new Client({ name: "smoke-http-project", version: "0" });
const connectorClient = new Client({ name: "smoke-http-connector", version: "0" });

printHeader("smoke-http", ctx, [
  `base=${base}`,
  `project-id=${projectId}`,
  `turn-id=${turnId}`,
  `host-config=${hostConfig}`,
  `connector=${connectorEnabled}`,
  `offline-only=${offlineOnly}`,
]);

const db = new pg.Client({ connectionString: pgDsn, connectionTimeoutMillis: 10_000 });
let connected = false;
let seeded = false;
let connectorSeeded = false;
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
      if (connectorSeeded) {
        // In order: each project's rows, then the project, then the users. See
        // CONNECTOR_PROJECT_TEARDOWN_SQL — the other way round is a foreign-key
        // error on every run.
        const steps: Array<[string, string]> = [
          ...[connectorProjectId, secondProjectPath.slice(1), foreignProjectPath.slice(1)].flatMap((id) =>
            CONNECTOR_PROJECT_TEARDOWN_SQL.map((sql): [string, string] => [sql, id]),
          ),
          [CONNECTOR_USER_TEARDOWN_SQL, connectorUserId],
          [CONNECTOR_USER_TEARDOWN_SQL, foreignUserId],
        ];
        for (const [sql, key] of steps) {
          try {
            await db.query(sql, [key]);
          } catch (e) {
            error ??= describe(e);
          }
        }
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

/** One door's tool list against the plan. */
async function checkCoverage(client: Client, label: string, connector: boolean): Promise<void> {
  const { tools } = await client.listTools();
  const problems = assertCoverage(tools.map((t) => t.name), { connector });
  report(label, problems.length === 0, problems.length === 0 ? `${tools.length} tools advertised, all planned or excluded` : problems.join("; "));
  if (problems.length > 0) failures.push(label);
}

try {
  await db.connect();
  connected = true;
  await db.query(SEED_TURN_SQL, [turnId, sessionId, projectId, CLAIM_EPOCH, projectBearerSha256]);
  seeded = true;

  if (connectorEnabled) {
    stage = "seed connector rows";
    // Armed BEFORE the first insert, not after the last. Each of these three
    // statements autocommits, so a throw on the second or third used to leave
    // the committed `users` row behind with nothing to delete it -- and the id
    // is a fresh randomUUID() every run, so the strays accumulated unseen.
    // Teardown of a row that was never written is a no-op.
    connectorSeeded = true;
    await db.query(SEED_USER_SQL, [connectorUserId, `${connectorUserId}@smoke.invalid`]);
    // The host's FamilySearch token when there is one, so a connector run can
    // reach upstream; otherwise a placeholder, which decrypts fine and is
    // refused by FamilySearch exactly as a bearer-less run is.
    await db.query(SEED_FS_TOKEN_SQL, [
      connectorUserId,
      encrypt(bearer || "no-familysearch-token-on-this-host", fsTokenEncKey),
    ]);
    await db.query(SEED_CONNECTOR_TOKEN_SQL, [connectorTokenSha256, connectorUserId]);
  }

  stage = "client one connect";
  await plainClient.connect(transportFor(plainHeaders));
  await checkCoverage(plainClient, "tools/list coverage", connectorEnabled);

  stage = "client two connect (stamped turn)";
  await projectClient.connect(
    transportFor({
      [PROJECT_ID_HEADER]: projectId,
      [TURN_ID_HEADER]: turnId,
      [CLAIM_EPOCH_HEADER]: String(CLAIM_EPOCH),
      Authorization: `Bearer ${projectBearer}`,
    }),
  );
  if (connectorEnabled) await checkCoverage(projectClient, "tools/list coverage (worker)", false);

  // EVERY row goes through the stamped-turn client now (E1). It used to split:
  // rows passing a projectPath went to the project client, everything else to a
  // client with no headers at all. Under one front door that second client is
  // an unauthenticated connector request, which is a 401 — correctly so, and
  // the door refusing it is the feature, not a regression. The plain client
  // stays only for the no-bearer checks above.
  stage = "plan";
  const run = await runPlan(
    (tool, args) => callViaClient(projectClient, tool, args),
    ctx,
    {
      offlineOnly,
      // A FamilySearch row needs a FamilySearch token. Without one the stamped
      // bearer is a random value, which is NOT empty -- so getValidToken hands
      // it upstream rather than raising the reauth instruction, and the rows
      // that answer a bad bearer with something other than a 401
      // (`image_search`'s "could not resolve", `record_record_matches`'s
      // anonymous empty result) cannot be judged at all. Skipping with the
      // reason printed is honest; judging them against a token we do not have
      // is not.
      skip: (_tool, step) =>
        step.familySearch && ctx.mode === "no-bearer"
          ? "no FamilySearch token on this host"
          : null,
    },
  );
  calls = run.calls;
  failures = failures.concat(run.failures);

  if (connectorEnabled) {
    // The same plan through the CONNECTOR door: no project header at all, a
    // connector token, and the caller's own /proj_ path rewritten over every
    // row that passes one.
    stage = "connector client connect";
    await connectorClient.connect(transportFor({ Authorization: `Bearer ${connectorToken}` }));

    stage = "connector plan";
    const connectorCtx: SmokeCtx = {
      ...ctx,
      // NOT hardcoded "bearer": the seeded FamilySearch token is a placeholder
      // when this host has none, and claiming bearer mode makes every
      // expectation demand success against it.
      mode: ctx.mode,
      projectPath: connectorProjectPath,
      // A SECOND well-formed connector path that nothing has written. Not
      // `${connectorProjectPath}/nope`: that is malformed, so the door refuses
      // it at 400 before a store exists and the row fails for the wrong
      // reason. An unwritten /proj_ path has no projects row, so the door
      // admits it (the first write would claim it) and the store reads it as
      // an empty project, which is what `connector` makes this row require.
      missingProjectPath: `/proj_${randomBytes(8).toString("hex")}`,
      connector: true,
      values: {},
    };
    const connectorRun = await runPlan(
      (tool, args) => callViaClient(connectorClient, tool, args),
      connectorCtx,
      {
        offlineOnly,
        // The FamilySearch rows are excluded by the spec — "the connector
        // client runs no FamilySearch row" — because a connector's token comes
        // from the database, not the header, so these would test the seeded
        // placeholder rather than the door.
        skip: (_tool, step) => (step.familySearch ? "connector runs no FamilySearch row (E1)" : null),
      },
    );
    calls += connectorRun.calls;
    failures = failures.concat(connectorRun.failures.map((f) => `connector: ${f}`));

    // The owner check, which no plan row can reach: both of the caller's
    // projects, one fresh path, and never another user's project.
    stage = "connector listing";
    await db.query(SEED_USER_SQL, [foreignUserId, `${foreignUserId}@smoke.invalid`]);
    for (const [path, owner] of [
      [secondProjectPath, connectorUserId],
      [foreignProjectPath, foreignUserId],
    ] as const) {
      await db.query(SEED_OWNED_PROJECT_SQL, [path.slice(1), owner]);
      await db.query(SEED_RESEARCH_SQL, [path.slice(1)]);
    }
    const listing = await callViaClient(connectorClient, "project_list", {});
    const paths: string[] = (listing.body?.projects ?? []).map((p: any) => p?.projectPath);
    const fresh = listing.body?.newProjectPath;
    const wrong: string[] = [];
    if (listing.isError) wrong.push(`isError: ${listing.text.slice(0, 200)}`);
    for (const path of [connectorProjectPath, secondProjectPath]) {
      if (!paths.includes(path)) wrong.push(`own project missing: ${path}`);
    }
    if (paths.includes(foreignProjectPath)) wrong.push(`foreign project listed: ${foreignProjectPath}`);
    if (typeof fresh !== "string" || !/^\/proj_[0-9a-f]{16}$/.test(fresh) || paths.includes(fresh)) {
      wrong.push(`no fresh path: ${String(fresh)}`);
    }
    report(
      "connector: project_list owner check",
      wrong.length === 0,
      wrong.length === 0 ? `${paths.length} listed, fresh ${String(fresh)}` : wrong.join("; "),
    );
    calls += 1;
    if (wrong.length > 0) failures.push("connector: project_list owner check");
  }
} catch (error) {
  report(stage, false, describe(error));
  failures.push(stage);
} finally {
  await plainClient.close().catch(() => {});
  await projectClient.close().catch(() => {});
  await connectorClient.close().catch(() => {});
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
