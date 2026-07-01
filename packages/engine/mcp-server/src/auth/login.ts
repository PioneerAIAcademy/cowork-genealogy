import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import open from "open";
import {
  AUTHORIZATION_URL,
  CALLBACK_HOST,
  CALLBACK_PATH,
  CALLBACK_PORT,
  LOGIN_TIMEOUT_MS,
  REDIRECT_URI,
  SCOPES,
  getClientId,
} from "./config.js";
import { generatePKCE, generateState } from "./pkce.js";
import { exchangeCodeForTokens } from "./refresh.js";
import { saveTokens } from "./tokenManager.js";
import type { LoginResult } from "../types/auth.js";

interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

// Set while an OAuth flow is in flight (callback server listening). Lets a
// repeat `login` call hand back the same URL instead of failing on a busy
// port. Cleared when the flow completes or times out.
let pendingAuthUrl: string | null = null;

function buildAuthorizationUrl(
  clientId: string,
  state: string,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZATION_URL}?${params.toString()}`;
}

function htmlPage(title: string, heading: string, body: string, color: string): string {
  return (
    "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">" +
    `<title>${title}</title>` +
    "<style>body{font-family:system-ui,sans-serif;text-align:center;padding:40px;color:#222}" +
    `h1{color:${color}}p{color:#555}</style></head><body>` +
    `<h1>${heading}</h1><p>${body}</p></body></html>`
  );
}

// Start the local OAuth callback listener. Resolves once it is listening;
// rejects if the port is unavailable (usually: a login already in progress).
function startCallbackServer(): Promise<{
  server: Server;
  wait: Promise<CallbackResult>;
}> {
  return new Promise((resolve, reject) => {
    let resolveWait!: (result: CallbackResult) => void;
    const wait = new Promise<CallbackResult>((res) => {
      resolveWait = res;
    });

    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error") ?? undefined;
      const errorDescription =
        url.searchParams.get("error_description") ?? undefined;
      const code = url.searchParams.get("code") ?? undefined;
      const state = url.searchParams.get("state") ?? undefined;

      if (error || !code) {
        const shown = error
          ? `${error}${errorDescription ? `: ${errorDescription}` : ""}`
          : "No authorization code received.";
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(htmlPage("Login failed", "Login failed", shown, "#cf222e"));
        resolveWait({ error: error ?? "no_code", errorDescription, code, state });
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        htmlPage(
          "Login successful",
          "Login successful",
          "You can close this tab and return to Claude.",
          "#1a7f37"
        )
      );
      resolveWait({ code, state });
    };

    const server = createServer(handler);
    server.once("error", reject);
    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
      resolve({ server, wait });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

// Wait for the OAuth callback, exchange the code, and save tokens. Runs
// detached in the background so `performLogin` can return the auth URL
// immediately. Never throws — failures are logged to stderr; the user
// confirms the outcome via the `auth_status` tool.
async function completeLoginInBackground(
  server: Server,
  wait: Promise<CallbackResult>,
  expectedState: string,
  codeVerifier: string
): Promise<void> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), LOGIN_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race<CallbackResult | "timeout">([
      wait,
      timeout,
    ]);

    if (result === "timeout") {
      console.error("FamilySearch login timed out before the callback arrived.");
      return;
    }
    if (result.error) {
      console.error(`FamilySearch login error: ${result.error}`);
      return;
    }
    if (!result.code) {
      console.error("FamilySearch login callback had no authorization code.");
      return;
    }
    if (result.state !== expectedState) {
      console.error("FamilySearch login state mismatch (possible CSRF).");
      return;
    }

    const tokens = await exchangeCodeForTokens(result.code, codeVerifier);
    await saveTokens(tokens);
  } catch (err) {
    console.error(
      "FamilySearch token exchange failed:",
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    pendingAuthUrl = null;
    await closeServer(server);
  }
}

export async function performLogin(): Promise<LoginResult> {
  // A flow is already running — hand back the same URL rather than failing
  // on the busy callback port.
  if (pendingAuthUrl) {
    return {
      success: true,
      message:
        "A FamilySearch login is already in progress. Open this URL in a " +
        "browser to sign in:\n\n" +
        pendingAuthUrl +
        "\n\nAfter you sign in and approve, ask me to check your login status.",
    };
  }

  let clientId: string;
  try {
    clientId = await getClientId();
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = generateState();
  const authUrl = buildAuthorizationUrl(clientId, state, codeChallenge);

  let server: Server;
  let wait: Promise<CallbackResult>;
  try {
    ({ server, wait } = await startCallbackServer());
  } catch {
    return {
      success: false,
      message:
        `Could not start the local login listener on port ${CALLBACK_PORT}. ` +
        "Another login may already be in progress, or the port is in use. " +
        "Wait a moment and try again.",
    };
  }

  pendingAuthUrl = authUrl;

  // Finish the OAuth handshake in the background so this call returns now,
  // with the URL, instead of blocking until the callback arrives.
  void completeLoginInBackground(server, wait, state, codeVerifier);

  // Best-effort browser launch. If it fails — headless host, no default
  // browser, sandboxed process — the URL in the message below is the
  // fallback the user opens manually.
  void open(authUrl).catch(() => {});

  return {
    success: true,
    message:
      "FamilySearch login started. A browser tab should have opened for you " +
      "to sign in.\n\n" +
      "If no tab appeared, open this URL yourself:\n\n" +
      authUrl +
      "\n\nSign in, approve the authorization, then ask me to check your " +
      "login status to confirm.",
  };
}
