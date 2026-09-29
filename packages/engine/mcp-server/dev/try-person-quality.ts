/**
 * One-shot smoke test for the person_quality tool against the live FS API.
 * No MCP harness — calls the tool function directly.
 *
 * Requires a valid session (run `npx tsx dev/try-login.ts unused` first).
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-person-quality.ts KD96-TV2
 *   npx tsx dev/try-person-quality.ts KD96-TV2 --detail
 *
 * --detail opts in to the per-fact breakdown (#2225 D2): which attached sources
 * touch each fact and whether each agrees, plus the disagreements between
 * sources. Expect it to be sparse — only 5 of KD96-TV2's 14 conclusions have
 * any attached source at all.
 */
import { LOCAL } from "../src/auth/principal.js";
import { personQualityTool } from "../src/tools/person-quality.js";

const args = process.argv.slice(2);
const detail = args.includes("--detail");
const personId = args.find((a) => !a.startsWith("--"));
if (!personId) {
  console.error("Usage: npx tsx dev/try-person-quality.ts <personId> [--detail]");
  process.exit(1);
}

console.log("Input:", JSON.stringify({ personId, detail }));
console.log("---");

try {
  const result = await personQualityTool({ personId, detail }, LOCAL);
  if ("reason" in result) {
    // Not a FamilySearch person id: answered without a network call.
    console.log(`${result.reason}: ${result.errors.join(" ")}`);
    process.exit(0);
  }
  console.log(
    `${result.personId}  overall=${result.overallScore}  ` +
      `segment=${result.segment}  issues=${result.issueCount}`,
  );
  for (const c of result.categories) {
    console.log(`  ${c.scoreType.padEnd(14)} count=${c.count}  score=${c.score}`);
  }
  console.log("---");
  for (const i of result.issues) {
    console.log(`  [${i.scoreType}/${i.conclusionType}] ${i.sentence}`);
  }
  if (result.detail) {
    console.log("---");
    console.log(
      `facts=${result.detail.facts.length}  ` +
        `withSources=${result.detail.facts.filter((f) => f.sources.length > 0).length}  ` +
        `conflicts=${result.detail.conflicts.length}`,
    );
    for (const f of result.detail.facts) {
      console.log(`  ${(f.conclusionType ?? "?").padEnd(13)} score=${f.score}`);
      for (const s of f.sources) {
        console.log(`      ${s.agrees === true ? "agrees " : s.agrees === false ? "DIFFERS" : "unknown"}  ${s.title}`);
      }
      for (const i of f.issues) console.log(`      issue: ${i}`);
    }
    for (const c of result.detail.conflicts) {
      console.log(`  CONFLICT ${c.field}: ${c.values.join("  vs  ")}  (${c.sources.length} sources)`);
    }
  }
  console.log("---");
  console.log("Full JSON:");
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("ERROR:", (e as Error).message);
  process.exit(1);
}
