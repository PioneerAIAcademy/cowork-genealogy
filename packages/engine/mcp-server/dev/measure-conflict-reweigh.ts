// The conflict re-weigh rule over the e2e corpus, per ADR-0011 limit 2: replays
// every e2e run log's research_append conflicts writes in call order and prints
// each one `conflictReweighRefusals` would have refused. Replays the shipped
// function; re-implements only the conflicts section's id assignment and merge.
//
//   npx tsx dev/measure-conflict-reweigh.ts
//
// Reads tracked run logs and any not yet committed beside them. A call counts
// only when it succeeded (its response says ok). The questions and assertions a
// conflict blocks through are read from the run's final research, the closest
// the log keeps to the state at each call; conflicts start from the fixture's
// starting research. Exits 2 when a floor fails: no run log read, or no
// conflicts write replayed, so a broken read cannot pass as a clean zero.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { conflictReweighRefusals } from "../src/tools/research-append.js";
import { bareName, opsOf, readRunLog, repoRoot, responseOf, runLogFiles, toolCalls } from "./runlog-calls.js";

const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" });
const sha = git("rev-parse", "--short=9", "HEAD").trim();
const untracked = git("ls-files", "--others", "--exclude-standard", "eval/runlogs/e2e")
  .split("\n")
  .filter((f) => f.endsWith(".json") && !f.endsWith(".ann.json"));
const files = [...new Set([...runLogFiles("e2e"), ...untracked])]
  .filter((f) => /\/run-[^/]+\.json$/.test(f) && !/\.final-|\.session/.test(f))
  .sort();

function readJson(rel: string): any {
  const p = join(repoRoot, rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/** Whether the call wrote: its parsed response says ok, or a truncated summary opens with it. */
function succeeded(call: any): boolean {
  if (call.is_error === true) return false;
  const r = responseOf(call);
  if (r && typeof r === "object") return r.ok === true;
  return typeof call.response_summary === "string" && /^\[?\{?.{0,40}\\?"ok\\?":\s*true/.test(call.response_summary);
}

const nextId = (conflicts: any[]): string => {
  const n = Math.max(0, ...conflicts.map((c) => Number(/^c_(\d+)$/.exec(c?.id ?? "")?.[1] ?? 0)));
  return `c_${String(n + 1).padStart(3, "0")}`;
};

let logs = 0, writes = 0, refused = 0;
for (const f of files) {
  const log = readJson(f);
  if (!log || !Array.isArray(log.tool_calls)) continue;
  logs += 1;
  const slug = basename(dirname(f));
  const final = readJson(f.replace(/\.json$/, ".final-research.json")) ?? {};
  const start = readJson(`eval/tests/e2e/${slug}/starting-research.json`) ?? {};
  const context = { questions: final.questions ?? [], assertions: final.assertions ?? [] };
  let conflicts: any[] = structuredClone(Array.isArray(start.conflicts) ? start.conflicts : []);
  for (const call of toolCalls(log.tool_calls)) {
    if (bareName(call) !== "research_append" || !succeeded(call)) continue;
    const ops = opsOf(call.args).filter((op: any) => op?.section === "conflicts");
    if (ops.length === 0) continue;
    const before = { ...context, conflicts: structuredClone(conflicts) };
    const after = { ...context, conflicts: structuredClone(conflicts) };
    const applied: { section: string; entryId: string; opIndex: number }[] = [];
    ops.forEach((op: any, opIndex: number) => {
      if (op.op === "append" && op.entry && typeof op.entry === "object") {
        const id = nextId(after.conflicts);
        after.conflicts.push({ ...op.entry, id });
        applied.push({ section: "conflicts", entryId: id, opIndex });
      } else if (op.op === "update" && typeof op.entryId === "string") {
        const c = after.conflicts.find((x: any) => x?.id === op.entryId);
        if (!c) return;
        Object.assign(c, op.fields ?? {});
        applied.push({ section: "conflicts", entryId: op.entryId, opIndex });
      }
    });
    writes += 1;
    for (const r of conflictReweighRefusals(before, after, applied)) {
      refused += 1;
      console.log(`REFUSED ${slug}/${basename(f).slice(4, 23)} op ${r.opIndex}: ${r.message.slice(0, 220)}`);
    }
    conflicts = after.conflicts;
  }
}

console.log(`measured at ${sha}`);
console.log(`e2e run logs read: ${logs}`);
console.log(`successful research_append calls writing conflicts: ${writes}`);
console.log(`  writes the re-weigh rule refuses: ${refused}`);
let floorsFailed = 0;
for (const [ok, what] of [[logs > 0, "no run log was read"], [writes > 0, "no conflicts write was replayed"]] as const) {
  if (!ok) {
    floorsFailed += 1;
    console.log(`  FLOOR FAILED: ${what}`);
  }
}
process.exit(floorsFailed > 0 ? 2 : 0);
