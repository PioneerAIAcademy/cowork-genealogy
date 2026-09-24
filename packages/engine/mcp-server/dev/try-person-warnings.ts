/**
 * Smoke-test the person_warnings tool, in either mode.
 *
 * Usage:
 *   npx tsx dev/try-person-warnings.ts <projectPath> <personId>   # local tree
 *   npx tsx dev/try-person-warnings.ts --live <personId>          # live FamilySearch
 *
 * Examples:
 *   npx tsx dev/try-person-warnings.ts /home/me/projects/flynn I1
 *   npx tsx dev/try-person-warnings.ts --live KD96-TV2
 *
 * Live mode needs a prior `npx tsx dev/try-login.ts`. It sees parents, spouses
 * and children but NOT siblings (FamilySearch's relatives=true omits them), so a
 * sibling-based relative warning fires locally and stays silent live.
 */
import { LOCAL } from "../src/auth/principal.js";
import { personWarningsTool } from "../src/tools/person-warnings.js";

const args = process.argv.slice(2);
const live = args.includes("--live");
const positional = args.filter((a) => !a.startsWith("--"));

function usage(): never {
  console.error("Usage: npx tsx dev/try-person-warnings.ts <projectPath> <personId>");
  console.error("       npx tsx dev/try-person-warnings.ts --live <personId>");
  console.error("");
  console.error("Examples:");
  console.error("  npx tsx dev/try-person-warnings.ts /home/me/projects/flynn I1");
  console.error("  npx tsx dev/try-person-warnings.ts --live KD96-TV2");
  process.exit(1);
}

const input = live
  ? { personId: positional[0] ?? usage(), live: true }
  : {
      projectPath: positional[0] ?? usage(),
      personId: positional[1] ?? usage(),
    };

const started = Date.now();
try {
  const result = await personWarningsTool(input, LOCAL);
  // Live mode's wall clock is worth printing: person_read's place
  // standardization runs per fact at concurrency 8, and relatives=true
  // multiplies the fact count by mob size, so the total is not the 30s of a
  // single fetch.
  console.error(`(${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
}
