// CLI for the Streamable HTTP tool server: `node build/http.js [--host H] [--port P]`.
//
// One long-lived process serving every patron's turns, so nothing that
// identifies a patron or a project is process state. The contract is two
// request headers:
//   Authorization: Bearer <token>   → the principal (http-server.ts, never LOCAL)
//   X-Genealogy-Project-Id: <id>    → a PgS3ProjectStore for that project, bound
//                                     for the request through runWithProjectStore
// plus a claim-fence pair (U6), both or neither (400 otherwise):
//   X-Genealogy-Turn-Id: <turn>     → that store commits a write only while
//   X-Genealogy-Claim-Epoch: <n>      `turns.claim_epoch` is still n, so an
//                                     attempt a newer claim superseded writes nothing
// A request that names a project is admitted only when its bearer is the grant
// of an open attempt on it (U4, `authorizeAttempt`): the sha256 of the bearer
// must be the `turns.bearer_sha256` the worker stamped on the fence's turn,
// that turn must belong to the project, and it must not be completed. So the
// fence is required with a project; anything else is a 403 before any store
// exists, and a failed lookup is a 503. There is no opt-out. A request with no
// project header takes the connector door (E1, src/http-server.ts).
// The process store is an `unboundProjectStore`, so a code path that runs
// outside a request binding fails instead of reaching the file backend. The
// Pg/S3 configuration is the one process-wide thing, read from the
// GENEALOGY_* environment (store/pg-s3-env.ts; the project id is the header,
// never a variable); a missing variable, a half-set S3 key pair or an invalid
// GENEALOGY_S3_FORCE_PATH_STYLE (or orphan sweep variable) is one stderr line
// and exit 2 before listen.
// GENEALOGY_PG_SAS_OBJECT (U29) reads the Postgres credentials from that SAS
// fchDatabase object instead of GENEALOGY_PG_DSN (both set is exit 2). It is
// resolved before listen: @fs/sas-client absent or an unusable object is exit 2,
// SAS unreachable after 3 tries is exit 1. A 28P01 re-reads it (pg-credentials.ts).
// With neither S3 key set the AWS SDK default chain supplies credentials
// (environment, ~/.aws shared config/SSO, web identity, then instance
// metadata); one stderr line names the mode, never a key. A set debug hold
// (debug-holds.ts) is one more stderr line, so a forgotten one shows in the
// logs; with neither set, nothing is printed. Nothing connects
// before listen: `GET /healthz` probes Postgres (schema included) and S3 per
// request and answers 503 while either is unreachable, never exiting; `GET /livez`
// probes neither and answers 200.
//
// Two process-wide limits are read here too (store/limits-env.ts, self-hosted
// beta E4), each OFF unless set, so an unset environment behaves as it always
// has: GENEALOGY_FS_CALLS_PER_MINUTE, a sliding-60s FamilySearch request budget
// for the whole process, and GENEALOGY_MAX_TRANSCRIPTIONS, a cap on concurrent
// transcriptions (set it at 5 or above -- person_read transcribes five memories
// at a time). Either set to anything but a whole number in range joins the same
// invalid-value line and exit 2 above; otherwise one stderr line names each, or
// says "off". GENEALOGY_SHARED_COLLECTIONS_CACHE=true makes collections_search's
// catalog cache one for the process rather than one slot per token; unset or
// false keeps it per token, and anything but true/false is exit 2 the same way.
//
// The process also runs the S3 orphan sweep (store/s3-orphan-sweep.ts, U19):
// GENEALOGY_ORPHAN_SWEEP_INTERVAL_S (3600; 0 = off; at most 2147483, setTimeout's
// limit) and GENEALOGY_ORPHAN_GRACE_S
// (86400, at least 3600). The first pass waits a minute so it never contends
// with boot; each pass is one `ev=orphan_sweep` stderr line.
import { parseArgs } from "node:util";
import { LOCAL } from "./auth/principal.js";
import { loadConfig } from "./auth/config.js";
import { startHttpServer, MCP_PATH } from "./http-server.js";
import { authorizeAttempt, createPgS3Backend, PgS3ProjectStore, readyLabel,
  lookupConnectorToken,
  projectOwnerOf,
} from "./store/pg-s3-project-store.js";
import { readLimitsEnv } from "./store/limits-env.js";
import { configureFsBudget } from "./utils/fs-budget.js";
import { configureTranscriptionCap } from "./utils/ocr.js";
import { collectionsCacheMode, configureCollectionsCache } from "./tools/collections-search.js";
import { readPgS3Env } from "./store/pg-s3-env.js";
import { loadSasClient, SasClientMissing, SasObjectInvalid, SasPgCredentials } from "./store/pg-credentials.js";
import { startOrphanSweep, type OrphanSweepTimer } from "./store/s3-orphan-sweep.js";
import { setProjectStore, unboundProjectStore } from "./store/project-store.js";
import { decrypt, DEV_FS_TOKEN_ENC_KEY } from "./auth/fernet.js";
import { configFromEnv, isPlainHttpUrl } from "./hosted-config-env.js";
import type { AppConfig } from "./types/auth.js";
import { debugHoldStartupLine } from "./debug-holds.js";

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
const limitsEnv = readLimitsEnv(process.env);
if (storeEnv.missing.length > 0) {
  process.stderr.write(`http: required environment not set: ${storeEnv.missing.join(", ")}\n`);
  process.exit(2);
}
// One branch for both parsers: an invalid value from either exits 2 before
// `listen`, so a mistyped limit cannot start a server that silently has none.
const invalidEnv = [...storeEnv.invalid, ...limitsEnv.invalid];
if (invalidEnv.length > 0) {
  process.stderr.write(
    `http: environment set to an invalid value: ${invalidEnv.join(", ")} ` +
      "(GENEALOGY_S3_FORCE_PATH_STYLE takes true or false; the GENEALOGY_ORPHAN_* variables whole seconds, " +
      "the grace at least 3600, the interval at most 2147483; " +
      "GENEALOGY_PG_SAS_OBJECT and GENEALOGY_PG_DSN are exclusive; " +
      "GENEALOGY_FS_CALLS_PER_MINUTE and GENEALOGY_MAX_TRANSCRIPTIONS whole numbers above 0; " +
      "GENEALOGY_SHARED_COLLECTIONS_CACHE true or false)\n",
  );
  process.exit(2);
}
// The one LOCAL read in this entrypoint: the process-wide config file
// (~/.familysearch-mcp/config.json — sidecar URLs, OpenRouter key, hosted
// flag). Every tool call binds a per-request bearer instead (http-server.ts).
//
// The environment overlays it (hosted-config-env.ts): a container receives the
// OpenRouter key as environment, so without the overlay `image_transcribe` has no key
// here. Read before the backend is built, so a bad value refuses start-up as above.
let baseConfig: AppConfig;
try {
  baseConfig = configFromEnv(process.env, await loadConfig(LOCAL));
} catch (e) {
  process.stderr.write(`http: environment set to an invalid value: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}
const { pgSasObject } = storeEnv;
if (pgSasObject) {
  let sas;
  try {
    sas = loadSasClient();
  } catch (e) {
    if (!(e instanceof SasClientMissing)) throw e;
    process.stderr.write(
      "http: GENEALOGY_PG_SAS_OBJECT is set but @fs/sas-client is not installed " +
        "(FamilySearch's build installs it; use GENEALOGY_PG_DSN elsewhere)\n",
    );
    process.exit(2);
  }
  try {
    storeEnv.backendOptions.pgCredentials = await SasPgCredentials.resolveAtStart(sas, pgSasObject);
  } catch (e) {
    if (e instanceof SasObjectInvalid) {
      process.stderr.write(`http: SAS object ${pgSasObject} unusable: ${e.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`http: SAS object ${pgSasObject} unavailable (${readyLabel(e)})\n`);
    process.exit(1);
  }
}
process.stderr.write(`pg credentials: ${pgSasObject ? `SAS object ${pgSasObject}` : "environment DSN"}\n`);
const s3Options = storeEnv.backendOptions.s3;
process.stderr.write(
  `s3 credentials: ${s3Options.accessKeyId ? "static keys" : "SDK default chain"}; ` +
    `region ${s3Options.region}; endpoint ${s3Options.endpoint ?? "AWS default"}\n`,
);
const { intervalS, graceS } = storeEnv.orphanSweep;
process.stderr.write(
  intervalS > 0 ? `orphan sweep: every ${intervalS} s, grace ${graceS} s\n` : "orphan sweep: off\n",
);
// `invalid` was non-empty above and exited 2, so neither value is `null` here.
// Narrowed explicitly rather than cast: this is the point the parser's three
// states collapse to two, and it should be visible.
const fsPerMinute = limitsEnv.fsCallsPerMinute ?? undefined;
const maxTranscriptions = limitsEnv.maxTranscriptions ?? undefined;
configureFsBudget({ perMinute: fsPerMinute });
process.stderr.write(
  fsPerMinute !== undefined ? `fs budget: ${fsPerMinute} calls/min\n` : "fs budget: off\n",
);
configureTranscriptionCap({ max: maxTranscriptions });
process.stderr.write(
  maxTranscriptions !== undefined
    ? `transcription cap: ${maxTranscriptions} at a time\n`
    : "transcription cap: off\n",
);
configureCollectionsCache({ shared: limitsEnv.sharedCollectionsCache === true });
process.stderr.write(`collections cache: ${collectionsCacheMode()}\n`);
// The connector door's two settings (self-hosted beta E1), read once here the
// way readPgS3Env is; no getter reads process.env.
//
// FS_TOKEN_ENC_KEY falls back to the SAME development default as
// apps/server/proto/grants.py, because compose passes ${FS_TOKEN_ENC_KEY:-} to
// web and worker and all tiers must agree byte for byte -- without the fallback
// a --connector smoke on a plain `make proto-up` decrypts nothing.
const fsTokenEncKey = (process.env.FS_TOKEN_ENC_KEY ?? "").trim() || DEV_FS_TOKEN_ENC_KEY;
// The web tier's issuer, printed byte for byte. Unset, the metadata route 404s
// and a 401 carries a bare `Bearer`.
const issuer = (process.env.OAUTH_ISSUER ?? "").trim() || undefined;

// It is interpolated into a `WWW-Authenticate` header value and served as the
// metadata document, so it gets the SAME shape check WEB_PUBLIC_URL already
// has (`isPlainHttpUrl`): a control character in a header value makes
// `writeHead` throw, turning every 401 on this door into a 500 with no
// challenge at all, and a quote or comma produces a challenge clients parse
// into the wrong metadata URL.
if (issuer !== undefined && !isPlainHttpUrl(issuer)) {
  process.stderr.write(
    "http: OAUTH_ISSUER must be a plain http(s) URL with no credentials, space, " +
      "backslash, '#', '?' or control character. It is served as the " +
      "protected-resource metadata and sent in the WWW-Authenticate header.\n",
  );
  process.exit(2);
}

// The development key is public in this repository, so a real deployment
// running on it has every stored FamilySearch token encrypted under a key
// anyone can derive.
//
// "Real deployment" is NOT just an https issuer. apps/server/proto/web/auth.py
// `preflight()` refuses on `is_https() OR familysearch_enabled()`, and its
// docstring says the second disjunct exists precisely for the non-https case.
// The first version of this guard kept only the https half, which could not
// fire at all in the documented default (OAUTH_ISSUER unset) -- so the one
// configuration everyone runs was the one configuration unprotected.
//
// Loopback is a developer's own machine; any other host one of these URLs
// names is a deployment other people reach. The first version tested
// `https://` only -- case-sensitively, against a scheme that is not -- so an
// `HTTPS://` issuer, and every non-loopback `http://` one, started on the
// public key.
function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

// BOTH public URLs this tier can be given, not just the issuer. OAUTH_ISSUER
// is documented as unset by default, so a guard keyed on it alone cannot fire
// in the configuration the handoff tells an operator to deploy -- which is how
// the worst case gets through: a real key on web and worker, none on tools, no
// issuer, every connector call then decrypting to null and answering the
// deliberately-opaque 401 for every patron, forever. WEB_PUBLIC_URL is the
// other marker of a deployment people reach, and compose leaves both unset, so
// a developer's `make proto-up` is untouched. The worker refuses the default
// key outright (`grants.key_mode`, worker.py); this is the tools tier's
// nearest equivalent.
const publicUrls = [issuer, baseConfig.webPublicUrl].filter(
  (url): url is string => typeof url === "string" && url !== "",
);
const deploymentUrl = publicUrls.find((url) => !isLoopbackUrl(url));
if (fsTokenEncKey === DEV_FS_TOKEN_ENC_KEY && deploymentUrl !== undefined) {
  process.stderr.write(
    `http: FS_TOKEN_ENC_KEY is unset while this tier is configured with a ` +
      `non-loopback public URL (${deploymentUrl}), so every stored FamilySearch ` +
      `token would be encrypted under a key that is public in this repository. ` +
      `Set FS_TOKEN_ENC_KEY to the value the web and worker tiers use.\n`,
  );
  process.exit(2);
}
process.stderr.write(
  `connector door: issuer=${issuer ?? "unset"} fs-token-key=${fsTokenEncKey === DEV_FS_TOKEN_ENC_KEY ? "default" : "set"}\n`,
);

const holdLine = debugHoldStartupLine(process.env);
if (holdLine) process.stderr.write(holdLine);

// One pool and one S3 client for the process; a store per request over them.
const backend = createPgS3Backend(storeEnv.backendOptions);
const sweep: OrphanSweepTimer | undefined =
  intervalS > 0
    ? startOrphanSweep(backend, {
        intervalMs: intervalS * 1000,
        graceMs: graceS * 1000,
        firstDelayMs: 60_000 + Math.floor(Math.random() * 30_000),
      })
    : undefined;
setProjectStore(
  unboundProjectStore("build/http.js binds a project store per request; nothing may run outside one"),
);

const server = await startHttpServer({
  host: values.host as string,
  port,
  baseConfig,
  bindStore: (projectId, signal, fence, opts) =>
    new PgS3ProjectStore(backend, {
      projectId,
      // A connector names its own project path, and the store's anchor MUST be
      // that path: every tool call's projectPath is checked against it exactly.
      // The worker keeps GENEALOGY_ANCHOR_PATH.
      anchorPath: opts?.anchorPath ?? storeEnv.anchorPath,
      signal,
      fence,
      ownerId: opts?.ownerId,
    }),
  authorize: (req) => authorizeAttempt(backend, req),
  lookupConnector: (tokenSha256) =>
    lookupConnectorToken(backend, tokenSha256, (ciphertext) => decrypt(ciphertext, fsTokenEncKey)),
  projectOwner: (projectId) => projectOwnerOf(backend, projectId),
  issuer,
  checkReady: () => backend.checkReady(),
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
  sweep?.stop();
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
