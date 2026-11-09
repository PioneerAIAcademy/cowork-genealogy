// Streamable HTTP entrypoint for the search-agent prototype
// (docs/plan/search-agent-prototype.md, D16). A second entrypoint beside the
// stdio one (index.ts), never a replacement: the same
// createServer(principal) chain — only how the principal and the project
// arrive differs. Both are per request, never process state: the
// `Authorization: Bearer` header names the principal, the
// `X-Genealogy-Project-Id` header names the project whose store the request
// runs against, and the `X-Genealogy-Turn-Id` / `X-Genealogy-Claim-Epoch` pair
// names the worker attempt (U6) whose claim that store fences its commits on.
// ONE front door, two paths (self-hosted beta E1).
//
// WORKER path — the request carries `X-Genealogy-Project-Id`. It must pass the
// caller's `authorize` (U4) before any store or transport exists: the bearer
// has to be the grant of an open attempt on that project, so the fence is
// required there (the turn id is the check's key). A refusal is a 403 with one
// message whatever the reason, and one `ev=tool_refused` stderr line that never
// carries the bearer; an `authorize` that throws is a 503, never an admission.
//
// CONNECTOR path — every other request. The bearer is looked up by its sha256
// through `lookupConnector`, and a refusal is a 401 with `WWW-Authenticate`,
// one body for every reason so a caller cannot learn which check failed. The
// project comes from the call's OWN `arguments.projectPath`, which must be
// `/proj_<16 hex>`; its id is that path minus the slash and the store's anchor
// is the path itself. `projectOwner` refuses a project owned by anyone else —
// an absent row is free, and a NULL owner is refused with the rest. A call
// naming no project runs under the user's principal on a store that refuses
// every project tool and answers `project_list` with `ownedProjects` plus one
// fresh path.
//
// A connector caller's `tools/call` runs holding one of that user's
// `USER_CALL_CAP` slots (self-hosted beta E4, per user; `utils/user-limits.ts`).
// A call over the cap waits in FIFO order and is never refused; one whose client
// hangs up while waiting leaves the queue without running, and one that waited
// has its token looked up again before it runs. `initialize`, `tools/list` and
// notifications never wait, and the worker path is not capped.
//
// The body is read ONCE for both paths, under `MAX_BODY_BYTES`, because a
// JSON-RPC batch has to be refused before any tool runs; the parsed value is
// handed to the transport, since a consumed stream cannot be read again.
// `/healthz`, `/livez` and the protected-resource metadata are answered before
// any token check. Which backend
// the store and the check use comes from the caller's `bindStore` and
// `authorize` — this module imports no backend, so the unit test supplies
// doubles and never loads `pg`/`@aws-sdk`. Readiness is injected the same way:
// `/healthz` maps the caller's `checkReady` report to 200 or 503. `/livez`
// touches no store, so a load balancer whose check gates a deploy (Blueprint's
// `elb_options.health_check`) can pass before the database exists.
import http, { type IncomingHttpHeaders, type RequestListener } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerPrincipal, connectorPrincipal, type Principal } from "./auth/principal.js";
import type { AppConfig } from "./types/auth.js";
import { allToolSchemas } from "./tool-schemas.js";
import { createServer } from "./server.js";
import { PROJECT_ID_RE } from "./store/project-id.js";
import { runWithUserCallSlot } from "./utils/user-limits.js";
import {
  ownedProjectsStore,
  runWithProjectStore,
  type ClaimFence,
  type OwnedProjectIds,
  type ProjectStore,
} from "./store/project-store.js";

export const MCP_PATH = "/mcp";
export const HEALTHZ_PATH = "/healthz";
export const LIVEZ_PATH = "/livez";
/** RFC 9728's protected-resource metadata for `/mcp`. Answered BEFORE the token
 *  check — it is what an unauthenticated client reads to learn where to go. */
export const PRM_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

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
  return bearerPrincipal(bearerFromHeaders(headers), baseConfig);
}

/** The `Authorization: Bearer <token>` token, or `""` when the header is
 *  missing or malformed. The principal and the project check read the same one. */
function bearerFromHeaders(headers: IncomingHttpHeaders): string {
  const raw = headers.authorization;
  const match = typeof raw === "string" ? /^bearer\s+(.+)$/i.exec(raw.trim()) : null;
  return match ? match[1].trim() : "";
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

/** The claim-fence pair (U6) as node:http lower-cases it; on the wire
 *  `X-Genealogy-Turn-Id` and `X-Genealogy-Claim-Epoch`. */
export const TURN_ID_HEADER = "x-genealogy-turn-id";
export const CLAIM_EPOCH_HEADER = "x-genealogy-claim-epoch";

/** A positive epoch with no leading zero, short enough to stay below bigint's
 *  max (2^63 − 1 has 19 digits). */
const CLAIM_EPOCH_RE = /^[1-9][0-9]{0,17}$/;

export type ClaimFenceFromHeaders =
  | { kind: "absent" }
  | { kind: "present"; fence: ClaimFence }
  | { kind: "malformed" };

/**
 * The worker attempt a request writes for: `X-Genealogy-Turn-Id` (a turn id,
 * the PROJECT_ID_RE shape — turn ids are uuid4 strings) and
 * `X-Genealogy-Claim-Epoch` (a positive decimal), both or neither. Neither is
 * `absent` (an unfenced request). `malformed` — a client bug answered before any
 * tool — is exactly one of the two, a duplicated header (an array, or node:http's
 * `, `-joined value, which neither pattern admits), a value that misses its
 * pattern after trimming, or a fence on a request that names no project.
 */
export function claimFenceFromHeaders(headers: IncomingHttpHeaders): ClaimFenceFromHeaders {
  const turnRaw = headers[TURN_ID_HEADER];
  const epochRaw = headers[CLAIM_EPOCH_HEADER];
  if (turnRaw === undefined && epochRaw === undefined) return { kind: "absent" };
  if (turnRaw === undefined || epochRaw === undefined) return { kind: "malformed" };
  if (Array.isArray(turnRaw) || Array.isArray(epochRaw)) return { kind: "malformed" };
  if (headers[PROJECT_ID_HEADER] === undefined) return { kind: "malformed" };
  const turnId = turnRaw.trim();
  const claimEpoch = epochRaw.trim();
  if (!PROJECT_ID_RE.test(turnId) || !CLAIM_EPOCH_RE.test(claimEpoch)) return { kind: "malformed" };
  return { kind: "present", fence: { turnId, claimEpoch } };
}

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

const INVALID_CLAIM_FENCE = {
  jsonrpc: "2.0",
  error: {
    code: -32600,
    message:
      "Invalid claim fence: send X-Genealogy-Turn-Id and X-Genealogy-Claim-Epoch together, " +
      "once each, with X-Genealogy-Project-Id.",
  },
  id: null,
};

/** The same body for every refusal reason, so a caller learns nothing about
 *  which check failed. */
const FORBIDDEN_ATTEMPT = {
  jsonrpc: "2.0",
  error: { code: -32600, message: "This bearer is not the grant of an open attempt on this project." },
  id: null,
};

const AUTHORIZATION_UNAVAILABLE = {
  jsonrpc: "2.0",
  error: { code: -32603, message: "Project authorization is unavailable." },
  id: null,
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** A short label for a lookup that threw: its `code`, else its `name`, never
 *  its message, which may carry a connection string or a token. */
function errorLabel(error: unknown): string {
  const err = error as { code?: unknown; name?: unknown };
  return typeof err?.code === "string" ? err.code : typeof err?.name === "string" ? err.name : "Error";
}

/** What a project request presents to `authorize`: the project it names, its
 *  claim fence when it sent one, and its bearer token (`""` when absent). */
export interface AuthorizeRequest {
  projectId: string;
  fence?: ClaimFence;
  bearer: string;
}

/** Why `authorize` refused: no fence to key the check on, no bearer, or no open
 *  attempt on the project whose grant is this bearer. */
export type AuthorizeRefusal = "no_fence" | "empty_bearer" | "no_match";

export type AuthorizeResult = { ok: true } | { ok: false; reason: AuthorizeRefusal };

/**
 * A connector project path, and the ONLY shape the door admits from one
 * (self-hosted beta E1; E2/#3991 lists the same shape). The project id is this
 * path with the leading `/` removed, which is also the store's anchor — every
 * tool call's `projectPath` must equal that anchor exactly (`assertAnchor`),
 * and `PROJECT_ID_RE` rejects an id containing `/`.
 */
export const CONNECTOR_PROJECT_RE = /^\/proj_[0-9a-f]{16}$/;

/**
 * The largest request body the door reads, for EVERY path.
 *
 * The body must be read before any tool runs, to refuse a batch, so this binds
 * the worker's writes too — a cap set too low 413s production writes with every
 * unit test green. Measured, not guessed: the largest tool-call arguments in
 * the whole run-log corpus are 53,329 bytes (a `research_append` in
 * `young-marriage-1828`, across 46,249 calls in 927 logs). 1 MiB is ~20x that,
 * and still refuses an abusive body long before it reaches a tool.
 */
export const MAX_BODY_BYTES = 1024 * 1024;

const BODY_TOO_LARGE = {
  jsonrpc: "2.0",
  error: { code: -32600, message: `Request body is larger than ${MAX_BODY_BYTES} bytes.` },
  id: null,
};

const BATCH_NOT_SUPPORTED = {
  jsonrpc: "2.0",
  error: { code: -32600, message: "A JSON-RPC batch is not supported; send one call per request." },
  id: null,
};

const MALFORMED_BODY = {
  jsonrpc: "2.0",
  error: { code: -32700, message: "Request body is not JSON." },
  id: null,
};

/** The same body for every connector refusal, so a caller learns nothing about
 *  which check failed: no such token, expired, ended grant, blocked user, no
 *  FamilySearch token, or one that will not decrypt. */
const UNAUTHORIZED = {
  jsonrpc: "2.0",
  error: { code: -32600, message: "Not authenticated. Sign in again to reconnect." },
  id: null,
};

const INVALID_CONNECTOR_PROJECT = {
  jsonrpc: "2.0",
  error: {
    code: -32600,
    message: "projectPath must be /proj_ followed by 16 lowercase hex characters.",
  },
  id: null,
};

/** The same body whether the project belongs to someone else or to nobody. */
const NOT_YOUR_PROJECT = {
  jsonrpc: "2.0",
  error: { code: -32600, message: "This project is not yours." },
  id: null,
};

/** What a connector call naming no project is told when it reaches the store.
 *  The dispatcher turns the thrown Error into an `isError` result, so this
 *  reaches the model as an instruction; it names the argument, not a header. */
const NO_CONNECTOR_PROJECT_MESSAGE =
  "This call named no project, so no project is bound: project tools cannot run. " +
  "Pass projectPath: \"/proj_<16 lowercase hex>\" — one of the paths project_list " +
  "returns. Tools that take no projectPath still work.";

/** What `lookupConnector` returns for an admitted connector token. */
export interface ConnectorCaller {
  /** `users.id`. */
  userId: string;
  /** The DECRYPTED FamilySearch access token — never the connector token. */
  familySearchToken: string;
  /** The decrypted OpenRouter key, or null for a user who linked none. */
  openRouterApiKey: string | null;
}

/** What `projectOwner` reports. A project with no row is free; one with a NULL
 *  owner is NOT — a connector never claims an ownerless project. */
export interface ProjectOwnerReport {
  exists: boolean;
  ownerId: string | null;
}

export interface ToolServerOptions {
  /** The process-wide config (~/.familysearch-mcp/config.json or the hosted
   *  equivalent) every request's bearer principal is built over. */
  baseConfig: AppConfig;
  /** The store for one project id, built per request. `signal` aborts when
   *  that request's client disconnects before its response is written; a store
   *  that writes transactionally rolls back rather than commit after it.
   *  `fence` is the request's claim (U6), absent on an unfenced request; a
   *  store given one commits only while that claim is current. */
  bindStore: (
    projectId: string,
    signal: AbortSignal,
    fence?: ClaimFence,
    /**
     * Connector requests only (E1). `anchorPath` is the caller's
     * `/proj_<16 hex>` path, which every tool call's `projectPath` must equal
     * exactly — without it the store anchors at the worker's
     * GENEALOGY_ANCHOR_PATH and every connector read reads nothing while every
     * write throws. `ownerId` is who `touchProject` records on a fresh id.
     */
    opts?: { anchorPath?: string; ownerId?: string },
  ) => ProjectStore;
  /** Whether this request's bearer may act on the project it names (U4). Called
   *  for every request with a project header, before `bindStore`; never for one
   *  without. Required, so no caller can leave the door open by omission; a
   *  throw is answered 503. */
  authorize: (req: AuthorizeRequest) => Promise<AuthorizeResult>;
  /**
   * Look up a connector token by the lowercase hex sha256 of its value, or
   * `null` for anything not admitted (self-hosted beta E1). Injected, not
   * imported, for the same reason as `authorize`: this module loads no backend,
   * so the unit test supplies a double and never pulls in `pg`.
   */
  lookupConnector: (tokenSha256: string) => Promise<ConnectorCaller | null>;
  /**
   * Who owns a project id, for a connector request naming one. Called after the
   * token is admitted and before `bindStore`; never on the worker path, which
   * has its own `authorize`.
   */
  projectOwner: (projectId: string) => Promise<ProjectOwnerReport>;
  /**
   * The project ids a connector caller owns, bounded, and whether more exist.
   * Called only when `project_list` reads the store; a rejection reaches the
   * model as `isError`, never as an empty list, which would read as "No project
   * yet".
   */
  ownedProjects: (userId: string) => Promise<OwnedProjectIds>;
  /**
   * The web tier's OAuth issuer, byte for byte. The protected-resource metadata
   * and the `WWW-Authenticate: resource_metadata=` URL are built from it, NEVER
   * from the request's `Host`, which a caller controls. Absent, the metadata
   * route answers 404 and a 401 carries a bare `Bearer`.
   */
  issuer?: string;
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

/** The sha256 a connector token is looked up by, matching `turns.bearer_sha256`
 *  and `connector_tokens.token_sha256`: lowercase hex of the UTF-8 value. */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

type BodyRead =
  | { kind: "ok"; value: unknown }
  | { kind: "too_large" }
  | { kind: "malformed" };

/**
 * Read the body ONCE, under the cap, and parse it.
 *
 * Once, because a stream already consumed cannot be read again — the parsed
 * value is handed to `transport.handleRequest(req, res, parsedBody)`, which the
 * SDK substitutes for its own read. Under the cap because this runs before any
 * tool, on every path.
 */
async function readBody(req: http.IncomingMessage): Promise<BodyRead> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    // Checked as it arrives, not after: the point is to stop reading, not to
    // buffer an abusive body and then complain about it.
    if (total > MAX_BODY_BYTES) return { kind: "too_large" };
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return { kind: "ok", value: undefined };
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch {
    return { kind: "malformed" };
  }
}

/** The one call's `arguments.projectPath`, when the body is a single
 *  `tools/call` that sent one as a string. Anything else: null. */
type ConnectorProject =
  /** No project named: `initialize`, `tools/list`, or a call that passes none. */
  | { kind: "absent" }
  /** A string, still to be checked against CONNECTOR_PROJECT_RE. */
  | { kind: "named"; projectPath: string }
  /** Present but not a string — an array, a number, null. Refused, never
   *  treated as "named no project": that would bind the unbound store and tell
   *  the caller to send a header instead of to fix the argument. */
  | { kind: "not_a_string" };

function connectorProjectPath(body: unknown): ConnectorProject {
  if (typeof body !== "object" || body === null) return { kind: "absent" };
  const msg = body as { method?: unknown; params?: unknown };
  if (msg.method !== "tools/call") return { kind: "absent" };
  const params = msg.params as { arguments?: unknown } | undefined;
  const args = params?.arguments as { projectPath?: unknown } | undefined;
  if (typeof args !== "object" || args === null || !("projectPath" in args)) return { kind: "absent" };
  if (typeof args.projectPath !== "string") return { kind: "not_a_string" };
  return { kind: "named", projectPath: args.projectPath };
}

/**
 * The config a connector caller acts under.
 *
 * Built from an explicit ALLOW-LIST of operator settings, never by spreading
 * `baseConfig`. Spreading leaks the tools tier's own per-user secrets to every
 * patron: `hosted-config-env.ts` puts the operator's `OPENROUTER_API_KEY` on
 * `baseConfig.openRouterApiKey`, and a caller whose own key is null — every
 * patron who has not linked one — would silently inherit it and bill
 * `image_transcribe` and `volume_bisect` to the operator's account.
 *
 * The line is: settings that describe the DEPLOYMENT are shared; a credential
 * that identifies a PERSON is not. `matcherApiKey` and `matcherUrl` are on the
 * shared side deliberately — they are this server's own credential to a
 * sibling service, like `wikiApiUrl`, not anything belonging to the caller.
 */
export function connectorConfig(baseConfig: AppConfig, caller: ConnectorCaller): AppConfig {
  return {
    // Deployment-level, shared by every caller.
    hosted: true,
    wikiApiUrl: baseConfig.wikiApiUrl,
    popStatsUrl: baseConfig.popStatsUrl,
    openRouterModel: baseConfig.openRouterModel,
    webPublicUrl: baseConfig.webPublicUrl,
    uploadsEnabled: baseConfig.uploadsEnabled,
    transcriptionEnabled: baseConfig.transcriptionEnabled,
    matcher: baseConfig.matcher,
    matcherUrl: baseConfig.matcherUrl,
    matcherApiKey: baseConfig.matcherApiKey,
    // Per-person. Absent unless THIS caller linked one; never the operator's.
    ...(caller.openRouterApiKey ? { openRouterApiKey: caller.openRouterApiKey } : {}),
  };
}

/** True for a `tools/call` REQUEST that names a tool: the only body that
 *  takes a user's slot. A notification (no `id`) is never answered and a call
 *  with no tool name runs no tool, so neither waits behind the user's calls. */
function isToolsCall(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const msg = body as { method?: unknown; id?: unknown; params?: unknown };
  if (msg.method !== "tools/call" || msg.id === undefined || msg.id === null) return false;
  return typeof (msg.params as { name?: unknown } | null | undefined)?.name === "string";
}

/**
 * The tool a body names, for the log line only. `-` when it names none.
 *
 * SANITIZED, because this is the only caller-controlled field on E1's audit
 * line and that line is newline-delimited `key=value`. The SDK types a tool
 * name as a plain string, so a newline survives parsing, and an admitted
 * caller could otherwise end the real record early and append a second,
 * fully-formed `ev=tool_call` attributed to another user id. Every other field
 * on the line is server- or database-sourced.
 *
 * Anything outside a tool name's own alphabet becomes `?`, so the value stays
 * one token on one line and is never silently dropped.
 */
export function toolNameOf(body: unknown): string {
  if (typeof body !== "object" || body === null) return "-";
  const msg = body as { method?: unknown; params?: unknown };
  const named =
    msg.method === "tools/call"
      ? (msg.params as { name?: unknown } | undefined)?.name
      : msg.method;
  if (typeof named !== "string" || named === "") return "-";
  // A tool name is `[a-z_]`, and a JSON-RPC method adds `/`; cap the length so
  // a long value cannot push the rest of the line out of a log viewer.
  return named.slice(0, 64).replace(/[^A-Za-z0-9_./-]/g, "?");
}

/**
 * Which of a call's FamilySearch statuses the audit line keeps.
 *
 * The FIRST failing one, not the last written. One tool makes many
 * FamilySearch requests -- `person_read` fans out over relatives and
 * transcribes memories five at a time -- so last-write-wins would let any
 * later 200 erase a 401 from partway through, and because those requests run
 * concurrently, which status survived would be a race rather than a fact.
 * `tests/utils/fs-fetch.test.ts` records that E3's session-end rule keys on
 * this value, so the refusal is the part worth keeping.
 */
export function keptFamilySearchStatus(current: number | null, next: number): number {
  if (current === null) return next;
  // A failure already recorded stands; a first failure replaces a success.
  if (current >= 400) return current;
  return next >= 400 ? next : current;
}

/** `<issuer>/.well-known/oauth-protected-resource/mcp`, the URL a 401 names. */
function resourceMetadataUrl(issuer: string): string {
  return `${issuer.replace(/\/$/, "")}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

/** 401 with `WWW-Authenticate`. With no issuer configured the challenge is a
 *  bare `Bearer`, since there is no metadata document to point at. */
function sendUnauthorized(res: http.ServerResponse, options: ToolServerOptions): void {
  const challenge = options.issuer
    ? `Bearer resource_metadata="${resourceMetadataUrl(options.issuer)}"`
    : "Bearer";
  res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": challenge });
  res.end(JSON.stringify(UNAUTHORIZED));
}

async function handleMcpPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ToolServerOptions,
): Promise<void> {
  // The store is decided before any transport exists: a malformed id never
  // reaches a tool, and a missing one takes the connector path, which binds its
  // own store rather than falling through to the process store.
  const projectId = projectIdFromHeaders(req.headers);
  if (projectId.kind === "malformed") {
    sendJson(res, 400, INVALID_PROJECT_ID);
    return;
  }
  const claim = claimFenceFromHeaders(req.headers);
  if (claim.kind === "malformed") {
    sendJson(res, 400, INVALID_CLAIM_FENCE);
    return;
  }

  // Read ONCE, under the cap, before either path: a batch has to be refused
  // before any tool runs, and that means parsing the body here. The parsed
  // value is handed to the transport below, which uses it instead of reading
  // the stream again.
  const body = await readBody(req);
  if (body.kind === "too_large") {
    sendJson(res, 413, BODY_TOO_LARGE);
    return;
  }
  if (body.kind === "malformed") {
    sendJson(res, 400, MALFORMED_BODY);
    return;
  }
  if (Array.isArray(body.value)) {
    sendJson(res, 400, BATCH_NOT_SUPPORTED);
    return;
  }

  // Which door. A request carrying the project header is the WORKER path and
  // keeps every rule it had (U4/U6, 403 on refusal). Everything else needs a
  // connector token (E1).
  const isWorkerPath = projectId.kind === "present";

  if (isWorkerPath) {
    const fence = claim.kind === "present" ? claim.fence : undefined;
    let verdict: AuthorizeResult;
    try {
      verdict = await options.authorize({ projectId: projectId.id, fence, bearer: bearerFromHeaders(req.headers) });
    } catch (error) {
      process.stderr.write(`ev=tool_authorize_failed error=${errorLabel(error)} project_id=${projectId.id}\n`);
      sendJson(res, 503, AUTHORIZATION_UNAVAILABLE);
      return;
    }
    if (!verdict.ok) {
      process.stderr.write(
        `ev=tool_refused reason=${verdict.reason} project_id=${projectId.id} turn_id=${fence?.turnId ?? "-"}\n`,
      );
      sendJson(res, 403, FORBIDDEN_ATTEMPT);
      return;
    }
  }

  // A killed worker closes its socket but sends nothing; without this its
  // in-flight write would commit after the caller that could read the result
  // is gone, and the resumed turn would write the same thing again.
  const disconnected = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) disconnected.abort();
  });

  let principal: Principal;
  let store: ProjectStore;
  let logUserId = "-";
  /** The connector caller whose slot a `tools/call` takes, and the sha256 its
   *  token is looked up by again if the call waits; unset on the worker path. */
  let capUserId: string | undefined;
  let capTokenSha256 = "";
  let familySearchStatus: number | null = null;
  const recordFamilySearchStatus = (status: number): void => {
    familySearchStatus = keptFamilySearchStatus(familySearchStatus, status);
  };

  if (isWorkerPath) {
    principal = principalFromHeaders(req.headers, options.baseConfig);
    store = options.bindStore(
      projectId.id,
      disconnected.signal,
      claim.kind === "present" ? claim.fence : undefined,
    );
  } else {
    const bearer = bearerFromHeaders(req.headers);
    let caller: ConnectorCaller | null = null;
    if (bearer !== "") {
      try {
        caller = await options.lookupConnector(sha256Hex(bearer));
      } catch (error) {
        // Never an admission, exactly as an `authorize` that throws is not.
        process.stderr.write(`ev=tool_authorize_failed error=${errorLabel(error)} surface=connector\n`);
        sendJson(res, 503, AUTHORIZATION_UNAVAILABLE);
        return;
      }
    }
    if (!caller) {
      // One body for every reason: no token, expired, ended grant, blocked
      // user, no FamilySearch token, or one that will not decrypt.
      process.stderr.write("ev=tool_refused reason=no_connector_token surface=connector\n");
      sendUnauthorized(res, options);
      return;
    }
    logUserId = caller.userId;
    capUserId = caller.userId;
    capTokenSha256 = sha256Hex(bearer);

    const named = connectorProjectPath(body.value);
    if (named.kind === "not_a_string") {
      sendJson(res, 400, INVALID_CONNECTOR_PROJECT);
      return;
    }
    const projectPath = named.kind === "named" ? named.projectPath : null;
    if (projectPath === null) {
      // `initialize`, `tools/list`, notifications, and any call that sent no
      // projectPath: store-less, but still only for an admitted token. The one
      // exception is `project_list`, and the store is lazy, so nothing else
      // queries or binds anything.
      // NOT the worker's message: it says to send X-Genealogy-Project-Id, a
      // header a connector cannot send — and if it did, the request would
      // route to the worker door and be refused 403. Name the remedy that
      // exists on THIS door.
      const userId = caller.userId;
      store = ownedProjectsStore(NO_CONNECTOR_PROJECT_MESSAGE, {
        // The door refuses any other shape, so naming one would offer a dead path.
        listOwned: async () => {
          const owned = await options.ownedProjects(userId);
          return {
            projectPaths: owned.ids.map((id) => `/${id}`).filter((path) => CONNECTOR_PROJECT_RE.test(path)),
            truncated: owned.truncated,
          };
        },
        freshPath: `/proj_${randomBytes(8).toString("hex")}`,
        storeFor: (path) =>
          options.bindStore(path.slice(1), disconnected.signal, undefined, { anchorPath: path, ownerId: userId }),
        signal: disconnected.signal,
      });
    } else {
      if (!CONNECTOR_PROJECT_RE.test(projectPath)) {
        sendJson(res, 400, INVALID_CONNECTOR_PROJECT);
        return;
      }
      // The id is the path without its slash; the path itself is the anchor,
      // which every tool call's projectPath must equal exactly.
      const connectorProjectId = projectPath.slice(1);
      let owner: ProjectOwnerReport;
      try {
        owner = await options.projectOwner(connectorProjectId);
      } catch (error) {
        process.stderr.write(`ev=tool_authorize_failed error=${errorLabel(error)} surface=connector\n`);
        sendJson(res, 503, AUTHORIZATION_UNAVAILABLE);
        return;
      }
      // A NULL owner is refused with the rest: a connector never claims an
      // ownerless project, unlike the web tier's may_create_or_claim. An
      // absent row is free -- the first write decides (touchProject).
      if (owner.exists && owner.ownerId !== caller.userId) {
        process.stderr.write(
          `ev=tool_refused reason=not_owner surface=connector user_id=${caller.userId}\n`,
        );
        sendJson(res, 403, NOT_YOUR_PROJECT);
        return;
      }
      store = options.bindStore(connectorProjectId, disconnected.signal, undefined, {
        anchorPath: projectPath,
        ownerId: caller.userId,
      });
    }

    principal = connectorPrincipal({
      accessToken: caller.familySearchToken,
      userId: caller.userId,
      config: connectorConfig(options.baseConfig, caller),
      recordFamilySearchStatus,
    });
  }

  const run = async (): Promise<void> => {
    const server = createServer(principal);
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
        // The pre-read body, since the stream is already consumed.
        await transport.handleRequest(req, res, body.value);
      });
    } finally {
      await server.close();
      // One line per call (E1): the user, the tool, and any FamilySearch status.
      // Never the token or its hash.
      const toolName = toolNameOf(body.value);
      process.stderr.write(
        `ev=tool_call surface=${isWorkerPath ? "worker" : "connector"} user_id=${logUserId} ` +
          `tool=${toolName} fs_status=${familySearchStatus ?? "-"}\n`,
      );
    }
  };

  /**
   * A call that waited for its slot was admitted before it queued, so look its
   * token up again before it runs. A user blocked, or a grant ended, while it
   * waited is refused exactly as at the door: S2's delete script blocks first and
   * relies on the next call being refused. The FamilySearch token and config
   * come from the fresh lookup, since the web tier may have replaced the token
   * meanwhile. False when the call was answered here.
   */
  const stillAdmitted = async (userId: string): Promise<boolean> => {
    let again: ConnectorCaller | null;
    try {
      again = await options.lookupConnector(capTokenSha256);
    } catch (error) {
      process.stderr.write(`ev=tool_authorize_failed error=${errorLabel(error)} surface=connector\n`);
      sendJson(res, 503, AUTHORIZATION_UNAVAILABLE);
      return false;
    }
    if (!again || again.userId !== userId) {
      process.stderr.write("ev=tool_refused reason=no_connector_token surface=connector\n");
      sendUnauthorized(res, options);
      return false;
    }
    principal = connectorPrincipal({
      accessToken: again.familySearchToken,
      userId: again.userId,
      config: connectorConfig(options.baseConfig, again),
      recordFamilySearchStatus,
    });
    return true;
  };

  // E4, per user: the slot is released however `run` ends, a throw included.
  if (capUserId !== undefined && isToolsCall(body.value)) {
    const userId = capUserId;
    let hungUp = false;
    const ran = await runWithUserCallSlot(userId, disconnected.signal, async (waited) => {
      if (waited && !(await stillAdmitted(userId))) return;
      // The client may have hung up during that second lookup.
      if (disconnected.signal.aborted) {
        hungUp = true;
        return;
      }
      await run();
    });
    if (!ran || hungUp) {
      // The client hung up while the call waited, so there is no one to answer
      // and nothing ran. One line, so the call is not missing from the log.
      process.stderr.write(
        `ev=tool_abandoned surface=connector user_id=${userId} tool=${toolNameOf(body.value)}\n`,
      );
    }
    return;
  }
  await run();
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
  if (pathname === PRM_PATH && req.method === "GET") {
    // Built from the configured issuer, NEVER from the request's Host, which a
    // caller controls — a forged Host here would point clients at an
    // attacker's authorization server. Unset, there is no document to serve
    // and the 401 carries a bare `Bearer` to match.
    if (!options.issuer) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const issuer = options.issuer.replace(/\/$/, "");
    sendJson(res, 200, { resource: `${issuer}${MCP_PATH}`, authorization_servers: [issuer] });
    return;
  }
  if (pathname === LIVEZ_PATH && req.method === "GET") {
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
  await handleMcpPost(req, res, options);
}

/** The node:http request listener: `/healthz`, `/livez`, `/mcp` (POST only), 404 elsewhere. */
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
        authorize: options.authorize,
        lookupConnector: options.lookupConnector,
        projectOwner: options.projectOwner,
        ownedProjects: options.ownedProjects,
        issuer: options.issuer,
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
