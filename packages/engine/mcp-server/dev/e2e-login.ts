/**
 * FamilySearch login for e2e tests.
 *
 * Runs the same OAuth flow as the `login` MCP tool, using the bundled
 * client ID — so a contributor logs in once with one command instead of
 * having to open a Claude Code session and invoke the tool by hand. The
 * token is host-global and lasts ~24h, shared by every e2e run (headless
 * harness, scratch session, interactive). This is a once-per-day act.
 *
 * Usage (preferred): `make e2e-login` (or Login.bat on Windows), which
 * builds the server first. Direct: `npx tsx dev/e2e-login.ts` from
 * packages/engine/mcp-server/.
 *
 * What happens: starts a local OAuth callback listener and tries to open
 * your browser to FamilySearch. Browser auto-open fails on many hosts
 * (WSL with interop disabled, headless servers, sandboxed processes), so
 * the authorization URL is always printed for you to open manually. The
 * script then WAITS for you to sign in and only reports success once the
 * token is actually written to ~/.familysearch-mcp/tokens.json — it does
 * not claim success merely because the flow started.
 */
import { loginTool } from "../src/tools/login.js";
import { loadTokens, isExpired } from "../src/auth/tokenManager.js";
import { LOGIN_TIMEOUT_MS } from "../src/auth/config.js";

const POLL_INTERVAL_MS = 2000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Baseline: the access token (if any) already on disk, so a fresh login can
// be told apart from a pre-existing session. Never logged.
const before = await loadTokens();
const beforeToken = before?.accessToken ?? null;

console.log("Starting FamilySearch login.");
console.log("---");

const result = await loginTool({});

// `success` here means the flow STARTED, not that we are logged in.
if (!result.success) {
  console.error("Could not start FamilySearch login:");
  console.error(result.message);
  process.exit(1);
}

// The browser may not have opened (WSL/headless/sandboxed). The message
// includes the authorization URL — print it so it can be opened manually.
console.log(result.message);
console.log("---");
console.log(
  "Waiting for you to sign in and approve in the browser (up to " +
    `${Math.round(LOGIN_TIMEOUT_MS / 60000)} min)...`
);

// Poll until the token is actually saved (a new access token appears), which
// only happens after the OAuth callback completes in the background.
const deadline = Date.now() + LOGIN_TIMEOUT_MS;
while (Date.now() < deadline) {
  await sleep(POLL_INTERVAL_MS);
  const current = await loadTokens();
  if (current && !isExpired(current) && current.accessToken !== beforeToken) {
    console.log("---");
    console.log(
      "Login succeeded. Token saved to ~/.familysearch-mcp/tokens.json."
    );
    console.log(
      "You're ready to run e2e tests for ~24h (re-run this to refresh)."
    );
    process.exit(0);
  }
}

console.error("---");
console.error(
  "Login did not complete in time — no token was saved.\n" +
    "Re-run `make e2e-login` and open the printed URL in your browser promptly."
);
process.exit(1);
