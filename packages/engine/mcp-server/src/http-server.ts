// Streamable HTTP entrypoint for the search-agent prototype
// (docs/plan/search-agent-prototype.md, D16). A second entrypoint beside the
// stdio one (index.ts), never a replacement: the same
// createServer(principal) chain — only how the principal and the project
// arrive differs. Both are per request, never process state: the
// `Authorization: Bearer` header names the principal, the
// `X-Genealogy-Project-Id` header names the project whose store the request
// runs against. Which backend that store is comes from the caller's
// `bindStore` factory — this module imports no backend, so the unit test
// supplies a double and never loads `pg`/`@aws-sdk`. Readiness is injected the
// same way: `/healthz` maps the caller's `checkReady` report to 200 or 503.
import http, { type IncomingHttpHeaders, type RequestListener } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerPrincipal, type Principal } from "./auth/principal.js";
import type { AppConfig } from "./types/auth.js";
import { allToolSchemas } from "./tool-schemas.js";
import { createServer } from "./server.js";
import { PROJECT_ID_RE } from "./store/project-id.js";
import { runWithProjectStore, unboundProjectStore, type ProjectStore } from "./store/project-store.js";

export const MCP_PATH = "/mcp";
export const HEALTHZ_PATH = "/healthz";

/** How long `/healthz` waits on `checkReady` before answering 503 itself: the
 *  backend's own 1.5 s probe deadline (READY_TIMEOUT_MS) plus 500 ms, so a
 *  probe that never settles cannot hold the answer. */
export const HEALTHZ_TIMEOUT_MS = 2_000;

/** What a readiness probe reports. The Pg/S3 backend's report satisfies it
 *  structurally; `error` is a short label, never a message. */
export interface ReadyReport {
  ok: boolean;
  checks: Record<string, { ok: boolean; error?: string }>;
}

/** The per-request project header as node:http lower-cases it; on the wire it
 *  is spelled `X-Genealogy-Project-Id`. */
export const PROJECT_ID_HEADER = "x-genealogy-project-id";

/**
 * The principal a request acts as: the `Authorization: Bearer <token>` header,
 * or a bearer with an EMPTY token when the header is missing or malformed —
 * FamilySearch tools then answer HOSTED_REAUTH_INSTRUCTION via getValidToken.
 * Never LOCAL: that fallback would let an unauthenticated request act as
 * whichever user the host's ~/.familysearch-mcp belongs to.
 */
export function principalFromHeaders(
  headers: IncomingHttpHeaders,
  baseConfig: AppConfig,
): Principal {
  const raw = headers.authorization;
  const match = typeof raw === "string" ? /^bearer\s+(.+)$/i.exec(raw.trim()) : null;
  const token = match ? match[1].trim() : "";
  return bearerPrincipal(token, baseConfig);
}

export type ProjectIdFromHeaders =
  | { kind: "present"; id: string }
  | { kind: "missing" }
  | { kind: "malformed"; raw: string };

/**
 * The project a request names: exactly one `X-Genealogy-Project-Id` value,
 * trimmed, matching PROJECT_ID_RE. Absent is `missing` (the request may still
 * run store-less tools); anything else — an empty value, one that fails the
 * pattern, or two values (node:http joins duplicates with `, `, which fails
 * the pattern too) — is `malformed`, a client bug answered before any tool.
 */
export function projectIdFromHeaders(headers: IncomingHttpHeaders): ProjectIdFromHeaders {
  const raw = headers[PROJECT_ID_HEADER];
  if (raw === undefined) return { kind: "missing" };
  if (Array.isArray(raw)) return { kind: "malformed", raw: raw.join(", ") };
  const id = raw.trim();
  return PROJECT_ID_RE.test(id) ? { kind: "present", id } : { kind: "malformed", raw };
}

/** What a request that names no project is told when it reaches the store. The
 *  dispatcher turns the thrown Error into an `isError` result, so this reaches
 *  the model as an instruction. */
const NO_PROJECT_BOUND_MESSAGE =
  "This request carries no X-Genealogy-Project-Id header, so no project is bound: " +
  "project tools (project_create, research_append, research_query, tree_edit, …) cannot " +
  "run. Tools that take no projectPath (convert_calendar, place_search, record_read, …) " +
  "still work. Send the header to use project tools.";

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0",
  error: { code: -32000, message: "Method not allowed." },
  id: null,
};

const INVALID_PROJECT_ID = {
  jsonrpc: "2.0",
  error: { code: -32600, message: "Invalid X-Genealogy-Project-Id header." },
  id: null,
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export interface ToolServerOptions {
  /** The process-wide config (~/.familysearch-mcp/config.json or the hosted
   *  equivalent) every request's bearer principal is built over. */
  baseConfig: AppConfig;
  /** The store for one project id, built per request. `signal` aborts when
   *  that request's client disconnects before its response is written; a store
   *  that writes transactionally rolls back rather than commit after it. */
  bindStore: (projectId: string, signal: AbortSignal) => ProjectStore;
  /** Whether the stores behind `bindStore` can serve a call. Absent, `/healthz`
   *  answers 200 without `checks`. */
  checkReady?: () => Promise<ReadyReport>;
}

/** `/healthz`: 200 or 503 from the report, the same body shape either way. A
 *  probe that rejects or outlives HEALTHZ_TIMEOUT_MS is a 503 with no `checks`,
 *  never a 500. */
async function handleHealthz(res: http.ServerResponse, options: ToolServerOptions): Promise<void> {
  const tools = allToolSchemas.length;
  if (!options.checkReady) {
    sendJson(res, 200, { ok: true, tools });
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), HEALTHZ_TIMEOUT_MS);
  });
  let report: ReadyReport | undefined;
  try {
    report = await Promise.race([options.checkReady(), expired]);
  } catch {
    report = undefined;
  } finally {
    clearTimeout(timer);
  }
  if (!report) {
    sendJson(res, 503, { ok: false, tools });
    return;
  }
  sendJson(res, report.ok ? 200 : 503, { ok: report.ok, tools, checks: report.checks });
}

async function handleMcpPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ToolServerOptions,
): Promise<void> {
  // The store is decided before any transport exists: a malformed id never
  // reaches a tool, and a missing one binds a store whose every call answers
  // with the instruction rather than falling through to the process store.
  const projectId = projectIdFromHeaders(req.headers);
  if (projectId.kind === "malformed") {
    sendJson(res, 400, INVALID_PROJECT_ID);
    return;
  }
  // A killed worker closes its socket but sends nothing; without this its
  // in-flight write would commit after the caller that could read the result
  // is gone, and the resumed turn would write the same thing again.
  const disconnected = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) disconnected.abort();
  });
  const store =
    projectId.kind === "present"
      ? options.bindStore(projectId.id, disconnected.signal)
      : unboundProjectStore(NO_PROJECT_BOUND_MESSAGE);

  const server = createServer(principalFromHeaders(req.headers, options.baseConfig));
  // Stateless: the SDK refuses to reuse a transport across requests, and one
  // Server per POST is what binds the principal to exactly this request.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    // Every store call in the handler's async continuation — the SDK's
    // onmessage → Promise.then(handler) chain included — resolves to `store`.
    await runWithProjectStore(store, async () => {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
  } finally {
    await server.close();
  }
}

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ToolServerOptions,
): Promise<void> {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === HEALTHZ_PATH && req.method === "GET") {
    await handleHealthz(res, options);
    return;
  }
  if (pathname !== MCP_PATH) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  if (req.method !== "POST") {
    // Answered here, before any transport exists: in stateless mode the SDK
    // would hold a GET + text/event-stream open as an SSE stream pinned to a
    // per-request Server, and answer DELETE with 200.
    res.writeHead(405, { Allow: "POST", "Content-Type": "application/json" });
    res.end(JSON.stringify(METHOD_NOT_ALLOWED));
    return;
  }
  await handleMcpPost(req, res, options);
}

/** The node:http request listener: `/healthz`, `/mcp` (POST only), 404 elsewhere. */
export function createToolServer(options: ToolServerOptions): RequestListener {
  return (req, res) => {
    route(req, res, options).catch((error: unknown) => {
      console.error("tool server request failed:", error instanceof Error ? error.message : error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, { error: "Internal server error" });
    });
  };
}

export interface StartHttpServerOptions extends ToolServerOptions {
  host: string;
  port: number;
}

/** Resolves once listening; `port: 0` binds a free port (read it from `address()`). */
export function startHttpServer(options: StartHttpServerOptions): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(
      createToolServer({
        baseConfig: options.baseConfig,
        bindStore: options.bindStore,
        checkReady: options.checkReady,
      }),
    );
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
