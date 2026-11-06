// The request listener. The MCP route lives under the secret, the page too with
// --local, and /img/<token> outside it; every other path is the same 404. No
// response in any mode carries a CORS header.
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getProjectStore } from "../src/store/project-store.js";
import { imageTokens } from "../src/utils/image-tokens.js";
import { createMcpServer } from "./mcp.js";
import { reopenProject } from "./project.js";
import { describeRpc, headerFields, logLine, observeSends, type LogFields } from "./request-log.js";

export const MAX_BODY_BYTES = 1024 * 1024;

export const PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

export interface ViewerOptions {
  pageHtml: string;
  rootReal: string;
  secret: string;
  /** Origin of every image link and of the page's CSP entry. Never the Host header. */
  publicUrl: string;
  /** Serves the page at /<secret>/. */
  local: boolean;
  /** Gets one JSON line per request. */
  log: (line: string) => void;
  now: () => number;
}

function rpcError(code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null });
}

function sendJson(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body);
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

/** The whole body, or null past the cap. A long body is drained, not cut off:
 *  destroying the request would drop the socket before the 413 could be sent. */
function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createViewer(options: ViewerOptions): RequestListener {
  const { pageHtml, rootReal, publicUrl, now } = options;
  const tokens = imageTokens(randomBytes(32), now);
  const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();
  const secretDigest = digest(options.secret);
  const isSecret = (segment: string | undefined): boolean =>
    segment !== undefined && timingSafeEqual(digest(segment), secretDigest);

  const mcpServer = (): Server =>
    createMcpServer({
      pageHtml,
      rootReal,
      publicUrl,
      signImage: (project, ref) => {
        const { token, expiresAt } = tokens.sign(project.rel, ref);
        return { url: `${publicUrl}/img/${token}`, expiresAt };
      },
    });

  async function serveMcp(req: IncomingMessage, res: ServerResponse, entry: LogFields): Promise<void> {
    entry.route = "mcp";
    if (req.method !== "POST") {
      // Stateless: a GET would otherwise hold an SSE stream open on a one-request Server.
      sendJson(res, 405, rpcError(-32000, "Method not allowed."), { Allow: "POST" });
      return;
    }
    const raw = await readBody(req);
    if (raw === null) {
      sendJson(res, 413, rpcError(-32600, "Request body too large."));
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      sendJson(res, 400, rpcError(-32700, "Parse error."));
      return;
    }
    if (Array.isArray(body)) {
      // MCP dropped batching in 2025-06-18, and many large calls in one POST exhaust the heap.
      sendJson(res, 400, rpcError(-32600, "Batches are not supported."));
      return;
    }
    Object.assign(entry, describeRpc(body), headerFields(req.headers), { resultBytes: 0 });
    const server = mcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    observeSends(transport, (_message, bytes) => {
      entry.resultBytes = (entry.resultBytes as number) + bytes;
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } finally {
      await server.close();
    }
  }

  function servePage(res: ServerResponse, entry: LogFields): void {
    entry.route = "page";
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      // The URL holds the secret.
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    res.end(pageHtml);
  }

  async function serveImage(req: IncomingMessage, res: ServerResponse, token: string, entry: LogFields): Promise<void> {
    if (req.method !== "GET") return notFound(res);
    const claim = tokens.verify(token);
    if (!claim) return notFound(res);
    const project = await reopenProject(rootReal, claim.project);
    if (!project) return notFound(res);
    let bytes: Uint8Array;
    try {
      bytes = await getProjectStore().readBytes(project.real, claim.ref);
    } catch {
      return notFound(res);
    }
    Object.assign(entry, { route: "img", resultBytes: bytes.length });
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      // The card's frame is another origin.
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cache-Control": `private, max-age=${Math.floor((claim.expiresAt - now()) / 1000)}`,
    });
    res.end(bytes);
  }

  async function route(req: IncomingMessage, res: ServerResponse, entry: LogFields): Promise<void> {
    const path = (req.url ?? "").split("?", 1)[0];
    if (path.startsWith("/img/")) return serveImage(req, res, path.slice("/img/".length), entry);
    const [before, segment, leaf, ...deeper] = path.split("/");
    if (before !== "" || !isSecret(segment) || deeper.length > 0) return notFound(res);
    if (leaf === "mcp") return serveMcp(req, res, entry);
    if (leaf === "" && options.local && req.method === "GET") return servePage(res, entry);
    notFound(res);
  }

  return (req, res) => {
    // Filled in by the route; a 404 adds nothing, so it logs only that it was one.
    const entry: LogFields = {};
    res.once("close", () => {
      options.log(logLine({ t: new Date(now()).toISOString(), status: res.statusCode, ...entry }));
    });
    route(req, res, entry).catch((error: unknown) => {
      entry.error = error instanceof Error ? error.name : "Error";
      if (res.headersSent) res.destroy();
      else sendJson(res, 500, rpcError(-32603, "Internal error."));
    });
  };
}
