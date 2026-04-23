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
  saveConfig,
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

export interface PerformLoginOptions {
  clientId?: string;
}

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

function startCallbackServer(): {
  server: Server;
  wait: Promise<CallbackResult>;
} {
  let resolveWait!: (result: CallbackResult) => void;
  const wait = new Promise<CallbackResult>((resolve) => {
    resolveWait = resolve;
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
  server.listen(CALLBACK_PORT, CALLBACK_HOST);
  return { server, wait };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

export async function performLogin(
  options: PerformLoginOptions = {}
): Promise<LoginResult> {
  if (options.clientId && options.clientId.trim().length > 0) {
    try {
      await saveConfig({ clientId: options.clientId.trim() });
    } catch (err) {
      return {
        success: false,
        message: `Failed to save FamilySearch client ID to config: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
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

  const { server, wait } = startCallbackServer();

  let timeoutId: NodeJS.Timeout | undefined;
  try {
    try {
      await open(authUrl);
    } catch {
      return {
        success: false,
        message:
          "Could not open the browser automatically. Open this URL manually to complete login:\n" +
          authUrl,
      };
    }

    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), LOGIN_TIMEOUT_MS);
    });

    const result = await Promise.race<CallbackResult | "timeout">([
      wait,
      timeoutPromise,
    ]);

    if (result === "timeout") {
      return {
        success: false,
        message:
          "Login timed out after 5 minutes. Call the login tool again to retry.",
      };
    }

    if (result.error) {
      const detail = result.errorDescription ? `: ${result.errorDescription}` : "";
      return {
        success: false,
        message: `FamilySearch returned an error${detail} (${result.error}). Call the login tool again to retry.`,
      };
    }

    if (!result.code) {
      return {
        success: false,
        message:
          "Login callback did not include an authorization code. Call the login tool again to retry.",
      };
    }

    if (result.state !== state) {
      return {
        success: false,
        message:
          "Login state mismatch (possible CSRF). Call the login tool again to retry.",
      };
    }

    try {
      const tokens = await exchangeCodeForTokens(result.code, codeVerifier);
      await saveTokens(tokens);
      return { success: true, message: "Login successful." };
    } catch (err) {
      return {
        success: false,
        message: `Token exchange failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    await closeServer(server);
  }
}
