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

export const WIKI_API_URL_MISSING_MESSAGE =
  "wiki-query-api MCP is not configured. Create the file " +
  "~/.familysearch-mcp/config.json with shape " +
  '{ "wikiApiUrl": "http://localhost:8000" } ' +
  "and start the wiki-query-api server with " +
  "`python scripts/wiki/30_serve.py` from the wiki-query-api repo.";

export const WIKI_MARKDOWN_DIR_MISSING_MESSAGE =
  "Wiki markdown directory is not configured. Add " +
  '"wikiMarkdownDir": "/path/to/wiki/markdown" ' +
  "to ~/.familysearch-mcp/config.json. " +
  "Ask your team lead for the path to the pre-crawled wiki markdown files.";

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
  if (!url) {
    throw new Error(WIKI_API_URL_MISSING_MESSAGE);
  }
  return url;
}

export async function getWikiMarkdownDir(): Promise<string> {
  const config = await loadConfig();
  const dir = config.wikiMarkdownDir?.trim();
  if (!dir) {
    throw new Error(WIKI_MARKDOWN_DIR_MISSING_MESSAGE);
  }
  return dir;
}

export async function getLearningCenterDir(): Promise<string | null> {
  const config = await loadConfig();
  return config.learningCenterDir?.trim() ?? null;
}

export async function getLibraryDir(): Promise<string | null> {
  const config = await loadConfig();
  return config.libraryDir?.trim() ?? null;
}
