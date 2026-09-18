/**
 * smoke-stdio — drive a BUILT stdio entrypoint over the real transport and call
 * the tools that need no network, so the dispatch chain in src/server.ts —
 * which no vitest file imports — is exercised end to end: the principal
 * binding, the ProjectStore-backed writers, the sidecar read, and the two tools
 * the e2e corpus never calls (`project_create`, `tree_forget`).
 *
 *   npm run build && npx tsx dev/smoke-stdio.ts            # build/index.js, file backend
 *   make engine-smoke-stdio-pg                             # build/hosted-stdio.js, Postgres + minio
 *
 *   SMOKE_ENTRY         the entrypoint to fork (default build/index.js)
 *   SMOKE_PROJECT_PATH  the projectPath every call passes (default: a fresh temp
 *                       dir, removed afterwards; the hosted entrypoint wants its
 *                       anchor, /project, which is not a directory here at all)
 *   GENEALOGY_*, FS_ACCESS_TOKEN, WIKI_API_URL, POP_STATS_URL, OPENROUTER_*
 *                       passed through to the child (the SDK's transport forwards
 *                       only a fixed safe list of variables by default)
 *
 * Exit 0 with one line per call on success; exit 1 naming the first failure.
 * No FamilySearch credentials are needed — `auth_status` merely reports.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = process.env.SMOKE_ENTRY ?? "build/index.js";
const requestedPath = process.env.SMOKE_PROJECT_PATH;
const projectPath = requestedPath ?? (await mkdtemp(join(tmpdir(), "smoke-stdio-")));
const ownsProjectDir = requestedPath === undefined;

const PASS_THROUGH = /^(GENEALOGY_|OPENROUTER_|FS_ACCESS_TOKEN$|WIKI_API_URL$|POP_STATS_URL$)/;
const childEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (PASS_THROUGH.test(key) && value !== undefined) childEnv[key] = value;
}

console.log(`entry ${entry}; projectPath ${projectPath}`);
const client = new Client({ name: "smoke-stdio", version: "0" });
const transport = new StdioClientTransport({
  command: "node",
  args: [entry],
  env: childEnv,
  stderr: "inherit",
});

let failures = 0;
function report(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failures++;
}

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { isError: res.isError === true, body: parsed };
}

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  report("tools/list", tools.length >= 49, `${tools.length} tools advertised`);

  const status = await call("auth_status", {});
  report("auth_status", !status.isError && typeof status.body.loggedIn === "boolean", JSON.stringify(status.body));
  // #2126 — the build stamp is on the wire and on the tool return, and agrees.
  const wireVersion = client.getServerVersion()?.version;
  report(
    "build stamp",
    typeof wireVersion === "string" && /^\d+\.\d+\.\d+\+/.test(wireVersion) && status.body.buildId === wireVersion,
    `serverInfo.version=${wireVersion} auth_status.buildId=${status.body.buildId}`
  );

  const tree = {
    persons: [
      {
        id: "P1",
        gender: "Male",
        names: [{ id: "N1", preferred: true, given: "Smoke", surname: "Person", type: "BirthName" }],
        facts: [{ id: "F1", type: "Birth", primary: true, date: "1850", place: "Nowhere" }],
      },
    ],
    relationships: [],
    sources: [],
  };
  const created = await call("project_create", {
    projectPath,
    objective: "Does the stdio transport reach every offline tool?",
    title: "smoke",
    subjectPersonIds: ["P1"],
    tree,
  });
  report(
    "project_create",
    !created.isError && created.body.ok === true,
    created.body.ok === true ? `wrote ${created.body.filesWritten.join(", ")}` : JSON.stringify(created.body).slice(0, 300),
  );

  const valid = await call("validate_research_schema", { projectPath });
  report("validate_research_schema", !valid.isError && valid.body.valid === true, JSON.stringify(valid.body).slice(0, 200));

  const ctx = await call("project_context", { projectPath });
  report("project_context", !ctx.isError, JSON.stringify(ctx.body).slice(0, 120));

  const q = await call("research_query", { projectPath, section: "log" });
  report("research_query", !q.isError, JSON.stringify(q.body).slice(0, 120));

  const logged = await call("research_log_append", {
    projectPath,
    tool: "record_search",
    query: { givenName: "Smoke" },
    outcome: "negative",
    resultsExamined: 0,
    resultsAvailable: 0,
  });
  report("research_log_append", !logged.isError && logged.body.ok === true, JSON.stringify(logged.body).slice(0, 200));

  const dry = await call("tree_forget", {
    projectPath,
    forget: [{ selector: "fact", personId: "P1", factId: "F1" }],
    dryRun: true,
  });
  report("tree_forget (dry run)", !dry.isError && dry.body.ok === true, JSON.stringify(dry.body).slice(0, 200));

  // A verdict through research_append's composite path writes the pointer entry
  // AND its `evaluations/<…>.json` body; sidecar_read is the one tool that
  // reads that body back.
  const appended = await call("research_append", {
    projectPath,
    section: "evaluations",
    op: "append",
    entry: {
      focus: "conclusion-readiness",
      target_id: "project",
      target_type: "project",
      verdict: "consider_addressing",
      superseded_by: null,
    },
    verdict: { strengths: ["smoke"], must_address: [] },
  });
  report(
    "research_append (evaluations + verdict)",
    !appended.isError && appended.body.ok === true,
    JSON.stringify(appended.body).slice(0, 200),
  );

  const evaluations = await call("research_query", { projectPath, section: "evaluations" });
  const verdictRef: unknown = evaluations.body?.items?.[0]?.file_path;
  const sidecar =
    typeof verdictRef === "string"
      ? await call("sidecar_read", { projectPath, ref: verdictRef })
      : { isError: true, body: { error: `no evaluations[0].file_path: ${JSON.stringify(evaluations.body).slice(0, 160)}` } };
  let verdictBody: any = null;
  try {
    verdictBody = typeof sidecar.body.content === "string" ? JSON.parse(sidecar.body.content) : null;
  } catch {
    verdictBody = null;
  }
  report(
    "sidecar_read",
    !sidecar.isError && sidecar.body.ok === true && verdictBody?.strengths?.[0] === "smoke",
    typeof verdictRef === "string" ? `${verdictRef}: ${JSON.stringify(sidecar.body).slice(0, 160)}` : JSON.stringify(sidecar.body).slice(0, 200),
  );

  const revalid = await call("validate_research_schema", { projectPath });
  report("validate_research_schema (after writes)", !revalid.isError && revalid.body.valid === true, JSON.stringify(revalid.body).slice(0, 200));

  const noProject = await call("project_context", { projectPath: join(projectPath, "nope") });
  report("project_context on a missing dir", noProject.isError || noProject.body.ok === false, JSON.stringify(noProject.body).slice(0, 160));
} catch (error) {
  report("transport", false, error instanceof Error ? error.message : String(error));
} finally {
  await client.close().catch(() => {});
  if (ownsProjectDir) await rm(projectPath, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} call(s) failed`);
  process.exit(1);
}
