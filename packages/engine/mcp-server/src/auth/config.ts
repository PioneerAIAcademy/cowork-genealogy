import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AppConfig } from "../types/auth.js";

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
// `openRouterModel` in config.json (set the Phase-0-chosen slug without a
// rebuild). The LLM does not choose the model — it is not a tool parameter.
export const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3-vl-235b-a22b-instruct";

export const OPENROUTER_API_KEY_MISSING_MESSAGE =
  "No OpenRouter API key is configured. Ask the user for their OpenRouter " +
  "API key (from https://openrouter.ai/keys) and call configure_openrouter " +
  "to save it for future projects.";

export async function loadConfig(): Promise<AppConfig> {
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

export async function saveConfig(patch: Partial<AppConfig>): Promise<void> {
  const existing = await loadConfig();
  const merged: AppConfig = { ...existing, ...patch };
  await mkdir(STORAGE_DIR, { recursive: true });
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

export async function getWikiApiUrl(): Promise<string> {
  const config = await loadConfig();
  const url = config.wikiApiUrl?.trim().replace(/\/$/, "");
  return url || DEFAULT_WIKI_API_URL;
}

export async function getLearningCenterDir(): Promise<string | null> {
  const config = await loadConfig();
  return config.learningCenterDir?.trim() ?? null;
}

export async function getLibraryDir(): Promise<string | null> {
  const config = await loadConfig();
  return config.libraryDir?.trim() ?? null;
}

// OpenRouter key resolution is config-only (no env-var fallback, per the repo
// rule): the server reads it here in every runtime. e2e and the hosted
// sandbox bridge their env var into config.json at the orchestration layer —
// see docs/specs/image-transcribe-tool-spec.md §6.5.
export async function getOpenRouterApiKey(): Promise<string> {
  const config = await loadConfig();
  const key = config.openRouterApiKey?.trim();
  if (!key) {
    throw new Error(OPENROUTER_API_KEY_MISSING_MESSAGE);
  }
  return key;
}

export async function getOpenRouterModel(): Promise<string> {
  const config = await loadConfig();
  return config.openRouterModel?.trim() || DEFAULT_OPENROUTER_MODEL;
}
