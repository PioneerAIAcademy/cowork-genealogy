// Replay owed findings (docs/plan/conclusion-tree.md Decision 33, issue #3032
// Stage 1b) over every committed e2e final project: how often a completed run
// would have warned on completion, and why.
//
//   npx tsx dev/replay-owed-findings.ts [--verbose]
//
// Reports, over runs whose final research says project.status "completed":
//   - how many carry a blocking item (conclude, hypothesis), by kind;
//   - encode's fire rate over the runs whose summaries carry claims, and how many
//     of those encode items sit on a question already resolved (a join miss there
//     sends the router back to proof-conclusion for a finished question);
//   - the advisory kinds, for scale.
// Exit is always 0: a rate for a human to read, not a gate.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { owedFindings } from "../src/utils/owed-findings.js";

const repo = join(import.meta.dirname, "..", "..", "..", "..");
const root = join(repo, "eval", "runlogs", "e2e");
const verbose = process.argv.includes("--verbose");

let finals = 0;
let completed = 0;
let withBlocking = 0;
let withClaims = 0;
let encodeRuns = 0;
let encodeItems = 0;
let encodeOnResolved = 0;
const blockingByKind = new Map<string, number>();
const advisoryByKind = new Map<string, number>();

for (const slug of readdirSync(root).sort()) {
  const dir = join(root, slug);
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    continue;
  }
  for (const f of files.filter((x) => x.endsWith(".final-research.json")).sort()) {
    finals++;
    const stem = f.slice(0, -".final-research.json".length);
    const research = JSON.parse(readFileSync(join(dir, f), "utf-8"));
    if (research?.project?.status !== "completed") continue;
    completed++;
    const treePath = join(dir, `${stem}.final-tree.gedcomx.json`);
    const tree = existsSync(treePath) ? JSON.parse(readFileSync(treePath, "utf-8")) : null;
    const owed = owedFindings(research, tree);
    const blocking = owed.filter((o) => o.blocksCompletion);
    if (blocking.length > 0) {
      withBlocking++;
      for (const b of blocking) blockingByKind.set(b.kind, (blockingByKind.get(b.kind) ?? 0) + 1);
      if (verbose) console.log(`blocking  ${slug}/${stem}: ${blocking.map((b) => `${b.kind} ${b.ref}`).join("; ")}`);
    }
    for (const o of owed) if (!o.blocksCompletion && o.kind !== "encode") advisoryByKind.set(o.kind, (advisoryByKind.get(o.kind) ?? 0) + 1);
    const hasClaims = (research.proof_summaries ?? []).some((s: any) => Array.isArray(s?.claims) && s.claims.length > 0);
    if (!hasClaims) continue;
    withClaims++;
    const encode = owed.filter((o) => o.kind === "encode");
    if (encode.length > 0) encodeRuns++;
    encodeItems += encode.length;
    const resolved = new Set((research.questions ?? []).filter((q: any) => q?.status === "resolved").map((q: any) => q.id));
    const qOf = new Map((research.proof_summaries ?? []).map((s: any) => [String(s.id), s.question_id]));
    for (const e of encode) {
      if (resolved.has(qOf.get(e.ref.split("/")[0]))) encodeOnResolved++;
      if (verbose) console.log(`encode    ${slug}/${stem}: ${e.ref}`);
    }
  }
}

const fmt = (m: Map<string, number>) => [...m].map(([k, v]) => `${k} ${v}`).join(", ") || "none";
console.log(`final projects: ${finals}; completed: ${completed}`);
console.log(`completed runs carrying a blocking item: ${withBlocking} of ${completed} (${fmt(blockingByKind)})`);
console.log(`completed runs whose summaries carry claims: ${withClaims}; with an encode item: ${encodeRuns}; encode items: ${encodeItems}, ${encodeOnResolved} on a resolved question`);
console.log(`advisory items over completed runs: ${fmt(advisoryByKind)}`);
