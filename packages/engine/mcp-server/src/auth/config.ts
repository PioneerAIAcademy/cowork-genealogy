import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, readFile } from "node:fs/promises";
import type { AppConfig } from "../types/auth.js";
import type { Principal } from "./principal.js";

export const AUTHORIZATION_URL =
  "https://ident.familysearch.org/cis-web/oauth2/v3/authorization";
export const TOKEN_URL =
  "https://ident.familysearch.org/cis-web/oauth2/v3/token";

export const CALLBACK_HOST = "127.0.0.1";
export const CALLBACK_PORT = 1837;
export const CALLBACK_PATH = "/callback";
export const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

export const SCOPES = "offline_access";
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
export const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export const STORAGE_DIR = path.join(os.homedir(), ".familysearch-mcp");
export const TOKEN_STORAGE_PATH = path.join(STORAGE_DIR, "tokens.json");
export const CONFIG_STORAGE_PATH = path.join(STORAGE_DIR, "config.json");

// Path resolves to mcp-server/config/familysearch.json in both dev (tsx/vitest
// running from src/) and prod (compiled JS in build/) — ../../config sits one
// directory above either rootDir.
export const BUNDLED_CLIENT_CONFIG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../config/familysearch.json"
);

export const CLIENT_ID_PACKAGING_ERROR =
  "FamilySearch client ID is unavailable. The MCP server's bundled config " +
  "file (config/familysearch.json) is missing, unreadable, or malformed. " +
  "This is an installation problem — reinstall the MCP server.";

export const DEFAULT_WIKI_API_URL = "https://malachi.taild68f1b.ts.net/wiki";

// Default OCR model for image_transcribe. Overridable per-user via
// `openRouterModel` in config.json (swap the slug without a rebuild). The LLM
// does not choose the model — it is not a tool parameter.
//
// Do NOT "update to the latest Gemini" by reaching for `:batch` — that sibling
// slug runs against a batch queue, and batch latency blows the 60s Cowork
// device-bridge abort that §5.7 of the spec sizes this call against.
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.7-flash";

// What to tell the LLM when FamilySearch auth is unusable in the HOSTED runtime.
// The `login` tool's loopback flow cannot complete there: the callback listener
// binds the sandbox's 127.0.0.1:1837, while the registered redirect resolves on
// the user's own laptop. Sending the user to the app's Reconnect button is the
// only path that actually re-authenticates them, so the error must say that and
// must NOT mention the login tool.
export const HOSTED_REAUTH_INSTRUCTION =
  "FamilySearch is not accepting this session. Click \"Reconnect FamilySearch\" " +
  "at the top of the app to sign in again, then ask me to continue. (Do not call " +
  "the login tool: it cannot open a sign-in page from here.)";

/** What hosted `login` answers. It must not claim the session was rejected:
 *  login is called after an image 403 with a working token, and that claim
 *  confirmed the wrong diagnosis. It matches neither REAUTH_HITS nor
 *  REAUTH_ENTRY (apps/server/proto/turn.py), which count as auth failures. */
export const HOSTED_LOGIN_UNAVAILABLE =
  "The login tool is not available in the web app, and this answer says " +
  "nothing about whether the current FamilySearch session works. Only if a " +
  "FamilySearch tool itself reported a sign-in problem, ask the user to click " +
  "the Reconnect button at the top of the app, then continue. An image that " +
  "fails with 403 is most likely restricted, not a sign-in problem.";

export const OPENROUTER_API_KEY_MISSING_MESSAGE =
  "No OpenRouter API key is configured. Tell the user to get one at " +
  "https://openrouter.ai/keys and enter it in Claude Desktop under Settings → " +
  "Desktop app → Extensions → Genealogy Research → Configure, or add it to " +
  "~/.familysearch-mcp/config.json as the \"openRouterApiKey\" field. " +
  "Do not ask the user to paste the key into the chat.";

// ── A CONNECTOR caller (self-hosted beta E3) ────────────────────────────────
// A user in claude.ai or Desktop Chat, reaching this server through the
// connector. Neither the worker's "Reconnect FamilySearch" button nor the
// desktop's `login` tool exists for them: they sign in again on the web tier's
// own page, and the connector itself stays connected.

/** True for a request that came through the connector door. Not a type guard:
 *  a worker's bearer is a bearer too, and must not be narrowed away by a false. */
export function isConnector(principal: Principal): boolean {
  return principal.kind === "bearer" && principal.surface === "connector";
}

/** The web tier's public origin for a connector caller, without a trailing
 *  slash, or undefined: for any other caller, and when the server was given
 *  none (`WEB_PUBLIC_URL`, checked at start-up to be a plain http(s) URL). */
function connectorWebOrigin(principal: Principal): string | undefined {
  if (principal.kind !== "bearer" || principal.surface !== "connector") return undefined;
  return principal.config.webPublicUrl?.trim().replace(/\/+$/, "") || undefined;
}

/** The web tier's FamilySearch sign-in page for a connector caller, or
 *  undefined (`connectorWebOrigin`). */
export function connectorSignInUrl(principal: Principal): string | undefined {
  const base = connectorWebOrigin(principal);
  return base ? `${base}/auth/familysearch/login` : undefined;
}

/** Where the message sends the user: the link, or the site by name when the
 *  server has no public URL to build one from. */
function connectorSignInPlace(principal: Principal): string {
  return connectorSignInUrl(principal) ?? "the Genealogy Research site";
}

/**
 * What a connector caller is told when FamilySearch no longer accepts their
 * session. This is the text measured live (issue #3529, item 10): it reached
 * the user unchanged from the main thread, from an agent and in a new
 * conversation, and "continue" then worked on the same connector token.
 * Addressed to the user, with no order to stop: the model relays it and the
 * conversation goes on once they have signed in.
 */
export function connectorReauthMessage(principal: Principal): string {
  return (
    `FamilySearch session not accepted. Sign in again at ${connectorSignInPlace(principal)}, ` +
    `then come back here and say "continue". Nothing is lost.`
  );
}

/** What `login` answers a connector caller. Like `HOSTED_LOGIN_UNAVAILABLE` it
 *  must not claim the session was rejected: this answer checks nothing. */
export function connectorLoginMessage(principal: Principal): string {
  return (
    "The login tool does not sign anyone in here, and this answer says nothing about " +
    "whether the current FamilySearch session works. Only if a FamilySearch tool itself " +
    `reported a sign-in problem, tell the user to sign in again at ${connectorSignInPlace(principal)}, ` +
    "then say \"continue\". An image that fails with 403 is most likely restricted, not a sign-in problem."
  );
}

/** What `logout` answers a connector caller: signing out happens on the web
 *  tier, and it also ends this connector's connection. */
export function connectorLogoutMessage(principal: Principal): string {
  return (
    `Signing out happens at ${connectorWebOrigin(principal) ?? "the Genealogy Research site"}: tell the user to sign out there. ` +
    "That also disconnects Claude from Genealogy Research until they reconnect."
  );
}

/** A connector caller has no settings page and no config file: on this beta
 *  the key that reads images is put on an account by its administrator. */
export const CONNECTOR_OPENROUTER_KEY_MISSING_MESSAGE =
  "Reading images is not turned on for this account, so this image was not transcribed. " +
  "Tell the user it is turned on per account by the beta's administrator, and carry on " +
  "without this image. Do not ask the user to paste a key into the chat.";

// The one variable the stdio entrypoint reads. manifest.json's `user_config`
// asks for the key on the extension's Configure page in Claude Desktop, and its
// `mcp_config.env` hands the answer over under this name — an environment
// variable is the only channel `user_config` has.
export const INSTALL_OPENROUTER_KEY_ENV = "GENEALOGY_OPENROUTER_API_KEY";

/**
 * What the install dialog collected, as config for `localPrincipal`. A field
 * left blank arrives empty or as the unsubstituted `${user_config...}`
 * placeholder (the mcpb reference loader keeps a variable it has no value for);
 * both mean "not set", so `config.json` still applies.
 */
export function installConfigFromEnv(env: NodeJS.ProcessEnv): AppConfig {
  const key = env[INSTALL_OPENROUTER_KEY_ENV]?.trim();
  return key && !key.startsWith("${") ? { openRouterApiKey: key } : {};
}

/**
 * The per-user config `principal` acts with: the desktop's
 * `~/.familysearch-mcp/config.json` for the local principal, with its
 * `overlay` on top, and the config that travelled with the request for a
 * bearer. Every getter below takes the principal for the same reason
 * `getValidToken` does (auth/principal.ts).
 */
export async function loadConfig(principal: Principal): Promise<AppConfig> {
  if (principal.kind === "bearer") {
    return principal.config;
  }
  return { ...(await readConfigFile()), ...principal.overlay };
}

async function readConfigFile(): Promise<AppConfig> {
  try {
    const raw = await readFile(CONFIG_STORAGE_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as AppConfig;
  } catch {
    return {};
  }
}

export async function ensureStorageDir(): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
  await chmod(STORAGE_DIR, 0o700);
}

export const HOSTED_SESSION_MANAGED_MESSAGE =
  "The FamilySearch session is managed by the web app in a hosted session; sign out there.";

export async function getClientId(): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(BUNDLED_CLIENT_CONFIG_PATH, "utf8");
  } catch {
    throw new Error(CLIENT_ID_PACKAGING_ERROR);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(CLIENT_ID_PACKAGING_ERROR);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(CLIENT_ID_PACKAGING_ERROR);
  }
  const clientId = (parsed as { clientId?: unknown }).clientId;
  if (typeof clientId !== "string" || clientId.trim().length === 0) {
    throw new Error(CLIENT_ID_PACKAGING_ERROR);
  }
  return clientId.trim();
}

// True inside a hosted sandbox (the control plane writes `hosted: true` into
// config.json when it provisions one). Defaults to false, so the desktop .mcpb
// — where interactive loopback login IS the right answer — is unaffected.
export async function isHostedMode(principal: Principal): Promise<boolean> {
  if (principal.kind === "bearer") return true;
  const config = await loadConfig(principal);
  return config.hosted === true;
}

/** The desktop text for a token FamilySearch rejected (401). */
export const REJECTED_TOKEN_MESSAGE =
  "FamilySearch rejected the access token (401). The session may have " +
  "expired or been revoked — call the login tool to re-authenticate.";

/**
 * What to tell the LLM when there is no FamilySearch session it can use, by
 * who is calling: a connector caller gets the web tier's sign-in link; any
 * other hosted caller (the worker, the alpha's sandbox) the app's Reconnect
 * button, since `login` is a dead end there; the desktop, `desktopText`.
 * The one place the three are told apart, for a missing session
 * (`getValidToken`) and a rejected one (`rejectedTokenMessage`) alike.
 */
export async function reauthMessage(principal: Principal, desktopText: string): Promise<string> {
  if (isConnector(principal)) return connectorReauthMessage(principal);
  return (await isHostedMode(principal)) ? HOSTED_REAUTH_INSTRUCTION : desktopText;
}

/** What a tool throws when FamilySearch answers 401 (`reauthMessage`); on the
 *  desktop, the tool's own `desktopText`. */
export async function rejectedTokenMessage(
  principal: Principal,
  desktopText: string = REJECTED_TOKEN_MESSAGE,
): Promise<string> {
  return reauthMessage(principal, desktopText);
}

export async function getWikiApiUrl(principal: Principal): Promise<string> {
  const config = await loadConfig(principal);
  const url = config.wikiApiUrl?.trim().replace(/\/$/, "");
  return url || DEFAULT_WIKI_API_URL;
}

// OpenRouter key resolution is config-only (no env-var fallback, per the repo
// rule): the server reads it here in every runtime, and no tool reaches for it in
// the environment. Each runtime fills the config before that: e2e and the hosted
// sandbox write config.json at the orchestration layer, the prototype's two
// container entrypoints layer their own environment over it (hosted-config-env.ts),
// and the desktop stdio entrypoint layers the install dialog's answer over it
// (installConfigFromEnv) — see docs/specs/image-transcribe-tool-spec.md, "Key
// provisioning across runtimes".
export async function getOpenRouterApiKey(principal: Principal): Promise<string> {
  const config = await loadConfig(principal);
  const key = config.openRouterApiKey?.trim();
  if (!key) {
    throw new Error(
      isConnector(principal) ? CONNECTOR_OPENROUTER_KEY_MISSING_MESSAGE : OPENROUTER_API_KEY_MISSING_MESSAGE,
    );
  }
  return key;
}

export async function getOpenRouterModel(principal: Principal): Promise<string> {
  const config = await loadConfig(principal);
  return config.openRouterModel?.trim() || DEFAULT_OPENROUTER_MODEL;
}

/** Which matcher scores a pair (`utils/matcher.ts`), and how to reach the service. */
export type MatcherSettings =
  | { backend: "familysearch" }
  | { backend: "service"; url: string; apiKey: string };

const NO_KEY_IN_CHAT = "Do not ask the user to paste a key into the chat.";

export const MATCHER_VALUE_MESSAGE =
  "The \"matcher\" setting in ~/.familysearch-mcp/config.json must be \"familysearch\" " +
  "or \"service\". Fix it there, or remove it to score with FamilySearch's matcher. " +
  NO_KEY_IN_CHAT;

function matcherServiceMissing(key: "matcherUrl" | "matcherApiKey", what: string): string {
  return (
    `~/.familysearch-mcp/config.json sets "matcher" to "service" but has no "${key}". ` +
    `Add ${what} as "${key}" there, or set "matcher" to "familysearch". ${NO_KEY_IN_CHAT}`
  );
}

/** The trimmed string at `value`, or "" when it is not a string. */
function configString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The matcher `principal`'s config names. No `matcher` key is FamilySearch's
 * matcher; any value but the two throws rather than fall back to either. Config
 * only, like every getter here: no environment variable is read.
 */
export async function getMatcherSettings(principal: Principal): Promise<MatcherSettings> {
  const config = await loadConfig(principal);
  if (!Object.hasOwn(config, "matcher") || config.matcher === "familysearch") {
    return { backend: "familysearch" };
  }
  if (config.matcher !== "service") throw new Error(MATCHER_VALUE_MESSAGE);
  const url = configString(config.matcherUrl).replace(/\/$/, "");
  if (!url) throw new Error(matcherServiceMissing("matcherUrl", "the matcher service's base URL"));
  const apiKey = configString(config.matcherApiKey);
  if (!apiKey) throw new Error(matcherServiceMissing("matcherApiKey", "this caller's matcher key"));
  return { backend: "service", url, apiKey };
}
