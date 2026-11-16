// Replay the committed e2e corpus against merge_warnings' hasSameCensus (issue
// #4503): every `[treeId, candidateId]` pair of every committed merge_warnings
// call, judged by the pre-#4503 rule and by the shipped one, each pair whose
// result changed printed for inspection.
//
//   npx tsx dev/replay-same-census.ts [--verbose]
//
// The tree is the run's fixture starting tree, run through sanitizeTree; the
// candidate is the call's candidateGedcomx, run through sanitizeCandidate — both
// as the tool does. The starting tree stands in for the tree at call time, so a
// census source a run added before the call is missing, and a pair whose tree
// person the run created is counted and not judged.
//
//   old   the pre-#4503 rule, copied here: whole census titles compared with
//         `===`, each side's titles drawn from the anchor's source refs or, when
//         it has none, from every source in its document.
//   new   the shipped `hasSameCensus`.
//
// A pair that stops firing is tagged with why: its tree person cites no source
// (the tree side lost the every-source fallback), or every matching tree source
// is the paired persona's ark or the record's ark.
//
// Exit is 0: this reports changes for a human to read and is not a gate.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SimplifiedGedcomX } from "../src/types/gedcomx.js";
import { hasSameCensus } from "../src/tools/person-warnings.js";
import { sanitizeCandidate } from "../src/tools/merge-shared.js";
import { sanitizeTree } from "../src/validation/tree-sanitize.js";
import { Mob } from "../src/utils/mob.js";
import { toArk } from "../src/utils/ark.js";
import { bareName, readRunLog, repoRoot, runLogFiles, toolCalls } from "./runlog-calls.js";

const VERBOSE = process.argv.includes("--verbose");

interface CensusSource {
  title: string;
  url?: string;
}

/** The anchor's census sources: its refs' sources, else (none) every source. */
function oldCensusSources(mob: Mob): CensusSource[] {
  const sources = mob.tree.sources ?? [];
  const person = mob.getPerson();
  const refIds = new Set<string>();
  for (const r of person.sources ?? []) if (r.ref !== undefined) refIds.add(r.ref);
  for (const f of person.facts ?? []) for (const r of f.sources ?? []) if (r.ref !== undefined) refIds.add(r.ref);
  for (const n of person.names ?? []) for (const r of n.sources ?? []) if (r.ref !== undefined) refIds.add(r.ref);
  const pickAll = refIds.size === 0;
  const out: CensusSource[] = [];
  for (const s of sources) {
    if (s.title === undefined) continue;
    if (pickAll || (s.id !== undefined && refIds.has(s.id))) out.push({ title: s.title, url: s.url });
  }
  return out.filter((s) => s.title.includes("Census"));
}

/** Pre-#4503 hasSameCensus: exact title equality. */
function oldHasSameCensus(target: Mob, candidate: Mob): boolean {
  const a = oldCensusSources(target);
  const b = oldCensusSources(candidate);
  return a.some((x) => b.some((y) => x.title === y.title));
}

function personHasRefs(mob: Mob): boolean {
  const p = mob.getPerson();
  return (
    (p.sources ?? []).some((r) => r.ref !== undefined) ||
    (p.facts ?? []).some((f) => (f.sources ?? []).some((r) => r.ref !== undefined)) ||
    (p.names ?? []).some((n) => (n.sources ?? []).some((r) => r.ref !== undefined))
  );
}

function whyStopped(target: Mob, candidate: Mob): string {
  if (!personHasRefs(target)) return "target unsourced (fallback removed)";
  const persona = candidate.getPerson().ark;
  const skip = new Set<string>();
  if (persona) skip.add(toArk(persona));
  for (const s of oldCensusSources(candidate)) {
    if (s.url && toArk(s.url).startsWith("ark:/61903/1:2:")) skip.add(toArk(s.url));
  }
  const hit = oldCensusSources(target).filter((s) => s.url && skip.has(toArk(s.url)));
  return hit.length > 0 ? `skipped: url = persona ark / record ark (${hit.map((s) => s.url).join(", ")})` : "other";
}

const describe = (mob: Mob, label: string): string[] => [
  `    ${label} ${mob.anchorId}  ark=${mob.getPerson().ark ?? "-"}  refs=${personHasRefs(mob) ? "yes" : "no"}`,
  ...oldCensusSources(mob).map((s) => `      ${s.title}  <${s.url ?? "no url"}>`),
];

const slugOf = (file: string): string => file.split("/").slice(-2, -1)[0];
const treeCache = new Map<string, SimplifiedGedcomX | null>();
function startingTree(slug: string): SimplifiedGedcomX | null {
  if (!treeCache.has(slug)) {
    const p = join(repoRoot, "eval/tests/e2e", slug, "starting-tree.gedcomx.json");
    treeCache.set(slug, existsSync(p) ? sanitizeTree(JSON.parse(readFileSync(p, "utf-8"))).tree : null);
  }
  return treeCache.get(slug)!;
}

let calls = 0;
let judged = 0;
let notInTree = 0;
let unparsed = 0;
let targetCites = 0;
let targetUnsourced = 0;
const tally = { bothTrue: 0, bothFalse: 0, newlyFiring: 0, newlyNotFiring: 0 };
const changed: string[] = [];

for (const file of runLogFiles("e2e")) {
  if (/\.final-/.test(file)) continue;
  for (const call of toolCalls(readRunLog(file))) {
    if (bareName(call) !== "merge_warnings") continue;
    calls++;
    const tree = startingTree(slugOf(file));
    let raw = call.args.candidateGedcomx;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = undefined;
      }
    }
    const merges = call.args.merges;
    if (!tree || !raw || typeof raw !== "object" || !Array.isArray(merges)) {
      unparsed++;
      continue;
    }
    const candidate = sanitizeCandidate(structuredClone(raw)).candidate as SimplifiedGedcomX;
    for (const pair of merges) {
      const [treeId, candidateId] = pair as [string, string];
      let target: Mob;
      let cand: Mob;
      try {
        target = new Mob(tree, treeId);
      } catch {
        notInTree++;
        continue;
      }
      try {
        cand = new Mob(candidate, candidateId);
      } catch {
        unparsed++;
        continue;
      }
      judged++;
      if (personHasRefs(target) && oldCensusSources(target).length > 0) {
        targetCites++;
        if (VERBOSE) console.log([`  tree cites a census: ${file}`, ...describe(target, "tree"), ...describe(cand, "cand")].join("\n"));
      }
      if (!personHasRefs(target)) targetUnsourced++;
      const before = oldHasSameCensus(target, cand);
      const after = hasSameCensus(target, cand);
      if (before && after) tally.bothTrue++;
      else if (!before && !after) tally.bothFalse++;
      else {
        if (after) tally.newlyFiring++;
        else tally.newlyNotFiring++;
        changed.push(
          [
            `${after ? "NEWLY FIRING" : "NEWLY NOT FIRING"}  ${file}  [${treeId}, ${candidateId}]`,
            ...(after ? [] : [`    reason: ${whyStopped(target, cand)}`]),
            ...describe(target, "tree"),
            ...describe(cand, "cand"),
          ].join("\n"),
        );
      }
      if (VERBOSE && (before || after)) console.log(`  ${before}->${after}  ${file}  [${treeId}, ${candidateId}]`);
    }
  }
}

console.log(`merge_warnings calls: ${calls}`);
console.log(`pairs judged: ${judged}  not in starting tree: ${notInTree}  unparsed: ${unparsed}`);
console.log(`of those, tree person cites no source: ${targetUnsourced}  cites a census source: ${targetCites}`);
console.log(
  `unchanged firing: ${tally.bothTrue}  unchanged silent: ${tally.bothFalse}  ` +
    `newly firing: ${tally.newlyFiring}  newly not firing: ${tally.newlyNotFiring}`,
);
for (const c of changed) console.log(`\n${c}`);
