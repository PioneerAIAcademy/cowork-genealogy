// Streamable HTTP entrypoint for the search-agent prototype
// (docs/plan/search-agent-prototype.md, D16). A third entrypoint beside the
// stdio ones (index.ts, hosted-stdio.ts), never a replacement: the same
// createServer(principal) chain — only how the principal arrives differs.
import http, { type IncomingHttpHeaders, type RequestListener } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerPrincipal, type Principal } from "./auth/principal.js";
import type { AppConfig } from "./types/auth.js";
import { allToolSchemas } from "./tool-schemas.js";
import { createServer } from "./server.js";

export const MCP_PATH = "/mcp";
export const HEALTHZ_PATH = "/healthz";

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

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0",
  error: { code: -32000, message: "Method not allowed." },
  id: null,
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleMcpPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  baseConfig: AppConfig,
): Promise<void> {
  const server = createServer(principalFromHeaders(req.headers, baseConfig));
  // Stateless: the SDK refuses to reuse a transport across requests, and one
  // Server per POST is what binds the principal to exactly this request.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } finally {
    await server.close();
  }
}

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  baseConfig: AppConfig,
): Promise<void> {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === HEALTHZ_PATH && req.method === "GET") {
    sendJson(res, 200, { ok: true, tools: allToolSchemas.length });
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
  await handleMcpPost(req, res, baseConfig);
}

/** The node:http request listener: `/healthz`, `/mcp` (POST only), 404 elsewhere. */
export function createToolServer(baseConfig: AppConfig): RequestListener {
  return (req, res) => {
    route(req, res, baseConfig).catch((error: unknown) => {
      console.error("tool server request failed:", error instanceof Error ? error.message : error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, { error: "Internal server error" });
    });
  };
}

export interface StartHttpServerOptions {
  host: string;
  port: number;
  baseConfig: AppConfig;
}

/** Resolves once listening; `port: 0` binds a free port (read it from `address()`). */
export function startHttpServer(options: StartHttpServerOptions): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createToolServer(options.baseConfig));
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
