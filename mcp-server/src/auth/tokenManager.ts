import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import {
  STORAGE_DIR,
  TOKEN_STORAGE_PATH,
  EXPIRY_BUFFER_MS,
} from "./config.js";
import type { TokenStore } from "../types/auth.js";

function isTokenStore(value: unknown): value is TokenStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.accessToken !== "string" || v.accessToken.length === 0) {
    return false;
  }
  if (typeof v.expiresAt !== "number" || !Number.isFinite(v.expiresAt)) {
    return false;
  }
  if (v.refreshToken !== undefined && typeof v.refreshToken !== "string") {
    return false;
  }
  return true;
}

export async function saveTokens(tokens: TokenStore): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(TOKEN_STORAGE_PATH, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
}

export async function loadTokens(): Promise<TokenStore | null> {
  try {
    const raw = await readFile(TOKEN_STORAGE_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isTokenStore(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isExpired(tokens: TokenStore, now: number = Date.now()): boolean {
  return now >= tokens.expiresAt - EXPIRY_BUFFER_MS;
}

export async function clearTokens(): Promise<void> {
  await rm(TOKEN_STORAGE_PATH, { force: true });
}
