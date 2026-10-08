/**
 * Measure: what `research_append`'s unpersisted-conflict-resolution precondition
 * would refuse, over every committed e2e final state — and whether it agrees with
 * its harness twin.
 *
 * For each tracked `eval/runlogs/e2e/<slug>/run-<ts>.final-research.json`, judges
 * every proof summary in it as if it were the entry being written, with the real
 * `unpersistedConflictResolutionInvariants`. Compare the printed set with the
 * harness replay (`make e2e-guardrail-shadow REPLAY=1 SINCE=all`, the
 * conflict-unpersisted row): the two must name the same runs, summaries and
 * questions. Re-run rather than quote; committed runs move the count.
 *
 * Offline; reads committed files only. Not shipped in any artifact.
 *
 * Usage: npx tsx dev/measure-unpersisted-conflict-guard.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unpersistedConflictResolutionInvariants } from "../src/tools/research-append.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const files = execFileSync("git", ["ls-files", "eval/runlogs/e2e"], { cwd: repoRoot, encoding: "utf-8" })
  .split("\n")
  .filter((f) => f.endsWith(".final-research.json"));

const fires: string[] = [];
const runs = new Set<string>();
let unreadable = 0;
for (const f of files) {
  let research: any;
  try {
    research = JSON.parse(readFileSync(join(repoRoot, f), "utf-8"));
  } catch {
    unreadable++;
    continue;
  }
  for (const ps of Array.isArray(research?.proof_summaries) ? research.proof_summaries : []) {
    if (unpersistedConflictResolutionInvariants(ps, research).length > 0) {
      fires.push(`${f.replace("eval/runlogs/e2e/", "")} ${ps.id} ${ps.question_id} tier=${ps.tier}`);
      runs.add(f);
    }
  }
}
const head = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();
console.log(`HEAD ${head}; ${files.length} final states${unreadable ? `, ${unreadable} unreadable` : ""}`);
console.log(`refused: ${fires.length} summaries across ${runs.size} runs`);
for (const line of fires) console.log(`  ${line}`);
