import {
  TOKEN_URL,
  REDIRECT_URI,
  getClientId,
  isHostedMode,
  HOSTED_REAUTH_INSTRUCTION,
} from "./config.js";
import { loadTokens, saveTokens, isExpired } from "./tokenManager.js";
import type { TokenStore, FSTokenResponse } from "../types/auth.js";

// The instruction the LLM gets when there is no usable FamilySearch session.
// In hosted mode the `login` tool is a dead end (its loopback callback can't
// reach the user's browser), so point them at the app's Reconnect button; on
// the desktop, `login` is exactly right.
async function reauthInstruction(desktopMessage: string): Promise<string> {
  return (await isHostedMode()) ? HOSTED_REAUTH_INSTRUCTION : desktopMessage;
}

async function postTokenEndpoint(
  body: URLSearchParams
): Promise<FSTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  let data: FSTokenResponse | null = null;
  try {
    data = (await response.json()) as FSTokenResponse;
  } catch {
    data = null;
  }

  if (data?.error) {
    const detail = data.error_description ? ` — ${data.error_description}` : "";
    throw new Error(`FamilySearch token error: ${data.error}${detail}`);
  }
  if (!response.ok) {
    throw new Error(
      `FamilySearch token endpoint error: ${response.status} ${response.statusText}`
    );
  }
  if (!data || !data.access_token) {
    throw new Error("FamilySearch token endpoint returned no access token");
  }
  return data;
}

function toTokenStore(
  data: FSTokenResponse,
  fallbackRefreshToken?: string
): TokenStore {
  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? fallbackRefreshToken,
    expiresAt: Date.now() + expiresInMs,
  };
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<TokenStore> {
  const clientId = await getClientId();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  const data = await postTokenEndpoint(body);
  return toTokenStore(data);
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenStore> {
  const clientId = await getClientId();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const data = await postTokenEndpoint(body);
  return toTokenStore(data, refreshToken);
}

export async function getValidToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error(
      await reauthInstruction(
        "User is not logged in to FamilySearch. Call the login tool to authenticate."
      )
    );
  }
  if (!isExpired(tokens)) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new Error(
      await reauthInstruction(
        "FamilySearch access token has expired and no refresh token is available. Call the login tool to re-authenticate."
      )
    );
  }
  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    await saveTokens(refreshed);
    return refreshed.accessToken;
  } catch {
    throw new Error(
      await reauthInstruction(
        "FamilySearch session has expired and refresh failed. Call the login tool to re-authenticate."
      )
    );
  }
}
