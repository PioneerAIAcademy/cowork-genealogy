import { readFile, rename, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import {
  ensureStorageDir,
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

/**
 * Write tokens.json whole: a new temp file beside it, created 0o600, renamed over
 * it, so a concurrent loadTokens reads the old tokens or the new ones, never a
 * partly written file. Rejects with the write's or the rename's own error, after
 * removing the temp.
 */
export async function saveTokens(tokens: TokenStore): Promise<void> {
  await ensureStorageDir();
  const tmp = join(
    dirname(TOKEN_STORAGE_PATH),
    `.${basename(TOKEN_STORAGE_PATH)}.tmp-${randomUUID()}`,
  );
  try {
    await writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600, flag: "wx" });
    await rename(tmp, TOKEN_STORAGE_PATH);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
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
