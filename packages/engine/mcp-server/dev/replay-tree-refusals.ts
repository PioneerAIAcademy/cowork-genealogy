// Replay the committed corpus against the three refusals Stage 1a adds to the
// tree writers (issue #3032), per ADR-0011 limit 2: a precondition records how
// often it fires over the corpus and confirms each fire is a true positive,
// rather than only that it did not fire on one scratch run.
//
//   npx tsx dev/replay-tree-refusals.ts [--verbose]
//
// Three arms, one per refusal:
//
//   couple-event  an add_fact / update_fact / add_person inline fact that puts
//                 a couple event on a PERSON. Uses the shipped
//                 `isCoupleEventFactType`, never a local copy of the rule.
//   self-couple   an add_relationship joining a person to themselves.
//   shared-remove an unscoped `remove {factId}` of an id more than one holder
//                 carries. Needs tree state, so it resolves the fixture's
//                 starting tree; ops whose tree cannot be resolved are counted
//                 separately rather than silently passed.
//
// Exit is always 0: this reports a rate for a human to read, it is not a gate.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isCoupleEventFactType } from "../src/utils/record-persona.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const RUNLOGS = [join(REPO, "eval", "runlogs", "unit"), join(REPO, "eval", "runlogs", "e2e")];
const E2E_FIXTURES = join(REPO, "eval", "tests", "e2e");
const VERBOSE = process.argv.includes("--verbose");

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function walkJsonFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkJsonFiles(full, out);
    else if (entry.endsWith(".json")) out.push(full);
  }
  return out;
}

/** Every recorded tool call in a run log, in order. Shared shape with
 *  `callsOf` in replay-capture-pending-guard.ts. */
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

/** The ops of one tree_edit / tree_correct call: the batched `ops` array, or
 *  the flat single-op form. */
function opsOf(args: any): any[] {
  if (!args || typeof args !== "object") return [];
  if (Array.isArray(args.ops)) return args.ops.filter((o: any) => o && typeof o === "object");
  return args.operation ? [args] : [];
}

type Fire = { run: string; detail: string };
const coupleEvent: Fire[] = [];
const selfCouple: Fire[] = [];
const sharedRemove: Fire[] = [];
let removeFactOps = 0;
let removeUnresolved = 0;

/** The starting tree of the e2e fixture a run log belongs to, or null. */
function startingTree(logPath: string): any {
  const m = /runlogs[\/\\]e2e[\/\\]([^\/\\]+)/.exec(logPath);
  if (!m) return null;
  return readJson(join(E2E_FIXTURES, m[1], "starting-tree.gedcomx.json"));
}

function holdersOf(tree: any, factId: string): string[] {
  const out: string[] = [];
  for (const p of tree?.persons ?? []) {
    if ((p.facts ?? []).some((f: any) => f?.id === factId)) out.push(`person '${p.id}'`);
  }
  for (const r of tree?.relationships ?? []) {
    if ((r.facts ?? []).some((f: any) => f?.id === factId)) out.push(`relationship '${r.id}'`);
  }
  return out;
}

for (const root of RUNLOGS) {
  for (const path of walkJsonFiles(root)) {
    const log = readJson(path);
    if (!log) continue;
    const run = path.slice(REPO.length + 1);
    for (const call of callsOf(log)) {
      const tool = bare(String(call.tool ?? call.name ?? ""));
      if (tool !== "tree_edit" && tool !== "tree_correct") continue;
      for (const op of opsOf(call.args ?? call.input ?? {})) {
        // ── arm 1: a couple event on a person ──────────────────────────────
        if (op.operation === "add_fact" && op.personId && isCoupleEventFactType(op.fact?.type)) {
          coupleEvent.push({ run, detail: `add_fact ${op.fact.type} on person '${op.personId}'` });
        }
        if (op.operation === "update_fact" && op.personId && isCoupleEventFactType(op.fact?.type)) {
          // Decision 24 admits editing one already there; the replay cannot see
          // the existing fact's type, so this is reported as a CANDIDATE.
          coupleEvent.push({
            run,
            detail: `update_fact -> ${op.fact.type} on person '${op.personId}' (candidate: admitted if already a couple event)`,
          });
        }
        if (op.operation === "add_person") {
          for (const f of op.person?.facts ?? []) {
            if (isCoupleEventFactType(f?.type)) {
              coupleEvent.push({ run, detail: `add_person inline ${f.type}` });
            }
          }
        }
        // ── arm 2: a Couple joining someone to themselves ──────────────────
        if (
          op.operation === "add_relationship" &&
          op.relationship?.type === "Couple" &&
          op.relationship?.person1 &&
          op.relationship.person1 === op.relationship.person2
        ) {
          selfCouple.push({ run, detail: `add_relationship Couple '${op.relationship.person1}' to itself` });
        }
        // ── arm 3: an unscoped remove of a shared fact id ──────────────────
        if (op.operation === "remove" && op.factId) {
          removeFactOps++;
          if (op.personId || op.relationshipId) continue; // already scoped
          const tree = startingTree(path);
          if (!tree) {
            removeUnresolved++;
            continue;
          }
          const holders = holdersOf(tree, op.factId);
          if (holders.length > 1) {
            sharedRemove.push({ run, detail: `remove '${op.factId}' held by ${holders.length}: ${holders.join(", ")}` });
          }
        }
      }
    }
  }
}

function report(name: string, fires: Fire[]) {
  const runs = new Set(fires.map((f) => f.run));
  console.log(`\n${name}: ${fires.length} fire(s) across ${runs.size} run(s)`);
  if (fires.length && VERBOSE) for (const f of fires) console.log(`    ${f.run}\n      ${f.detail}`);
  else if (fires.length) {
    for (const f of fires.slice(0, 10)) console.log(`    ${f.detail}  [${f.run}]`);
    if (fires.length > 10) console.log(`    ... ${fires.length - 10} more (--verbose for all)`);
  }
}

console.log("Replaying Stage 1a's tree-writer refusals over the committed corpus.");
report("couple-event on a person", coupleEvent);
report("self-Couple", selfCouple);
report("unscoped remove of a shared fact id", sharedRemove);
console.log(`\n  remove {factId} ops seen: ${removeFactOps}`);
if (removeUnresolved) console.log(`  (${removeUnresolved} unscoped, starting tree not resolvable — not counted either way)`);
console.log("\nEach fire above needs reading as a true positive before the refusal ships.");
