/**
 * Smoke-test the source_screen tool against a project person mode has built.
 *
 * Usage:
 *   npx tsx dev/try-source-screen.ts <projectPath> <personId> [--checks a,b,c,e,g,h]
 *
 * `--checks` passes the internal `checks` option (not on the MCP schema) to run
 * only those checks. Calls the configured matcher and, for flagged attachments,
 * OpenRouter (needs `openRouterApiKey` in ~/.familysearch-mcp/config.json).
 *
 * Example:
 *   npx tsx dev/try-source-screen.ts /home/me/projects/flynn I1 --checks a,b,h
 */
import { LOCAL } from "../src/auth/principal.js";
import { ALL_CHECKS, sourceScreenTool } from "../src/tools/source-screen.js";
import type { SourceScreenCheck } from "../src/types/source-screen.js";

const args = process.argv.slice(2);

function usage(): never {
  console.error("Usage: npx tsx dev/try-source-screen.ts <projectPath> <personId> [--checks a,b,c,e,g,h]");
  process.exit(1);
}

const flag = args.indexOf("--checks");
let checks: SourceScreenCheck[] | undefined;
if (flag >= 0) {
  const listed = (args[flag + 1] ?? usage()).split(",").map((c) => c.trim());
  const unknown = listed.filter((c) => !(ALL_CHECKS as readonly string[]).includes(c));
  if (unknown.length > 0 || listed.length === 0) {
    console.error(`Unknown check(s): ${unknown.join(", ") || "(none given)"}; choose from ${ALL_CHECKS.join(",")}.`);
    process.exit(1);
  }
  checks = listed as SourceScreenCheck[];
  args.splice(flag, 2);
}

const input = { projectPath: args[0] ?? usage(), personId: args[1] ?? usage() };

const started = Date.now();
try {
  const result = await sourceScreenTool(input, LOCAL, checks ? { checks } : {});
  console.error(`(${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
