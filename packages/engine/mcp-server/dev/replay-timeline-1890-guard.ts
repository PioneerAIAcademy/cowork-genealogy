// Corpus replay for the US 1890 census backstop (`timelineCensus1890Invariants`,
// issue #3255). Unlike a call-ordered guard, this precondition is a pure
// function of one `timelines[]` entry's final shape, so the replay is a
// document scan rather than a tool_calls walk: for every committed
// research.json-shaped document, run the same function the tool runs against
// every `timelines[]` entry and report any entry that would be refused if
// written today.
//
//   npx tsx dev/replay-timeline-1890-guard.ts [--verbose]
//
// Corpus: the four trees this spec's other document-level rows use —
//   - eval/fixtures/scenarios/<scenario>/research.json
//   - eval/tests/e2e/<slug>/starting-research.json
//   - eval/runlogs/e2e/<slug>/run-<ts>.final-research.json
//   - eval/runlogs/_2491-exploratory-quarantine/**/*.final-research.json
// (all four are tracked files; nothing under eval/runlogs/unit carries a
// final-research.json sibling, since a unit run replays its scenario in
// memory and persists no document of its own).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { timelineCensus1890Invariants } from "../src/tools/research-append.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const VERBOSE = process.argv.includes("--verbose");

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, { encoding: "utf-8" }));
}

function walk(dir: string, pred: (name: string) => boolean, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, pred, out);
    else if (pred(name)) out.push(p);
  }
  return out;
}

const files: { source: string; path: string }[] = [];
for (const p of walk(join(REPO, "eval", "fixtures", "scenarios"), (n) => n === "research.json")) {
  files.push({ source: "scenario fixture", path: p });
}
for (const p of walk(join(REPO, "eval", "tests", "e2e"), (n) => n === "starting-research.json")) {
  files.push({ source: "e2e starting document", path: p });
}
for (const p of walk(join(REPO, "eval", "runlogs", "e2e"), (n) => n.endsWith(".final-research.json"))) {
  files.push({ source: "e2e final state", path: p });
}
for (const p of walk(join(REPO, "eval", "runlogs", "_2491-exploratory-quarantine"), (n) =>
  n.endsWith(".final-research.json"),
)) {
  files.push({ source: "exploratory quarantine final state", path: p });
}

let docsScanned = 0;
let docsWithTimelines = 0;
let timelineEntriesScanned = 0;
let timelineEntriesWithGaps = 0;
const refusals: { source: string; path: string; timelineId: string; message: string }[] = [];

for (const { source, path } of files) {
  docsScanned++;
  let doc: any;
  try {
    doc = readJson(path);
  } catch {
    continue;
  }
  const timelines: any[] = Array.isArray(doc?.timelines) ? doc.timelines : [];
  if (timelines.length === 0) continue;
  docsWithTimelines++;
  for (const entry of timelines) {
    timelineEntriesScanned++;
    if (Array.isArray(entry?.gaps) && entry.gaps.length > 0) timelineEntriesWithGaps++;
    const errs = timelineCensus1890Invariants(entry);
    for (const message of errs) {
      refusals.push({ source, path, timelineId: entry?.id ?? "(no id)", message });
    }
  }
}

console.log("US 1890 census backstop (#3255) — corpus replay");
console.log(`corpus root: ${REPO}`);
console.log("");
console.log(`documents scanned:                 ${docsScanned}`);
console.log(`  of which carry ≥1 timeline:       ${docsWithTimelines}`);
console.log(`timeline entries scanned:          ${timelineEntriesScanned}`);
console.log(`  of which carry ≥1 gap:            ${timelineEntriesWithGaps}`);
console.log("");
console.log(`REFUSALS (would be refused if written today): ${refusals.length}`);
for (const r of refusals) {
  console.log(`  [${r.source}] ${r.path}`);
  console.log(`    timeline ${r.timelineId}: ${r.message}`);
}
if (refusals.length === 0) console.log("  (none)");
if (VERBOSE) {
  console.log("");
  console.log("files scanned:");
  for (const { source, path } of files) console.log(`  [${source}] ${path}`);
}
