// Issue #4431, Step 0 / the spec row's measurement: what does the void-search
// guard refuse over the committed e2e corpus?
//
//   npx tsx dev/probe-void-search-candidates.ts            # the figures
//   npx tsx dev/probe-void-search-candidates.ts --list     # + one line per candidate
//
// The gate is the TOOL'S OWN, imported, never restated, so this runs unchanged
// against any revision: run it on main and on a branch and diff the two outputs
// to read what a change refuses or releases.
//
// It asks FamilySearch the one question the corpus cannot answer — whether a
// group is full-text searchable — and so splits true refusals from completions
// the guard must leave alone. A `null` answer is UNKNOWN, never "unsearchable";
// the guard does not fire on it and neither does this report.
//
// Corpus: every COMMITTED eval/runlogs/e2e/*/*.final-research.json (`git
// ls-files`, so untracked scratch runs are not counted).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { LOCAL } from "../src/auth/principal.js";
import { fetchFulltextSearchableBatched } from "../src/utils/fulltext-searchable.js";
import {
  planItemVoidSearchInvariants,
  voidSearchCandidateGroupIds,
} from "../src/tools/research-append.js";

const LIST = process.argv.includes("--list");
const ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const tracked = (pattern: string): string[] =>
  execFileSync("git", ["ls-files", pattern], { cwd: ROOT, encoding: "utf-8", maxBuffer: 1 << 28 })
    .split("\n")
    .filter(Boolean);

const docs: { label: string; research: any }[] = [];
for (const rel of tracked("eval/runlogs/e2e/*/*.final-research.json")) {
  try {
    const research = JSON.parse(readFileSync(join(ROOT, rel), "utf-8"));
    if (research && typeof research === "object") docs.push({ label: rel.replace("eval/runlogs/e2e/", ""), research });
  } catch {
    console.error(`  !! unreadable: ${rel}`);
  }
}

const completedItems = (research: any): any[] =>
  (Array.isArray(research.plans) ? research.plans : [])
    .flatMap((pl: any) => (pl && Array.isArray(pl.items) ? pl.items : []))
    .filter((it: any) => it && typeof it === "object" && it.status === "completed");

// One question for the whole corpus, from the tool's own candidate collector.
const allIds = [...new Set(docs.flatMap((d) => voidSearchCandidateGroupIds(d.research)))].sort();
console.log(`${docs.length} committed final-research documents`);
console.log(`${docs.reduce((n, d) => n + completedItems(d.research).length, 0)} completed plan items`);
console.log(`\nAsking FamilySearch about ${allIds.length} answerable group id(s)...\n`);

const searchable = await fetchFulltextSearchableBatched(allIds, LOCAL);
if (searchable === null) {
  console.log("FamilySearch returned UNKNOWN (null). The guard refuses nothing on an UNKNOWN");
  console.log("answer, so this run cannot measure. Re-run later.");
  process.exit(0);
}

// The guard itself decides. Two passes: what it refuses with the real answer,
// and what it WOULD refuse if nothing were searchable — the difference is how
// much of the silence is FamilySearch's answer rather than the other conditions.
let refused = 0;
let refusedIfNothingSearchable = 0;
const NOTHING = new Set<string>();
const rows: string[] = [];

for (const d of docs) {
  for (const item of completedItems(d.research)) {
    const asked = new Set(allIds);
    const real = planItemVoidSearchInvariants(item, d.research, { asked, searchable });
    const worst = planItemVoidSearchInvariants(item, d.research, { asked, searchable: NOTHING });
    if (real.length > 0) {
      refused += 1;
      rows.push(`REFUSED  ${d.label}  ${item.id}`);
    } else if (worst.length > 0) {
      rows.push(`allowed  ${d.label}  ${item.id}  (every other condition held; FS reports its groups searchable)`);
    }
    if (worst.length > 0) refusedIfNothingSearchable += 1;
  }
}

if (LIST || rows.length <= 20) for (const r of rows) console.log(r);

console.log("\n" + "=".repeat(72));
console.log(`refuses                       ${refused}`);
console.log(`would refuse if NOTHING were searchable  ${refusedIfNothingSearchable}`);
console.log(`unsearchable groups of the ${allIds.length} asked about: ` +
  `${allIds.filter((g) => !searchable.has(g)).join(", ") || "(none)"}`);
console.log("=".repeat(72));
if (refused === 0) {
  console.log("\nThe guard refuses nothing in the committed corpus. Per ADR-0011 limit 2");
  console.log("the bar is inspection, not a rate — the labelled case set carries it.");
}
