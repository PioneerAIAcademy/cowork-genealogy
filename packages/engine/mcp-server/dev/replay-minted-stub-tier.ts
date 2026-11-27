// Replay issue #4749's minted-stub tier rule over committed run logs.
//
//   npx tsx dev/replay-minted-stub-tier.ts [--list]
//
// The predicate is the TOOL'S OWN (`mintedStubTierInvariants`), never restated.
// Every live person_evidence link in a run's final state is judged as an append.
// A final state reads optimistic: a stub that later gained a second record's
// ref is no longer minted from the first, so a link written while it was would
// not be counted here.
//
// Two corpora:
//   e2e  — eval/runlogs/e2e/<fixture>/run-*.final-research.json + .final-tree.gedcomx.json,
//          with the fixture's committed starting-tree.gedcomx.json when there is one.
//   unit — every committed eval/runlogs/unit/<suite>/v*.json run, its final state
//          rebuilt from the test's scenario plus the run's recorded file_changes.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mintedStubTierInvariants } from "../src/tools/research-append.js";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const LIST = process.argv.includes("--list");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const idsOf = (tree: any): Set<string> =>
  new Set(((tree?.persons ?? []) as any[]).map((p) => p?.id).filter((id): id is string => typeof id === "string"));

type Hit = { where: string; pe: string; assertion: string; person: string; tier: string; rationale: string };

function judge(where: string, research: any, tree: any, start: Set<string>, hits: Hit[]): number {
  let links = 0;
  for (const pe of (research?.person_evidence ?? []) as any[]) {
    if (!pe || pe.superseded_by) continue;
    links += 1;
    if (mintedStubTierInvariants(pe, research, tree, start, undefined, "assert").length === 0) continue;
    hits.push({
      where,
      pe: pe.id,
      assertion: pe.assertion_id,
      person: pe.person_id,
      tier: pe.confidence,
      rationale: String(pe.rationale ?? "").slice(0, 220),
    });
  }
  return links;
}

/** Apply one file's recorded diff ({section: {added, modified, deleted}}). */
function applyDiff(doc: any, diff: any): void {
  for (const [section, change] of Object.entries<any>(diff ?? {})) {
    if (!Array.isArray(doc[section])) doc[section] = [];
    const list: any[] = doc[section];
    for (const del of change?.deleted ?? []) {
      const i = list.findIndex((e) => e?.id === (del?.id ?? del));
      if (i >= 0) list.splice(i, 1);
    }
    for (const mod of change?.modified ?? []) {
      const e = list.find((x) => x?.id === mod?.id);
      if (!e) continue;
      for (const [field, v] of Object.entries<any>(mod?.changed_fields ?? {})) e[field] = v?.after;
    }
    for (const add of change?.added ?? []) list.push(add);
  }
}

// --- e2e -------------------------------------------------------------------
const e2eHits: Hit[] = [];
let e2eRuns = 0, e2eLinks = 0;
const E2E = join(ROOT, "eval", "runlogs", "e2e");
for (const slug of readdirSync(E2E)) {
  let entries: string[];
  try { entries = readdirSync(join(E2E, slug)); } catch { continue; }
  const startPath = join(ROOT, "eval", "tests", "e2e", slug, "starting-tree.gedcomx.json");
  const start = existsSync(startPath) ? idsOf(readJson(startPath)) : new Set<string>();
  for (const f of entries) {
    if (!f.endsWith(".final-research.json")) continue;
    const treePath = join(E2E, slug, f.replace(".final-research.json", ".final-tree.gedcomx.json"));
    if (!existsSync(treePath)) continue;
    e2eRuns += 1;
    e2eLinks += judge(`e2e ${slug}/${f.replace(".final-research.json", "")}`, readJson(join(E2E, slug, f)), readJson(treePath), start, e2eHits);
  }
}

// --- unit ------------------------------------------------------------------
const unitHits: Hit[] = [];
let unitRuns = 0, unitLinks = 0, unitSkipped = 0;
const UNIT = join(ROOT, "eval", "runlogs", "unit");
const SCEN = join(ROOT, "eval", "fixtures", "scenarios");
for (const suite of readdirSync(UNIT)) {
  let files: string[];
  try { files = readdirSync(join(UNIT, suite)); } catch { continue; }
  for (const f of files) {
    if (!/^v\d+_.*\.json$/.test(f) || f.endsWith(".ann.json")) continue;
    const log = readJson(join(UNIT, suite, f));
    for (const t of (log.tests ?? []) as any[]) {
      const scenario = t.scenario;
      if (typeof scenario !== "string" || !existsSync(join(SCEN, scenario, "research.json"))) {
        unitSkipped += (t.runs ?? []).length;
        continue;
      }
      const startPath = join(SCEN, scenario, "starting-tree.gedcomx.json");
      const start = existsSync(startPath) ? idsOf(readJson(startPath)) : new Set<string>();
      for (const run of (t.runs ?? []) as any[]) {
        const changes = run?.output?.file_changes ?? {};
        if (!changes["research.json"]?.diff?.person_evidence) continue;
        const research = readJson(join(SCEN, scenario, "research.json"));
        const tree = existsSync(join(SCEN, scenario, "tree.gedcomx.json"))
          ? readJson(join(SCEN, scenario, "tree.gedcomx.json"))
          : { persons: [], relationships: [], sources: [] };
        applyDiff(research, changes["research.json"]?.diff);
        applyDiff(tree, changes["tree.gedcomx.json"]?.diff);
        unitRuns += 1;
        unitLinks += judge(`unit ${suite}/${f} ${t.test_id} run ${run.run_index}`, research, tree, start, unitHits);
      }
    }
  }
}

const byTier = (hits: Hit[]) =>
  hits.reduce<Record<string, number>>((m, h) => ((m[h.tier] = (m[h.tier] ?? 0) + 1), m), {});
console.log(`e2e:  ${e2eRuns} final states, ${e2eLinks} live links, ${e2eHits.length} refused ${JSON.stringify(byTier(e2eHits))}`);
console.log(`unit: ${unitRuns} runs that wrote person_evidence, ${unitLinks} live links, ${unitHits.length} refused ${JSON.stringify(byTier(unitHits))}; ${unitSkipped} runs skipped (no scenario)`);
const groups = new Map<string, number>();
for (const h of [...e2eHits, ...unitHits]) {
  const key = h.where.replace(/ run \d+$/, "").replace(/^(unit \S+)\/v[^ ]+ (\S+)$/, "$1 $2").replace(/^(e2e [^/]+)\/.*$/, "$1");
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
for (const [k, n] of [...groups.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${k}`);
if (LIST) for (const h of [...e2eHits, ...unitHits]) console.log(`\n${h.where} ${h.pe} ${h.assertion}->${h.person} ${h.tier}\n  ${h.rationale}`);
