/**
 * One-shot smoke test for tree_gaps against the live FS API. No MCP harness.
 * Requires a valid session (run the login tool / dev/e2e-login.ts first).
 *
 * Usage:
 *   cd packages/engine/mcp-server
 *   npx tsx dev/try-tree-gaps.ts                      # logged-in user
 *   npx tsx dev/try-tree-gaps.ts LZJW-C31
 *   npx tsx dev/try-tree-gaps.ts LZJW-C31 --up 6 --down 3 --max 10
 */
import { LOCAL } from "../src/auth/principal.js";
import { treeGapsTool } from "../src/tools/tree-gaps.js";
import type { TreeGapsInput } from "../src/types/tree-gaps.js";

const args = process.argv.slice(2);
const flag = (n: string): number | undefined => {
  const i = args.indexOf(n);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const input: TreeGapsInput = {};
const first = args[0];
if (first && !first.startsWith("--")) input.personId = first;
const up = flag("--up");
const down = flag("--down");
const max = flag("--max");
if (up !== undefined) input.ancestorGenerations = up;
if (down !== undefined) input.descendantGenerations = down;
if (max !== undefined) input.maxHoles = max;

console.log("Input:", JSON.stringify(input));
const t0 = Date.now();
try {
  const r = await treeGapsTool(input, LOCAL);
  console.log(`${Date.now() - t0}ms`, JSON.stringify(r.scanned), r.notes);
  console.log(`root: ${r.root.name} (${r.root.personId})`);
  for (const g of r.gaps) {
    const yr = g.yearRange ? `${g.yearRange.start}-${g.yearRange.end}` : "-";
    const cov = g.coverage
      ? `${g.coverage.collections} coll/${g.coverage.records} rec, census [${g.coverage.censusYears.join(",")}], ${g.coverage.placeLevel}`
      : "n/a";
    console.log(`${String(g.generation).padStart(3)} ${g.type.padEnd(17)} ${g.personId} ${g.name} | ${yr} | ${g.place ?? "-"} | ${cov} | ${g.detail}`);
  }
} catch (e) {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
}
