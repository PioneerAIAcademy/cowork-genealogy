// Re-derive the core-identifier gate's refusal figures over the committed
// corpus, and count the two shapes issue #2537 left open on it.
//
//   npx tsx dev/measure-core-identifier-gate.ts
//
// The gate is the TOOL'S OWN `coreIdentifierContradictionInvariants`, imported,
// never restated. Reads every eval/runlogs/e2e/<fixture>/run-*.final-research.json
// with its .final-tree.gedcomx.json sibling, and every
// eval/fixtures/scenarios/<name>/research.json with its tree.gedcomx.json.
//
// Two counts beside the refusals:
//   - mixed persona keys: a record whose assertions for one `record_role` carry a
//     `record_persona_id` on some and not on others, so the per-assertion
//     fallback splits one party into two keys;
//   - refusals whose only contradicting assertion lost a RESOLVED conflict
//     (it is in `competing_assertion_ids` and is not `preferred_assertion_id`).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { coreIdentifierContradictionInvariants } from "../src/tools/research-append.js";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));

const pairs: { label: string; research: string; tree: string }[] = [];
const RUNS = join(ROOT, "eval", "runlogs", "e2e");
for (const slug of readdirSync(RUNS)) {
  let entries: string[];
  try { entries = readdirSync(join(RUNS, slug)); } catch { continue; }
  for (const f of entries) {
    if (!f.endsWith(".final-research.json")) continue;
    const tree = join(RUNS, slug, f.replace(".final-research.json", ".final-tree.gedcomx.json"));
    if (existsSync(tree)) pairs.push({ label: `e2e/${slug}/${f}`, research: join(RUNS, slug, f), tree });
  }
}
const SCEN = join(ROOT, "eval", "fixtures", "scenarios");
for (const name of readdirSync(SCEN)) {
  const research = join(SCEN, name, "research.json");
  const tree = join(SCEN, name, "tree.gedcomx.json");
  if (existsSync(research) && existsSync(tree)) pairs.push({ label: `scenario/${name}`, research, tree });
}

let docs = 0, links = 0, refused = 0, refusedLostConflict = 0;
let mixedRecords = 0, sharedPid = 0;
const sharedExamples: string[] = [];
const mixedExamples: string[] = [];
const lostExamples: string[] = [];

for (const p of pairs) {
  let research: any, tree: any;
  try { research = readJson(p.research); tree = readJson(p.tree); } catch { continue; }
  docs += 1;
  const assertions: any[] = Array.isArray(research.assertions) ? research.assertions : [];

  const byRecordRole = new Map<string, { withPid: number; without: number }>();
  for (const a of assertions) {
    const rec = a?.record_id ?? a?.source_id;
    if (typeof rec !== "string" || typeof a?.record_role !== "string") continue;
    const k = `${rec}\u0000${a.record_role}`;
    const c = byRecordRole.get(k) ?? { withPid: 0, without: 0 };
    if (typeof a.record_persona_id === "string" && a.record_persona_id !== "") c.withPid += 1;
    else c.without += 1;
    byRecordRole.set(k, c);
  }
  const rolesByPid = new Map<string, Set<string>>();
  for (const a of assertions) {
    const rec = a?.record_id ?? a?.source_id;
    if (typeof rec !== "string" || typeof a?.record_persona_id !== "string" || a.record_persona_id === "") continue;
    const k = `${rec}\u0000${a.record_persona_id}`;
    const roles = rolesByPid.get(k) ?? new Set<string>();
    if (a.record_role !== "absent") roles.add(String(a.record_role));
    rolesByPid.set(k, roles);
  }
  for (const [k, roles] of rolesByPid) {
    if (roles.size > 1) {
      sharedPid += 1;
      if (sharedExamples.length < 8) sharedExamples.push(`${p.label} ${k.replace("\u0000", " pid=")} roles=${[...roles].join("|")}`);
    }
  }
  for (const [k, c] of byRecordRole) {
    if (c.withPid > 0 && c.without > 0) {
      mixedRecords += 1;
      if (mixedExamples.length < 8) mixedExamples.push(`${p.label} ${k.replace("\u0000", " role=")}`);
    }
  }

  const lost = new Set<string>();
  for (const c of (research.conflicts ?? []) as any[]) {
    if (c?.status !== "resolved" || typeof c.preferred_assertion_id !== "string") continue;
    for (const id of (c.competing_assertion_ids ?? []) as string[]) {
      if (id !== c.preferred_assertion_id) lost.add(id);
    }
  }

  const live = ((research.person_evidence ?? []) as any[]).filter((e) => e && !e.superseded_by);
  const personLinks = live
    .filter((e) => typeof e.assertion_id === "string" && typeof e.person_id === "string")
    .map((e) => ({ assertion_id: e.assertion_id, person_id: e.person_id }));
  for (const e of live) {
    if (e.confidence !== "confident" && e.confidence !== "probable") continue;
    links += 1;
    const errs = coreIdentifierContradictionInvariants(e, research, tree, personLinks);
    if (errs.length === 0) continue;
    refused += 1;
    const cited = [...errs.join(" ").matchAll(/assertion '([^']+)'/g)].map((m) => m[1]);
    if (cited.length > 0 && cited.every((id) => lost.has(id))) {
      refusedLostConflict += 1;
      if (lostExamples.length < 8) lostExamples.push(`${p.label} ${e.id} -> ${cited.join(",")}`);
    }
  }
}

console.log(`documents read                         : ${docs}`);
console.log(`confident/probable links               : ${links}`);
console.log(`  refused by the gate                  : ${refused}`);
console.log(`  refused only on a resolved-and-lost  : ${refusedLostConflict}`);
console.log(`record+role groups with mixed persona  : ${mixedRecords}`);
console.log(`persona ids spanning >1 role in a record : ${sharedPid}`);
for (const x of sharedExamples) console.log(`    ${x}`);
for (const x of mixedExamples) console.log(`    ${x}`);
for (const x of lostExamples) console.log(`    lost: ${x}`);
