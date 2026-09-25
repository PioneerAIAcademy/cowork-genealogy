/**
 * Measure: how often `research_log_append`'s pre-1880 census check refuses,
 * over every note the committed run logs carry.
 *
 * The figures in docs/specs/research-log-editor-spec.md § 8.2 and in
 * `censusMentions`'s docstring come from this script. Re-run it rather than
 * quoting them: a re-run of a skill REPLACES its run log, so the corpus moves
 * in both directions.
 *
 * Reads every tracked `eval/runlogs/**\/*.json` except `.ann.json` and walks it
 * for tool calls (`{ tool, args }`), then reports two populations:
 *
 *   1. NOTE-ONLY — every distinct `notes` string passed to research_log_append
 *      (plain and `ops[]` form), judged as a note alone. This is the § 8.2 rate.
 *   2. PAYLOAD — every record_search op that logged a staged handle with a note,
 *      paired to the record_search call whose response staged that handle, and
 *      judged with the census years its rows name. Unit run logs keep the
 *      response as an object; e2e run logs keep only `response_summary`, a JSON
 *      string that is sometimes truncated. Unpaired ops are counted, not guessed.
 *      Titles come from the inline `collections` map when present (the inline
 *      compaction hoists `collectionTitle` there, and it survives a truncated
 *      summary), else from each row's own `collectionTitle`.
 *
 * Optional baseline, to list what a change newly refuses or frees:
 *   git show <ref>:packages/engine/mcp-server/src/tools/research-log-append.ts \
 *     > src/tools/research-log-append.baseline.ts
 *   npx tsx dev/measure-census-hedge-refusals.ts --baseline src/tools/research-log-append.baseline.ts
 * The copy must sit in src/tools/ so its relative imports resolve. Delete it
 * afterwards. A baseline without `stagedPre1880UsCensusYears` is judged note-only.
 *
 * Offline; no FamilySearch session needed. Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/measure-census-hedge-refusals.ts [--baseline <module>] [--list]
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as current from "../src/tools/research-log-append.js";
import { bareName, opsOf, readRunLog, repoRoot, responseOf, runLogFiles, toolCalls } from "./runlog-calls.js";

type Gate = {
  requirePre1880CensusHedge: (notes: string, years?: readonly number[]) => void;
  stagedPre1880UsCensusYears?: (rows: readonly unknown[]) => number[];
};

const argv = process.argv.slice(2);
const baselinePath = argv.includes("--baseline") ? argv[argv.indexOf("--baseline") + 1] : undefined;
const list = argv.includes("--list");
if (argv.includes("--baseline") && (!baselinePath || baselinePath.startsWith("--"))) {
  console.error("usage: npx tsx dev/measure-census-hedge-refusals.ts [--baseline <module>] [--list]");
  process.exit(2);
}

const refuses = (gate: Gate, notes: string, rows?: unknown[]): boolean => {
  const years = rows && gate.stagedPre1880UsCensusYears ? gate.stagedPre1880UsCensusYears(rows) : undefined;
  try {
    gate.requirePre1880CensusHedge(notes, years);
    return false;
  } catch {
    return true;
  }
};

const files = runLogFiles();

const notes = new Set<string>();
const payloadOps: { notes: string; ref: string }[] = [];
const stagedRows = new Map<string, unknown[]>();

for (const f of files) {
  const doc = readRunLog(f);
  if (doc === undefined) continue;
  for (const call of toolCalls(doc)) {
    const name = bareName(call);
    if (name === "record_search") {
      const r = responseOf(call);
      const ref = r?.staged?.resultsRef;
      if (typeof ref !== "string") continue;
      // The inline `collections` map names every collection in `results`, and
      // "every titled row" only needs the distinct titles, so it stands in for
      // rows an e2e summary truncated (`results: { _summary_truncated, ... }`).
      if (r.collections && typeof r.collections === "object") {
        stagedRows.set(ref, Object.values(r.collections).map((t) => ({ collectionTitle: t })));
      } else if (Array.isArray(r.results)) {
        stagedRows.set(ref, r.results.map((row: any) => ({ collectionTitle: row?.collectionTitle })));
      }
    } else if (name === "research_log_append") {
      for (const op of opsOf(call.args)) {
        if (typeof op?.notes !== "string") continue;
        notes.add(op.notes);
        if (op.tool === "record_search" && typeof op.stagedResultsRef === "string") {
          payloadOps.push({ notes: op.notes, ref: op.stagedResultsRef });
        }
      }
    }
  }
}

const baseline: Gate | undefined = baselinePath
  ? await import(pathToFileURL(resolve(baselinePath)).href)
  : undefined;
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const head = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "eval/runlogs"], { cwd: repoRoot, encoding: "utf-8" }).trim();

console.log(`HEAD ${head}${dirty ? " (eval/runlogs has uncommitted changes)" : ""}; ${files.length} run-log files`);

const noteList = [...notes];
const noteRefused = noteList.filter((n) => refuses(current, n));
console.log(`\nNOTE-ONLY: ${noteRefused.length} of ${noteList.length} distinct notes refused (${pct(noteRefused.length, noteList.length)})`);

const paired = payloadOps.filter((o) => stagedRows.has(o.ref));
const payloadRefused = paired.filter((o) => refuses(current, o.notes, stagedRows.get(o.ref)));
const byPayloadOnly = payloadRefused.filter((o) => !refuses(current, o.notes));
console.log(
  `\nPAYLOAD: ${payloadOps.length} staged record_search ops with a note; ${paired.length} paired, ` +
    `${payloadOps.length - paired.length} unpaired`,
);
console.log(`  refused with the payload: ${payloadRefused.length} of ${paired.length} paired (${pct(payloadRefused.length, paired.length)})`);
console.log(`  refused ONLY because of the payload: ${byPayloadOnly.length}`);
if (list) for (const o of byPayloadOnly) console.log(`    - ${o.notes}`);

if (baseline) {
  const was = (n: string, rows?: unknown[]) => refuses(baseline, n, rows);
  const newlyRefused = noteList.filter((n) => !was(n) && refuses(current, n));
  const newlyFreed = noteList.filter((n) => was(n) && !refuses(current, n));
  console.log(`\nVS BASELINE (note-only): ${newlyRefused.length} newly refused, ${newlyFreed.length} newly freed`);
  const payNewlyRefused = paired.filter((o) => !was(o.notes, stagedRows.get(o.ref)) && refuses(current, o.notes, stagedRows.get(o.ref)));
  const payNewlyFreed = paired.filter((o) => was(o.notes, stagedRows.get(o.ref)) && !refuses(current, o.notes, stagedRows.get(o.ref)));
  console.log(`VS BASELINE (paired payload ops): ${payNewlyRefused.length} newly refused, ${payNewlyFreed.length} newly freed`);
  if (list) {
    for (const n of newlyRefused) console.log(`  + refused: ${n}`);
    for (const n of newlyFreed) console.log(`  - freed:   ${n}`);
    for (const o of payNewlyRefused) console.log(`  + refused (payload): ${o.notes}`);
    for (const o of payNewlyFreed) console.log(`  - freed (payload):   ${o.notes}`);
  }
}
