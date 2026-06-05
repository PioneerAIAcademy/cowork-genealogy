/**
 * Smoke-test the person_warnings tool against a local tree.gedcomx.json.
 *
 * Usage:
 *   npx tsx dev/try-person-warnings.ts <projectPath> <personId>
 *
 * Example:
 *   npx tsx dev/try-person-warnings.ts /home/me/projects/flynn I1
 */
import { personWarningsTool } from "../src/tools/person-warnings.js";

const [, , projectPath, personId] = process.argv;
if (!projectPath || !personId) {
  console.error("Usage: npx tsx dev/try-person-warnings.ts <projectPath> <personId>");
  console.error("");
  console.error("Example:");
  console.error("  npx tsx dev/try-person-warnings.ts /home/me/projects/flynn I1");
  process.exit(1);
}

try {
  const result = await personWarningsTool({ projectPath, personId });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
}
