// CLI for the Streamable HTTP tool server: `node build/http.js [--host H] [--port P]`.
//
// One long-lived process serving every patron's turns, so nothing that
// identifies a patron or a project is process state. The contract is two
// request headers:
//   Authorization: Bearer <token>   → the principal (http-server.ts, never LOCAL)
//   X-Genealogy-Project-Id: <id>    → a PgS3ProjectStore for that project, bound
//                                     for the request through runWithProjectStore
// The process store is an `unboundProjectStore`, so a code path that runs
// outside a request binding fails instead of reaching the file backend. The
// Pg/S3 configuration is the one process-wide thing, read from the
// GENEALOGY_* environment (store/pg-s3-env.ts; the project id is the header,
// never a variable); a missing variable, a half-set S3 key pair or an invalid
// GENEALOGY_S3_FORCE_PATH_STYLE is one stderr line and exit 2 before listen.
// With neither S3 key set the AWS SDK default chain supplies credentials
// (environment, ~/.aws shared config/SSO, web identity, then instance
// metadata); one stderr line names the mode, never a key.
import { parseArgs } from "node:util";
import { LOCAL } from "./auth/principal.js";
import { loadConfig } from "./auth/config.js";
import { startHttpServer, MCP_PATH } from "./http-server.js";
import { createPgS3Backend, PgS3ProjectStore } from "./store/pg-s3-project-store.js";
import { readPgS3Env } from "./store/pg-s3-env.js";
import { setProjectStore, unboundProjectStore } from "./store/project-store.js";
import { configFromEnv } from "./hosted-config-env.js";

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "8787" },
  },
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`--port must be an integer 0-65535, got ${JSON.stringify(values.port)}`);
  process.exit(2);
}

const storeEnv = readPgS3Env(process.env);
if (storeEnv.missing.length > 0) {
  process.stderr.write(`http: required environment not set: ${storeEnv.missing.join(", ")}\n`);
  process.exit(2);
}
if (storeEnv.invalid.length > 0) {
  process.stderr.write(
    `http: environment set to an invalid value (expected true or false): ${storeEnv.invalid.join(", ")}\n`,
  );
  process.exit(2);
}
const s3Options = storeEnv.backendOptions.s3;
process.stderr.write(
  `s3 credentials: ${s3Options.accessKeyId ? "static keys" : "SDK default chain"}; ` +
    `region ${s3Options.region}; endpoint ${s3Options.endpoint ?? "AWS default"}\n`,
);

// One pool and one S3 client for the process; a store per request over them.
const backend = createPgS3Backend(storeEnv.backendOptions);
setProjectStore(
  unboundProjectStore("build/http.js binds a project store per request; nothing may run outside one"),
);

// The one LOCAL read in this entrypoint: the process-wide config file
// (~/.familysearch-mcp/config.json — sidecar URLs, OpenRouter key, hosted
// flag). Every tool call binds a per-request bearer instead (http-server.ts).
//
// The environment overlays it (hosted-config-env.ts): a container receives the
// OpenRouter key as environment, so without the overlay `image_transcribe` has no key
// here.
const baseConfig = configFromEnv(process.env, await loadConfig(LOCAL));
const server = await startHttpServer({
  host: values.host as string,
  port,
  baseConfig,
  bindStore: (projectId, signal) =>
    new PgS3ProjectStore(backend, { projectId, anchorPath: storeEnv.anchorPath, signal }),
});

const address = server.address();
const boundPort = typeof address === "object" && address ? address.port : port;
console.error(`genealogy tool server listening on http://${values.host}:${boundPort}${MCP_PATH}`);

/** How long a shutdown waits for in-flight requests and the pool to drain
 *  before the process exits regardless. */
const SHUTDOWN_GRACE_MS = 5_000;

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  const closed = new Promise<void>((resolve) => server.close(() => resolve())).then(() =>
    backend.close().catch(() => {}),
  );
  // server.close() waits without a deadline on an in-flight body, and
  // pool.end() on a checked-out connection; give both a bounded grace, then
  // drop the sockets so `docker stop` gets a clean exit.
  const grace = new Promise<void>((resolve) =>
    setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, SHUTDOWN_GRACE_MS).unref(),
  );
  void Promise.race([closed, grace]).then(() => process.exit(0));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, shutdown);
}
