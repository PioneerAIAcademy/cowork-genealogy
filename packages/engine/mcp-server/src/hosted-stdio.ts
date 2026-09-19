// The search-agent prototype's per-turn tool server. This is NOT the shipped
// .mcpb — that stays src/index.ts. The prototype worker forks one of these per
// turn over stdio and puts its whole configuration in the child's environment,
// because the worker sets that environment per turn: the plan's "travels
// per-request, never read from process state — stdio: env on the per-turn
// fork" (docs/plan/search-agent-prototype.md, "Auth" and D6–8). Nothing here
// reads ~/.familysearch-mcp, refreshes a token, or touches the filesystem —
// project state is the Postgres/S3 store for the one project the environment
// names, and the FamilySearch bearer is used exactly as given.
//
//   GENEALOGY_PG_DSN, GENEALOGY_S3_ENDPOINT, GENEALOGY_S3_BUCKET,
//   GENEALOGY_S3_ACCESS_KEY, GENEALOGY_S3_SECRET_KEY, GENEALOGY_PROJECT_ID
//       required
//   GENEALOGY_ANCHOR_PATH
//       the one `projectPath` the tools pass for this project (default /project)
//   FS_ACCESS_TOKEN
//       the patron's bearer; may be empty, and every FamilySearch tool then
//       answers with the reconnect instruction
//   WIKI_API_URL, POP_STATS_URL, OPENROUTER_API_KEY, OPENROUTER_MODEL
//       optional; the per-user config the desktop reads from config.json
//
// A missing required variable is one line on stderr and exit 2, before any
// connection is opened. The backend is closed when stdin ends or on SIGTERM.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { bearerPrincipal } from "./auth/principal.js";
import { createServer } from "./server.js";
import { createPgS3Backend, PgS3ProjectStore } from "./store/pg-s3-project-store.js";
import { readPgS3Env } from "./store/pg-s3-env.js";
import { setProjectStore } from "./store/project-store.js";
import type { AppConfig } from "./types/auth.js";

const storeEnv = readPgS3Env(process.env);
const missing = [...storeEnv.missing];
if (!process.env.GENEALOGY_PROJECT_ID) missing.push("GENEALOGY_PROJECT_ID");
if (missing.length > 0) {
  process.stderr.write(`hosted-stdio: required environment not set: ${missing.join(", ")}\n`);
  process.exit(2);
}

/** Only the keys that are set: an absent key must stay absent so each getter's
 *  own default applies, exactly as with a sparse config.json. */
const config: AppConfig = {};
if (process.env.WIKI_API_URL) config.wikiApiUrl = process.env.WIKI_API_URL;
if (process.env.POP_STATS_URL) config.popStatsUrl = process.env.POP_STATS_URL;
if (process.env.OPENROUTER_API_KEY) config.openRouterApiKey = process.env.OPENROUTER_API_KEY;
if (process.env.OPENROUTER_MODEL) config.openRouterModel = process.env.OPENROUTER_MODEL;

const backend = createPgS3Backend(storeEnv.backendOptions);
setProjectStore(
  new PgS3ProjectStore(backend, {
    projectId: process.env.GENEALOGY_PROJECT_ID as string,
    anchorPath: storeEnv.anchorPath,
  }),
);

const server = createServer(bearerPrincipal(process.env.FS_ACCESS_TOKEN ?? "", config));

/** How long a shutdown waits for the pool to drain (a writer mid-transaction)
 *  before the process exits regardless. */
const SHUTDOWN_GRACE_MS = 5_000;

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const grace = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref());
  await Promise.race([
    (async () => {
      await server.close().catch(() => {});
      await backend.close().catch(() => {});
    })(),
    grace,
  ]);
  process.exit(0);
}

process.stdin.once("end", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await server.connect(new StdioServerTransport());
