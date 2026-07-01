/**
 * One-shot smoke test for the person_quality tool against the live FS API.
 * No MCP harness — calls the tool function directly.
 *
 * Requires a valid session (run `npx tsx dev/try-login.ts unused` first).
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-person-quality.ts KD96-TV2
 */
import { personQualityTool } from "../src/tools/person-quality.js";

const personId = process.argv[2];
if (!personId) {
  console.error("Usage: npx tsx dev/try-person-quality.ts <personId>");
  process.exit(1);
}

console.log("Input:", JSON.stringify({ personId }));
console.log("---");

try {
  const result = await personQualityTool({ personId });
  console.log(
    `${result.personId}  overall=${result.overallScore} (${result.qualityBand})  ` +
      `segment=${result.segment}  issues=${result.issueCount}`,
  );
  for (const c of result.categories) {
    console.log(`  ${c.scoreType.padEnd(14)} count=${c.count}  score=${c.score}`);
  }
  console.log("---");
  for (const i of result.issues) {
    console.log(`  [${i.scoreType}/${i.conclusionType}] ${i.sentence}`);
  }
  console.log("---");
  console.log("Full JSON:");
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("ERROR:", (e as Error).message);
  process.exit(1);
}
