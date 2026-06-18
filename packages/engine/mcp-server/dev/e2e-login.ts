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
 * What happens: starts a local OAuth callback listener, opens your
 * browser to FamilySearch, and on success saves the tokens to
 * ~/.familysearch-mcp/tokens.json. After that, e2e runs and `make
 * e2e-preflight` will find the token.
 */
import { loginTool } from "../src/tools/login.js";

console.log("Starting FamilySearch login. Your browser should open shortly.");
console.log("If it doesn't, copy the authorization URL printed below.");
console.log("---");

const result = await loginTool({});

console.log("---");
if (result.success) {
  console.log("Login succeeded. Token saved to ~/.familysearch-mcp/tokens.json.");
  console.log("You're ready to run e2e tests for ~24h (re-run this to refresh).");
} else {
  console.error("Login failed:");
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
