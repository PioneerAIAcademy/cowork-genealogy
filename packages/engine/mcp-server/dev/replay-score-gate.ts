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
import { isTwoParty, personaRolesById } from "../src/utils/record-persona.js";
import { toArk } from "../src/utils/ark.js";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const RUNS = join(ROOT, "eval", "runlogs", "e2e");
const FIX = join(ROOT, "eval", "tests", "e2e");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

let files = 0, links = 0, noRecord = 0, circular = 0, circularScored = 0;
let unreachable = 0, reachable = 0, noBaseline = 0, unreachableScored = 0;
let personaLinks = 0, scoresBefore = 0, scoresAfter = 0;

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
    // #3552: the roles each record gives each persona id, grouped as the gate
    // groups them (canonical ARK, `sameRecord`).
    const recordKey = (id: string) => toArk(id).toLowerCase();
    const byRecord = new Map<string, any[]>();
    for (const a of (research.assertions ?? []) as any[]) {
      if (typeof a?.record_id !== "string") continue;
      const k = recordKey(a.record_id);
      byRecord.set(k, [...(byRecord.get(k) ?? []), a]);
    }
    const rolesByRecord = new Map<string, Map<string, Set<string>>>();
    for (const [k, as] of byRecord) rolesByRecord.set(k, personaRolesById(as));
    const callsBefore = new Set<string>();
    const callsAfter = new Set<string>();
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
      if (personaReachable(e, research)) {
        reachable += 1;
        const pid = a?.record_persona_id;
        const roles = typeof pid === "string" && pid !== "" ? rolesByRecord.get(recordKey(recordId))?.get(pid) : undefined;
        callsBefore.add(`${e.assertion_id}|${e.person_id}`);
        if (roles?.size === 1 && !isTwoParty(a?.fact_type)) {
          personaLinks += 1;
          callsAfter.add(`${recordKey(recordId)}|${pid}|${e.person_id}`);
        } else {
          callsAfter.add(`${e.assertion_id}|${e.person_id}`);
        }
        continue;
      }
      unreachable += 1;
      // Reachability excuses a MISSING score, not a fabricated one: an
      // unreachable link that CARRIES a number still needs an attestation.
      if (e.match_score !== null && e.match_score !== undefined) unreachableScored += 1;
    }
    scoresBefore += callsBefore.size;
    scoresAfter += callsAfter.size;
  }
}

console.log(`runs read                          : ${files}   (fixtures with no starting-tree baseline: ${noBaseline})`);
console.log(`person_evidence links              : ${links}`);
console.log(`  no record side                   : ${noRecord}`);
console.log(`  circular-exempt                  : ${circular}   (carrying a score, so refused: ${circularScored})`);
console.log(`  unreachable                      : ${unreachable}   (carrying a score, so still refused: ${unreachableScored})`);
console.log(`  reachable, needs an attestation  : ${reachable}`);
console.log(`    on a single-party persona id    : ${personaLinks}`);
console.log(`same_person scores the gate needs (one per project and pairing):`);
console.log(`  keyed on (assertion, person)     : ${scoresBefore}`);
console.log(`  persona arm (#3552)              : ${scoresAfter}`);
