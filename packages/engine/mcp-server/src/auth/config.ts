import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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
  "Your FamilySearch session has expired — FamilySearch sign-ins last at most " +
  "24 hours. Click \"Reconnect FamilySearch\" at the top of the app to sign in " +
  "again, then ask me to continue. (Do not call the login tool: it cannot open " +
  "a sign-in page from here.)";

export const OPENROUTER_API_KEY_MISSING_MESSAGE =
  "No OpenRouter API key is configured. Tell the user to add their " +
  "OpenRouter API key (from https://openrouter.ai/keys) to " +
  "~/.familysearch-mcp/config.json as the \"openRouterApiKey\" field. " +
  "Do not ask the user to paste the key into the chat.";

/**
 * The per-user config `principal` acts with: the desktop's
 * `~/.familysearch-mcp/config.json` for the local principal, the config that
 * travelled with the request for a bearer. Every getter below takes the
 * principal for the same reason `getValidToken` does (auth/principal.ts).
 */
export async function loadConfig(principal: Principal): Promise<AppConfig> {
  if (principal.kind === "bearer") {
    return principal.config;
  }
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

export const HOSTED_CONFIG_READ_ONLY_MESSAGE =
  "Per-user settings are managed by the web app in a hosted session and cannot be changed from here.";

export const HOSTED_SESSION_MANAGED_MESSAGE =
  "The FamilySearch session is managed by the web app in a hosted session; sign out there.";

export async function saveConfig(patch: Partial<AppConfig>, principal: Principal): Promise<void> {
  if (principal.kind === "bearer") {
    throw new Error(HOSTED_CONFIG_READ_ONLY_MESSAGE);
  }
  const existing = await loadConfig(principal);
  const merged: AppConfig = { ...existing, ...patch };
  await ensureStorageDir();
  await writeFile(
    CONFIG_STORAGE_PATH,
    JSON.stringify(merged, null, 2),
    { mode: 0o600 }
  );
}

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

export async function getWikiApiUrl(principal: Principal): Promise<string> {
  const config = await loadConfig(principal);
  const url = config.wikiApiUrl?.trim().replace(/\/$/, "");
  return url || DEFAULT_WIKI_API_URL;
}

// OpenRouter key resolution is config-only (no env-var fallback, per the repo
// rule): the server reads it here in every runtime. e2e and the hosted
// sandbox bridge their env var into config.json at the orchestration layer —
// see docs/specs/image-transcribe-tool-spec.md §6.5.
export async function getOpenRouterApiKey(principal: Principal): Promise<string> {
  const config = await loadConfig(principal);
  const key = config.openRouterApiKey?.trim();
  if (!key) {
    throw new Error(OPENROUTER_API_KEY_MISSING_MESSAGE);
  }
  return key;
}

export async function getOpenRouterModel(principal: Principal): Promise<string> {
  const config = await loadConfig(principal);
  return config.openRouterModel?.trim() || DEFAULT_OPENROUTER_MODEL;
}
