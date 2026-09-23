import type { Principal } from "../auth/principal.js";
import { loadTokens, isExpired } from "../auth/tokenManager.js";
import type { AuthStatusResult } from "../types/auth.js";
import { readBuildInfo } from "../utils/build-info.js";

export type AuthStatusToolInput = Record<string, never>;

export async function authStatusTool(
  _input: AuthStatusToolInput,
  principal: Principal
): Promise<AuthStatusResult> {
  // On every branch, so a tester can read which build answered even with no
  // session and no project (#2126).
  const buildId = readBuildInfo().version;
  // A bearer principal carries its credential with the request; the web tier
  // that issued it knows the expiry, this server does not.
  if (principal.kind === "bearer") {
    return { loggedIn: principal.accessToken.length > 0, buildId };
  }
  const tokens = await loadTokens();
  if (!tokens) {
    return { loggedIn: false, buildId };
  }

  const expiresAt = new Date(tokens.expiresAt).toISOString();
  const hasRefreshToken = typeof tokens.refreshToken === "string";

  if (isExpired(tokens)) {
    return { loggedIn: false, expiresAt, hasRefreshToken, buildId };
  }

  const expiresInMinutes = Math.max(
    0,
    Math.round((tokens.expiresAt - Date.now()) / 60_000)
  );
  return { loggedIn: true, expiresAt, expiresInMinutes, hasRefreshToken, buildId };
}

export const authStatusToolSchema = {
  name: "auth_status",
  description:
    "Report whether a valid FamilySearch session exists, when it expires (ISO 8601), " +
    "how many minutes remain, and whether a refresh token is available. Also returns " +
    "buildId, the engine build (version+date.sha) — quote it when reporting a problem.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};
