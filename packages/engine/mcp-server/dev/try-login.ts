/**
 * One-off FS login from the remote Linux box.
 *
 * Usage:
 *   npx tsx dev/try-login.ts
 *
 * What happens:
 *   1. Starts an HTTP listener on 127.0.0.1:1837 for the OAuth callback.
 *   2. Prints the FamilySearch authorize URL.
 *   3. You paste that URL into a browser on your laptop (Windows). VS
 *      Code's port-forward for 1837 makes the redirect reach this box.
 *   4. After you sign in, FS redirects back; the script exchanges the
 *      code for tokens and saves them to ~/.familysearch-mcp/tokens.json.
 *   5. Probe scripts that use getValidToken() will now work.
 */
import { loginTool } from "../src/tools/login.js";

// No clientId argument: `loginTool` takes `Record<string, never>` and the FS
// client ID comes from the bundled `config/familysearch.json` via getClientId()
// — the sole source, with no override (CLAUDE.md § Secrets/config convention).
// This script used to demand an argument it could not pass on.
console.log("Starting OAuth flow. Watch for the authorization URL below.");
console.log("Open it in a browser on your laptop (port 1837 must be forwarded).");
console.log("---");

const result = await loginTool();
console.log("---");
console.log("Login result:");
console.log(JSON.stringify(result, null, 2));
