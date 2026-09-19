/**
 * fs-token — print the desktop login's current FamilySearch access token, refreshed
 * first through the engine's own LOCAL path (getValidToken(LOCAL): load
 * ~/.familysearch-mcp/tokens.json, refresh when expired, persist). This is how the
 * prototype stack gets its FS_ACCESS_TOKEN (apps/server/proto/env.sh): one patron,
 * the operator, on every turn, and never a stale token copied by hand.
 *
 *   npx tsx dev/fs-token.ts
 *
 * The token and nothing else on stdout; exit 2 with the reason on stderr when there
 * is no session to refresh (log in with the desktop `login` tool first).
 */
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";

try {
  process.stdout.write(await getValidToken(LOCAL));
} catch (err) {
  process.stderr.write(`fs-token: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
}
