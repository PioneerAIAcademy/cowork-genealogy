// Re-derive the #1731 step 3 figures quoted in research-append-tool-spec.md's
// §5 row, over the committed e2e corpus.
//
//   npx tsx dev/replay-score-gate.ts
//
// The predicates are the TOOL'S OWN — `personaReachable` and
// `mintedFromThisRecord` are imported, never re-implemented here. A replay that
// restates the rule measures the restatement, which is how the PID figure in an
// earlier revision of this row came to exclude the one fixture the PID arm
// exists to serve.
//
// Reads every eval/runlogs/e2e/<fixture>/run-*.final-research.json with its
// .final-tree.gedcomx.json sibling, and the fixture's committed
// starting-tree.gedcomx.json when there is one (william-ferber-ancestry has
// none, which the PID column reports separately rather than silently dropping).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { personaReachable, mintedFromThisRecord } from "../src/tools/research-append.js";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const RUNS = join(ROOT, "eval", "runlogs", "e2e");
const FIX = join(ROOT, "eval", "tests", "e2e");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

let files = 0, links = 0, noRecord = 0, circular = 0, circularScored = 0;
let unreachable = 0, reachable = 0, noBaseline = 0, unreachableScored = 0;

for (const slug of readdirSync(RUNS)) {
  const dir = join(RUNS, slug);
  let entries: string[];
  try { entries = readdirSync(dir); } catch { continue; }
  const startPath = join(FIX, slug, "starting-tree.gedcomx.json");
  let startIds = new Set<string>();
  if (existsSync(startPath)) {
    startIds = new Set(
      ((readJson(startPath).persons ?? []) as any[])
        .map((p) => p?.id)
        .filter((id): id is string => typeof id === "string" && id !== ""),
    );
  } else {
    noBaseline += 1;
  }
  for (const f of entries) {
    if (!f.endsWith(".final-research.json")) continue;
    const treePath = join(dir, f.replace(".final-research.json", ".final-tree.gedcomx.json"));
    if (!existsSync(treePath)) continue;
    const research = readJson(join(dir, f));
    const tree = readJson(treePath);
    files += 1;
    const byId = new Map<string, any>(
      ((research.assertions ?? []) as any[]).filter((a) => a?.id).map((a) => [a.id, a]),
    );
    for (const e of (research.person_evidence ?? []) as any[]) {
      links += 1;
      const a = byId.get(e.assertion_id);
      const recordId = a?.record_id ?? null;
      if (typeof recordId !== "string" || recordId === "") { noRecord += 1; continue; }
      if (mintedFromThisRecord(e.person_id, recordId, research, tree, startIds)) {
        circular += 1;
        if (e.match_score !== null && e.match_score !== undefined) circularScored += 1;
        continue;
      }
      if (personaReachable(e, research)) { reachable += 1; continue; }
      unreachable += 1;
      // Reachability excuses a MISSING score, not a fabricated one: an
      // unreachable link that CARRIES a number still needs an attestation.
      if (e.match_score !== null && e.match_score !== undefined) unreachableScored += 1;
    }
  }
}

console.log(`runs read                          : ${files}   (fixtures with no starting-tree baseline: ${noBaseline})`);
console.log(`person_evidence links              : ${links}`);
console.log(`  no record side                   : ${noRecord}`);
console.log(`  circular-exempt                  : ${circular}   (carrying a score, so refused: ${circularScored})`);
console.log(`  unreachable                      : ${unreachable}   (carrying a score, so still refused: ${unreachableScored})`);
console.log(`  reachable, needs an attestation  : ${reachable}`);
