// Re-derive the surname-arm figures quoted in guardrail-enforcement-spec.md §9
// ("Options set aside") and in research-append-tool-spec.md's
// core_identifier_conflict row.
//
//   npx tsx dev/measure-surname-arm.ts            # the figures
//   npx tsx dev/measure-surname-arm.ts --pairs    # + the distinct (fixture, person) pairs
//
// UNLIKE every other replay in this directory, there is NO shipped predicate to
// import: the arm was measured and never built, so this script necessarily
// RESTATES the rule rather than exercising it. That is the weakness
// replay-score-gate.ts's header warns about, and it is why the restatement is
// kept to one function (`refused`) with the escape spelled out term by term —
// if the arm is ever built, import its predicate here and delete `refused`.
//
// Corpus selection is `git ls-files`, NOT a filesystem glob. The glob picks up
// eval/runlogs/e2e/*/scratch_*.final-research.json, which .gitignore excludes;
// counting one inflates the totals by a run and ~7 links, which is how the
// 204/5,734 figures in this row's first draft came to disagree with a clean
// clone.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

const trackedFinalResearch = (): string[] =>
  execFileSync("git", ["ls-files", "eval/runlogs/e2e/*.final-research.json"], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 1 << 28,
  })
    .split("\n")
    .filter(Boolean);

/** The drafted arm: a `confident` person_evidence link onto a tree person who
 *  carries more than one distinct surname, unless something accounts for the
 *  second one. Returns null when the link is not even a candidate. */
function refused(pe: any, person: any, marriedIds: Set<string>) {
  if (pe?.confidence !== "confident") return null;
  const names: any[] = person?.names ?? [];
  const surnames = new Set(
    names.map((n) => (n?.surname ?? "").trim().toLowerCase()).filter(Boolean),
  );
  if (surnames.size < 2) return { multi: false, refused: false, arms: [] as string[] };
  const arms: string[] = [];
  if (names.some((n) => n?.type === "MarriedName")) arms.push("MarriedName");
  if ((person?.facts ?? []).some((f: any) => f?.type === "Marriage")) arms.push("Marriage fact");
  if (marriedIds.has(person?.id)) arms.push("Couple+Marriage");
  return { multi: true, refused: arms.length === 0, arms };
}

let runs = 0, confident = 0, multi = 0, refusals = 0;
const armFires = new Map<string, number>();
const pairs = new Map<string, number>();
const runsWithRefusal = new Set<string>();

for (const rel of trackedFinalResearch()) {
  const research = join(ROOT, rel);
  const tree = research.replace(".final-research.json", ".final-tree.gedcomx.json");
  // A research file with no committed tree sibling is reported, not skipped
  // silently -- a silent skip is indistinguishable from a clean scan.
  if (!existsSync(tree)) {
    console.error(`  (no committed tree sibling, skipped: ${rel})`);
    continue;
  }
  runs++;
  const d = readJson(research), t = readJson(tree);
  const persons = new Map<string, any>((t.persons ?? []).map((p: any) => [p.id, p]));
  const marriedIds = new Set<string>();
  for (const r of t.relationships ?? []) {
    if (r?.type !== "Couple") continue;
    if (!(r.facts ?? []).some((f: any) => f?.type === "Marriage")) continue;
    for (const k of ["person1", "person2"]) if (r[k]) marriedIds.add(r[k]);
  }
  // eval/runlogs/e2e/<fixture>/run-*.json -> index 3. Index 2 is the literal
  // "e2e", which collapses every pair into one fixture and reads as a clean
  // scan; it did exactly that twice while this was being written.
  const fixture = rel.split("/")[3];
  for (const pe of d.person_evidence ?? []) {
    const verdict = refused(pe, persons.get(pe?.person_id), marriedIds);
    if (!verdict) continue;
    confident++;
    if (!verdict.multi) continue;
    multi++;
    for (const a of verdict.arms) armFires.set(a, (armFires.get(a) ?? 0) + 1);
    if (!verdict.refused) continue;
    refusals++;
    const key = `${fixture}\t${pe.person_id}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
    runsWithRefusal.add(rel);
  }
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
console.log(`runs (git ls-files)        ${runs}`);
console.log(`confident links            ${confident}`);
console.log(`  on a multi-surname person ${multi}`);
console.log(`  refused after the escape  ${refusals}  (${pct(refusals, confident)} of all confident links)`);
console.log(`runs carrying >=1 refusal  ${runsWithRefusal.size}  (${pct(runsWithRefusal.size, runs)} of runs)`);
console.log(`distinct (fixture, person) ${pairs.size}  across ${new Set([...pairs.keys()].map((k) => k.split("\t")[0])).size} fixtures`);
console.log(`\nescape arms over the ${multi} multi-surname links (they OVERLAP, so they do not sum):`);
for (const [arm, n] of [...armFires].sort((a, b) => b[1] - a[1])) console.log(`  ${arm.padEnd(16)} ${n}`);

if (process.argv.includes("--pairs")) {
  console.log(`\nthe ${pairs.size} distinct (fixture, person) pairs -- the ADR-0011 limit 2 inspection set:`);
  for (const [k, n] of [...pairs].sort((a, b) => b[1] - a[1])) {
    const [fixture, person] = k.split("\t");
    console.log(`  ${String(n).padStart(3)}  ${fixture}  ${person}`);
  }
}
