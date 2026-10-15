// Replay the committed corpus against the capture-pending plan-item guard
// (`planItemCapturePendingInvariants`, #1226/#2484), per ADR-0011 limit 2:
// every §5 precondition row records how often the gate fires over the corpus
// and confirms each refusal is a true positive, not just that it did not fire
// on one scratch run.
//
//   npx tsx dev/replay-capture-pending-guard.ts [--verbose]
//
// For every eval/runlogs/{unit,e2e}/<...>/*.json, walks the run's recorded
// writer calls in order and reconstructs, before each call, the two documents
// the guard reads: `log[]` (built from research_log_append entries) and the
// plan items' statuses (from research_append plan_items / plans ops). Seeds
// from the scenario's starting state (unit: eval/fixtures/scenarios/<scenario>;
// e2e: the fixture's starting-research.json) when present. For every op that
// sets a plan item to a terminal status (`skipped`/`completed`), it invokes the
// tool's own exported guard — never re-implemented here — and reports each
// refusal for true-positive inspection.
//
// Ordering is load-bearing: the guard reads the LATEST log entry naming the
// item, so only entries logged in an earlier (or the same) call count. The
// replay applies research_log_append before the research_append ops within one
// call's recorded order.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planItemCapturePendingInvariants } from "../src/tools/research-append.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const UNIT = join(REPO, "eval", "runlogs", "unit");
const E2E = join(REPO, "eval", "runlogs", "e2e");
const SCENARIOS = join(REPO, "eval", "fixtures", "scenarios");
const VERBOSE = process.argv.includes("--verbose");

const TERMINAL = new Set(["skipped", "completed"]);

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function walkRunLogs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkRunLogs(p));
    else if (name.endsWith(".json") && !name.endsWith(".ann.json")) out.push(p);
  }
  return out;
}

// Every recorded tool call in a run log, in order, from the per-test entries.
function callsOf(log: any): any[] {
  const calls: any[] = [];
  const collect = (obj: any) => {
    if (Array.isArray(obj)) obj.forEach(collect);
    else if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        if (k === "tool_calls" && Array.isArray(v)) calls.push(...v.filter((c) => c && typeof c === "object"));
        else collect(v);
      }
    }
  };
  collect(log);
  return calls;
}

const bare = (tool: string) => (tool || "").split("__").pop() || "";

// A deep clone of the seeded plans so the replay's mutations do not leak.
function seedResearch(testScenario: string | undefined, startingResearch: any): { log: any[]; plans: any[] } {
  const src =
    startingResearch ||
    (testScenario ? readJson(join(SCENARIOS, testScenario, "research.json")) : null) ||
    {};
  return {
    log: Array.isArray(src.log) ? JSON.parse(JSON.stringify(src.log)) : [],
    plans: Array.isArray(src.plans) ? JSON.parse(JSON.stringify(src.plans)) : [],
  };
}

interface Refusal {
  file: string;
  planItemId: string;
  status: string;
  message: string;
}

const refusals: Refusal[] = [];
let filesExamined = 0;
let terminalOps = 0;
let runsSeeded = 0;

const files = [...walkRunLogs(UNIT), ...walkRunLogs(E2E)];
for (const file of files) {
  const log = readJson(file);
  if (!log) continue;
  filesExamined++;

  // A run log may carry several tests; each has its own scenario and starting
  // state. Fall back to the envelope-level fields when per-test ones are absent.
  const tests = Array.isArray(log.tests) ? log.tests : [log];
  for (const test of tests) {
    const scenario = test?.input?.scenario ?? log?.input?.scenario;
    // e2e runs carry a starting-research sibling; unit runs seed from the scenario.
    const startingResearch =
      test?.starting_research ?? log?.starting_research ?? null;
    const research = seedResearch(scenario, startingResearch);
    runsSeeded++;

    const calls = callsOf(test);
    for (const call of calls) {
      const tool = bare(call.tool);
      const args = call.args ?? {};

      if (tool === "research_log_append") {
        // Build log[] so the guard can read the latest entry per item.
        const ops = Array.isArray(args.ops) ? args.ops : [args];
        for (const op of ops) {
          if (op && typeof op === "object" && op.tool) {
            research.log.push({
              id: op.resultsRef ? undefined : undefined,
              plan_item_id: op.planItemId ?? null,
              tool: op.tool,
              outcome: op.outcome,
              external_site: op.externalSite
                ? {
                    site: op.externalSite.site,
                    url_generated: op.externalSite.urlGenerated,
                    capture_received: !!op.externalSite.captureReceived,
                  }
                : null,
            });
          }
        }
        continue;
      }

      if (tool !== "research_append") continue;
      const ops = Array.isArray(args.ops) ? args.ops : [args];
      for (const op of ops) {
        if (!op || typeof op !== "object") continue;

        // Collect the (itemObject, priorStatus) pairs this op would write.
        const checks: Array<{ item: any; prior: unknown }> = [];
        if (op.section === "plan_items") {
          const fields = op.fields ?? op.entry ?? {};
          const status = fields.status;
          if (TERMINAL.has(status)) {
            const stored = findItem(research.plans, op.entryId);
            checks.push({ item: { ...(stored ?? {}), id: op.entryId, ...fields }, prior: stored?.status });
          }
          applyPlanItem(research.plans, op);
        } else if (op.section === "plans") {
          const src = op.fields ?? op.entry ?? {};
          const items = Array.isArray(src.items) ? src.items : [];
          const stored = op.op === "update" ? findPlan(research.plans, op.entryId) : null;
          for (const it of items) {
            if (it && typeof it === "object" && TERMINAL.has(it.status)) {
              const prior = stored?.items?.find((x: any) => x && x.id === it.id)?.status;
              checks.push({ item: it, prior });
            }
          }
          applyPlans(research.plans, op);
        }

        for (const { item, prior } of checks) {
          terminalOps++;
          if (prior === item.status) continue; // no status change — guard is gated on it
          const errs = planItemCapturePendingInvariants(item, research);
          for (const message of errs) {
            refusals.push({ file: relative(file), planItemId: item.id ?? "(unknown)", status: item.status, message });
          }
        }
      }
    }
  }
}

function findPlan(plans: any[], id: string): any {
  return plans.find((p) => p && p.id === id);
}
function findItem(plans: any[], itemId: string): any {
  for (const p of plans) for (const it of p?.items ?? []) if (it && it.id === itemId) return it;
  return undefined;
}
function applyPlanItem(plans: any[], op: any): void {
  const planId = op.planId;
  const plan = plans.find((p) => p && p.id === planId);
  if (!plan) return;
  if (!Array.isArray(plan.items)) plan.items = [];
  if (op.op === "append") {
    plan.items.push({ ...(op.entry ?? {}), id: op.entry?.id });
  } else {
    const it = plan.items.find((x: any) => x && x.id === op.entryId);
    if (it) Object.assign(it, op.fields ?? {});
  }
}
function applyPlans(plans: any[], op: any): void {
  if (op.op === "append") {
    plans.push(JSON.parse(JSON.stringify(op.entry ?? {})));
  } else {
    const p = plans.find((x) => x && x.id === op.entryId);
    if (p) Object.assign(p, op.fields ?? {});
  }
}
function relative(p: string): string {
  return p.startsWith(REPO) ? p.slice(REPO.length + 1) : p;
}

console.log(`FILES EXAMINED: ${filesExamined}`);
console.log(`RUNS SEEDED:    ${runsSeeded}`);
console.log(`TERMINAL PLAN-ITEM OPS: ${terminalOps}`);
console.log(`REFUSALS: ${refusals.length}`);
if (refusals.length) {
  console.log("");
  for (const r of refusals) {
    console.log(`  ${r.file}`);
    console.log(`    ${r.planItemId} -> ${r.status}`);
    if (VERBOSE) console.log(`      ${r.message}`);
  }
}
