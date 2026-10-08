/**
 * Smoke-test the person_warnings tool.
 *
 * Usage:
 *   npx tsx dev/try-person-warnings.ts <projectPath> <personId>
 *
 * Example:
 *   npx tsx dev/try-person-warnings.ts /home/me/projects/flynn I1
 */
import { personWarningsTool } from "../src/tools/person-warnings.js";

const args = process.argv.slice(2);

function usage(): never {
  console.error("Usage: npx tsx dev/try-person-warnings.ts <projectPath> <personId>");
  console.error("");
  console.error("Example:");
  console.error("  npx tsx dev/try-person-warnings.ts /home/me/projects/flynn I1");
  process.exit(1);
}

const input = {
  projectPath: args[0] ?? usage(),
  personId: args[1] ?? usage(),
};

const started = Date.now();
try {
  const result = await personWarningsTool(input);
  console.error(`(${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
}
