/// <reference types="node" />
// The connector probe (issue #3529; docs/plan/self-hosted-mcp-beta.md, P0.2): a
// stand-in for the beta's remote MCP connector, added to Cowork through a
// public HTTPS tunnel so the facts the beta builds on can be measured in a live
// task before the real server exists. P0.3 deploys this same file as its
// "probe bundle", so it keeps the tools tier's shape: `PORT` (default 8080),
// `GET /livez`, and `/mcp` served without sessions as plain JSON, as
// `src/http-server.ts` does. It is not deployable as-is: the tools bundle
// compiles only `src/`, and `tsx` is a dev tool. P0.3 compiles it with its own
// tsconfig (as `tsconfig.smoke.json` does for the smoke script), runs the
// emitted `.js`, and sets `PROBE_PUBLIC_URL` as an environment property.
//
// It holds no credentials and no store. Every advertised tool keeps its real
// name and schema (copied from `allToolSchemas`, never hand-written, because
// the tool-delivery and size measurements depend on the real sizes) and returns
// fixed text. Two probe-only tools are added: `probe_sleep` (the per-call
// timeout) and `probe_large_result` (the result-size limit).
//
// Sign-in is the probe's own OAuth server, written on `node:http` rather than
// the SDK's express router: the router's metadata cannot carry the
// client-metadata field, and the beta's sign-in server is Python, so the probe
// copies the SDK's checks (PKCE S256, `redirectUriMatches`, which lets a
// loopback redirect's port vary per RFC 8252) rather than its framework. Here
// there is no `/register`, the metadata sets
// `client_id_metadata_document_supported`, `/authorize` fetches the `client_id`
// document only from claude.ai, and `/token` issues no refresh token.
//
// Every request is logged to stdout as one JSON line (`ev=…`). Values of
// `code`, `state`, `code_verifier`, `code_challenge` and every token are
// redacted before logging; parameter names are kept, since they are the
// measurement. Never paste a token into the issue.
//
// Run:
//   PROBE_PUBLIC_URL=https://<tunnel-host> npx tsx dev/probe-connector-server.ts \
//     [--token-ttl <seconds>] [--deny-flag <path>]
// --token-ttl   access-token lifetime, default 600 (10 minutes).
// --deny-flag   while this file exists every /mcp call answers 401; default
//               ./probe-deny-401.flag. `touch` it to start, `rm` it to stop.
// Tokens live in memory: a restart makes every token "unknown token", which
// Claude cannot tell from expiry. Do not restart during the expiry test.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { redirectUriMatches } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { allToolSchemas } from "../src/tool-schemas.js";
import { fetchWithRetry } from "../src/utils/http.js";

const PORT = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(PORT) || PORT <= 0) throw new Error(`PORT must be a port number, got "${process.env.PORT}"`);
const PUBLIC_URL = (process.env.PROBE_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");
const MCP_URL = `${PUBLIC_URL}/mcp`;
const PRM_PATH = "/.well-known/oauth-protected-resource";
const SCOPE = "genealogy";
const CLIENT_DOC_HOST = "claude.ai";
const CLIENT_DOC_TIMEOUT_MS = 5_000;
const PENDING_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 2 * 60_000;
const MAX_SLEEP_S = 600;
const MAX_RESULT_CHARS = 1_000_000;
const MAX_FORM_BYTES = 64 * 1024;
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const SECRET_KEYS = new Set([
  "code", "state", "code_verifier", "code_challenge",
  "access_token", "refresh_token", "client_secret", "token",
]);

function flag(name: string, fallback: string): string {
  const inline = process.argv.find((a) => a.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}
const TOKEN_TTL_S = Number(flag("--token-ttl", "600"));
if (!Number.isInteger(TOKEN_TTL_S) || TOKEN_TTL_S <= 0) {
  throw new Error(`--token-ttl must be a whole number of seconds, got "${flag("--token-ttl", "")}"`);
}
const DENY_FLAG = flag("--deny-flag", "probe-deny-401.flag");

function log(ev: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), ev, ...fields }));
}

/** Parameter names kept, secret values replaced by their length. */
function redact(params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = SECRET_KEYS.has(k) ? `<redacted len=${v.length}>` : v;
  }
  return out;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function oauthError(res: http.ServerResponse, status: number, error: string, description: string): void {
  log("oauth_error", { status, error, description });
  sendJson(res, status, { error, error_description: description });
}

class BodyTooLarge extends Error {}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_FORM_BYTES) throw new BodyTooLarge(`body over ${MAX_FORM_BYTES} bytes`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function badBody(res: http.ServerResponse, error: unknown): void {
  if (error instanceof BodyTooLarge) return oauthError(res, 413, "invalid_request", error.message);
  oauthError(res, 400, "invalid_request", "body is not form-encoded or JSON");
}

function formParams(raw: string, contentType: string | undefined): Record<string, string> {
  if (contentType?.includes("application/json")) {
    const parsed: unknown = JSON.parse(raw || "{}");
    const out: Record<string, string> = {};
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) out[k] = String(v);
    }
    return out;
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

// `src/auth/login.ts` has the same helper, private to the auth module; a dev
// probe does not widen that module's surface for it.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}


const protectedResourceMetadata = {
  resource: MCP_URL,
  authorization_servers: [PUBLIC_URL],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ["header"],
  resource_name: "Genealogy connector probe",
};

const authorizationServerMetadata = {
  issuer: PUBLIC_URL,
  authorization_endpoint: `${PUBLIC_URL}/authorize`,
  token_endpoint: `${PUBLIC_URL}/token`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: [SCOPE],
  client_id_metadata_document_supported: true,
};

/** RFC 6750 §3.1: a request that carried no token gets the bare challenge; only
 *  a token that was refused gets `error="invalid_token"`. */
function challenge(tokenRefused: boolean): Record<string, string> {
  const error = tokenRefused ? `error="invalid_token", ` : "";
  return { "WWW-Authenticate": `Bearer ${error}resource_metadata="${PUBLIC_URL}${PRM_PATH}/mcp", scope="${SCOPE}"` };
}

// ---- clients: claude.ai client metadata documents only ----

interface ClientDocument {
  client_id: string;
  redirect_uris: string[];
  [key: string]: unknown;
}

async function fetchClientDocument(clientId: string): Promise<ClientDocument | string> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return "client_id is not a URL, and this server has no registered clients";
  }
  if (url.protocol !== "https:" || url.hostname !== CLIENT_DOC_HOST) {
    return `client_id document host "${url.hostname}" is not ${CLIENT_DOC_HOST}`;
  }
  log("client_doc_fetch", { url: clientId });
  try {
    // No redirects: a document served from another host is not claude.ai's.
    const response = await fetchWithRetry(
      url,
      { headers: { Accept: "application/json" }, redirect: "manual" },
      CLIENT_DOC_TIMEOUT_MS,
    );
    if (response.status >= 300 && response.status < 400) {
      return `client_id document redirected (HTTP ${response.status}) to ${response.headers.get("location") ?? "?"}`;
    }
    if (!response.ok) return `client_id document answered HTTP ${response.status}`;
    const doc = (await response.json()) as Partial<ClientDocument>;
    // The document is public; logging it whole is the allowlist's evidence.
    log("client_doc", { url: clientId, doc });
    if (doc.client_id !== clientId) return "client_id document's client_id does not match its URL";
    if (!Array.isArray(doc.redirect_uris)) return "client_id document has no redirect_uris";
    return doc as ClientDocument;
  } catch (err) {
    return `client_id document fetch failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---- authorization codes and tokens, in memory ----

interface Grant {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | undefined;
  resource: string | undefined;
  expiresAt: number;
}
const pending = new Map<string, Grant>();
const codes = new Map<string, Grant>();
const tokens = new Map<string, { clientId: string; expiresAt: number }>();

/** Drop expired sign-ins, codes and tokens, so a long-running deployment's maps
 *  do not grow without bound. */
function sweep(): void {
  const now = Date.now();
  for (const map of [pending, codes, tokens] as Map<string, { expiresAt: number }>[]) {
    for (const [key, entry] of map) if (entry.expiresAt < now) map.delete(key);
  }
}

/** RFC 6749 §4.1.2.1: once redirect_uri is trusted, an error goes back to the
 *  client, so its callback sees the refusal instead of a stalled browser. */
function redirectError(res: http.ServerResponse, redirectUri: string, state: string | undefined, error: string, description: string): void {
  log("oauth_error", { status: 302, error, description });
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  target.searchParams.set("error_description", description);
  if (state !== undefined) target.searchParams.set("state", state);
  res.writeHead(302, { Location: target.toString(), "Cache-Control": "no-store" });
  res.end();
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

async function handleAuthorize(req: http.IncomingMessage, res: http.ServerResponse, query: URLSearchParams): Promise<void> {
  const params = Object.fromEntries(query);
  log("authorize", { params: redact(params), user_agent: req.headers["user-agent"] });
  sweep();
  const clientId = params.client_id;
  if (!clientId) return oauthError(res, 400, "invalid_request", "client_id is required");
  const client = await fetchClientDocument(clientId);
  if (typeof client === "string") return oauthError(res, 400, "invalid_client", client);
  const redirectUri = params.redirect_uri;
  if (!redirectUri || !client.redirect_uris.some((registered) => redirectUriMatches(redirectUri, registered))) {
    return oauthError(res, 400, "invalid_request", "redirect_uri is missing or not in the client document");
  }
  if (params.response_type !== "code") {
    return redirectError(res, redirectUri, params.state, "unsupported_response_type", "response_type must be code");
  }
  if (params.code_challenge_method !== "S256" || !params.code_challenge) {
    return redirectError(res, redirectUri, params.state, "invalid_request", "PKCE S256 code_challenge is required");
  }
  if (params.resource !== undefined && params.resource !== MCP_URL) {
    return redirectError(res, redirectUri, params.state, "invalid_target", `resource must be ${MCP_URL}`);
  }
  const id = newSecret();
  pending.set(id, {
    clientId,
    redirectUri,
    codeChallenge: params.code_challenge,
    state: params.state,
    resource: params.resource,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
  const clientName = typeof client.client_name === "string" ? client.client_name : clientId;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><meta charset="utf-8"><title>Connector probe sign-in</title>
<h1>Connector probe</h1>
<p><b>${escapeHtml(clientName)}</b> asks to use the probe's stub tools.</p>
<p>Redirects to <code>${escapeHtml(new URL(redirectUri).origin)}</code>. This server holds no data.</p>
<form method="post" action="/authorize/approve"><input type="hidden" name="id" value="${id}">
<button type="submit">Approve</button></form>`);
}

async function handleApprove(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let params: Record<string, string>;
  try {
    params = formParams(await readBody(req), req.headers["content-type"]);
  } catch (error) {
    return badBody(res, error);
  }
  const grant = params.id ? pending.get(params.id) : undefined;
  if (params.id) pending.delete(params.id);
  if (!grant || grant.expiresAt < Date.now()) {
    return oauthError(res, 400, "invalid_request", "sign-in request expired or unknown; start again from Claude");
  }
  const code = newSecret();
  codes.set(code, { ...grant, expiresAt: Date.now() + CODE_TTL_MS });
  const target = new URL(grant.redirectUri);
  target.searchParams.set("code", code);
  if (grant.state !== undefined) target.searchParams.set("state", grant.state);
  log("approve", { client_id: grant.clientId, redirect_origin: target.origin });
  res.writeHead(302, { Location: target.toString(), "Cache-Control": "no-store" });
  res.end();
}

async function handleToken(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let params: Record<string, string>;
  try {
    params = formParams(await readBody(req), req.headers["content-type"]);
  } catch (error) {
    return badBody(res, error);
  }
  log("token", {
    params: redact(params),
    content_type: req.headers["content-type"],
    has_authorization_header: req.headers.authorization !== undefined,
    user_agent: req.headers["user-agent"],
  });
  sweep();
  if (params.grant_type !== "authorization_code") {
    return oauthError(res, 400, "unsupported_grant_type", `grant_type "${params.grant_type}" is not supported`);
  }
  const grant = params.code ? codes.get(params.code) : undefined;
  if (params.code) codes.delete(params.code);
  if (!grant || grant.expiresAt < Date.now()) return oauthError(res, 400, "invalid_grant", "code expired or unknown");
  if (params.client_id !== grant.clientId) return oauthError(res, 400, "invalid_grant", "client_id does not match the code");
  if (params.redirect_uri !== undefined && params.redirect_uri !== grant.redirectUri) {
    return oauthError(res, 400, "invalid_grant", "redirect_uri does not match the code");
  }
  if (params.resource !== undefined && params.resource !== MCP_URL) {
    return oauthError(res, 400, "invalid_target", `resource must be ${MCP_URL}`);
  }
  const verifier = params.code_verifier ?? "";
  if (!VERIFIER_RE.test(verifier)) {
    return oauthError(res, 400, "invalid_grant", "code_verifier must be 43-128 unreserved characters (RFC 7636)");
  }
  if (createHash("sha256").update(verifier).digest("base64url") !== grant.codeChallenge) {
    return oauthError(res, 400, "invalid_grant", "code_verifier does not match the code_challenge");
  }
  const accessToken = newSecret();
  tokens.set(accessToken, { clientId: grant.clientId, expiresAt: Date.now() + TOKEN_TTL_S * 1000 });
  log("token_issued", { client_id: grant.clientId, expires_in: TOKEN_TTL_S, resource: grant.resource });
  sendJson(res, 200, { access_token: accessToken, token_type: "Bearer", expires_in: TOKEN_TTL_S });
}

// ---- /mcp: the stub tools ----

const probeTools = [
  {
    name: "probe_sleep",
    description: "Connector probe only. Waits the given number of seconds, then returns how long it waited. Measures the per-call timeout.",
    inputSchema: {
      type: "object" as const,
      properties: { seconds: { type: "integer", minimum: 1, maximum: MAX_SLEEP_S } },
      required: ["seconds"],
    },
  },
  {
    name: "probe_large_result",
    description: "Connector probe only. Returns a text result of exactly the given number of characters, marked every 10,000 characters. Measures the result-size limit.",
    inputSchema: {
      type: "object" as const,
      properties: { chars: { type: "integer", minimum: 1, maximum: MAX_RESULT_CHARS } },
      required: ["chars"],
    },
  },
];

/** `chars` characters, with "[char N]" written so it ends at each multiple of
 *  10,000: the last marker in what arrives says where it was cut. */
function largeResult(chars: number): string {
  let out = "";
  for (let mark = 10_000; out.length < chars; mark += 10_000) {
    const label = `[char ${mark}]`;
    out += "x".repeat(Math.max(0, mark - out.length - label.length)) + label;
  }
  return out.slice(0, chars);
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function stubServer(signal: AbortSignal): Server {
  const server = new Server({ name: "genealogy-connector-probe", version: "0.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log("list_tools", { count: allToolSchemas.length + probeTools.length });
    return { tools: [...allToolSchemas, ...probeTools] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    log("call_tool", { name, arg_names: Object.keys(args), section: args.section });
    if (name === "probe_sleep") {
      const seconds = Math.min(Math.max(Number(args.seconds) || 0, 1), MAX_SLEEP_S);
      const started = Date.now();
      const finished = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(true), seconds * 1000);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(false); }, { once: true });
      });
      const elapsed = Math.round((Date.now() - started) / 1000);
      log(finished ? "sleep_done" : "sleep_aborted", { requested_s: seconds, elapsed_s: elapsed });
      return text(`probe_sleep waited ${elapsed} s of the ${seconds} s requested.`);
    }
    if (name === "probe_large_result") {
      const chars = Math.min(Math.max(Number(args.chars) || 0, 1), MAX_RESULT_CHARS);
      log("large_result", { chars });
      return text(largeResult(chars));
    }
    if (!allToolSchemas.some((s) => s.name === name)) {
      return { ...text(`Unknown tool: ${name}`), isError: true };
    }
    return text(`Connector probe stub: ${name} was called and did nothing. This server holds no data.`);
  });
  return server;
}

function bearerValid(req: http.IncomingMessage): { ok: true; clientId: string } | { ok: false; why: string } {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return { ok: false, why: "no bearer" };
  const entry = tokens.get(header.slice("Bearer ".length));
  if (!entry) return { ok: false, why: "unknown token" };
  if (entry.expiresAt < Date.now()) return { ok: false, why: "expired token" };
  return { ok: true, clientId: entry.clientId };
}

async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (existsSync(DENY_FLAG)) {
    log("mcp_401", { why: "deny flag present", flag: DENY_FLAG });
    return sendJson(res, 401, { error: "invalid_token" }, challenge(true));
  }
  const auth = bearerValid(req);
  if (!auth.ok) {
    log("mcp_401", { why: auth.why });
    const tokenRefused = auth.why !== "no bearer";
    return sendJson(res, 401, tokenRefused ? { error: "invalid_token" } : { error: "unauthorized" }, challenge(tokenRefused));
  }
  const disconnected = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) disconnected.abort();
  });
  const server = stubServer(disconnected.signal);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } finally {
    await server.close();
  }
}

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  log("request", { method: req.method, path, user_agent: req.headers["user-agent"] });
  if (path === "/livez" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (path === PRM_PATH || path === `${PRM_PATH}/mcp`) return sendJson(res, 200, protectedResourceMetadata);
  if (path === "/.well-known/oauth-authorization-server") return sendJson(res, 200, authorizationServerMetadata);
  if (path === "/authorize" && req.method === "GET") return handleAuthorize(req, res, url.searchParams);
  if (path === "/authorize/approve" && req.method === "POST") return handleApprove(req, res);
  if (path === "/token" && req.method === "POST") return handleToken(req, res);
  if (path === "/mcp") return handleMcp(req, res);
  log("not_found", { method: req.method, path });
  sendJson(res, 404, { error: "Not found" });
}

http
  .createServer((req, res) => {
    route(req, res).catch((err) => {
      log("server_error", { message: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) sendJson(res, 500, { error: "server_error" });
      else res.end();
    });
  })
  .listen(PORT, () => {
    log("listening", {
      port: PORT,
      public_url: PUBLIC_URL,
      token_ttl_s: TOKEN_TTL_S,
      deny_flag: DENY_FLAG,
      tools: allToolSchemas.length + probeTools.length,
    });
  });
