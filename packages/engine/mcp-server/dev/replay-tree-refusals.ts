// Replay the committed corpus against the three refusals Stage 1a adds to the
// tree writers (issue #3032), per ADR-0011 limit 2: a precondition records how
// often it fires over the corpus and confirms each fire is a true positive,
// rather than only that it did not fire on one scratch run. Limit 2 also asks
// how often agents already produce the call shape that satisfies the refusal,
// so the couple-event arm counts the Couple-edge route alongside its fires.
//
//   npx tsx dev/replay-tree-refusals.ts [--verbose]
//
// Three arms, one per refusal:
//
//   couple-event  an add_fact / add_person inline fact that puts a couple event
//                 on a PERSON. Uses the shipped `isCoupleEventFactType`, never a
//                 local copy of the rule. An update_fact retyping a person's
//                 fact into one is listed apart as a candidate: the replay
//                 cannot see the existing fact's type, and editing a fact that
//                 is already a couple event is admitted.
//   self-couple   an add_relationship joining a person to themselves.
//   shared-remove an unscoped `remove {factId}` of an id more than one holder
//                 carries. Needs tree state, so it resolves the fixture's
//                 starting tree; ops whose tree cannot be resolved are counted
//                 separately rather than silently passed.
//
// Exit is always 0: this reports a rate for a human to read, it is not a gate.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCoupleEventFactType } from "../src/utils/record-persona.js";
import { bareName, opsOf, readRunLog, repoRoot, runLogFiles, toolCalls } from "./runlog-calls.js";

const E2E_FIXTURES = join(repoRoot, "eval", "tests", "e2e");
const VERBOSE = process.argv.includes("--verbose");

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

type Fire = { run: string; detail: string };
const coupleEvent: Fire[] = [];
const coupleEventCandidates: Fire[] = [];
const coupleRoute: Fire[] = [];
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

for (const run of [...runLogFiles("unit"), ...runLogFiles("e2e")]) {
  const log = readRunLog(run);
  if (!log) continue;
  for (const call of toolCalls(log)) {
    const tool = bareName(call);
    if (tool !== "tree_edit" && tool !== "tree_correct") continue;
    for (const op of opsOf(call.args)) {
      if (!op || typeof op !== "object" || !op.operation) continue;
      // ── arm 1: a couple event on a person ──────────────────────────────
      if (op.operation === "add_fact" && isCoupleEventFactType(op.fact?.type)) {
        if (op.personId) coupleEvent.push({ run, detail: `add_fact ${op.fact.type} on person '${op.personId}'` });
        else if (op.relationshipId) {
          coupleRoute.push({ run, detail: `add_fact ${op.fact.type} on relationship '${op.relationshipId}'` });
        }
      }
      if (op.operation === "update_fact" && op.personId && isCoupleEventFactType(op.fact?.type)) {
        coupleEventCandidates.push({ run, detail: `update_fact -> ${op.fact.type} on person '${op.personId}'` });
      }
      if (op.operation === "add_person") {
        for (const f of op.person?.facts ?? []) {
          if (isCoupleEventFactType(f?.type)) coupleEvent.push({ run, detail: `add_person inline ${f.type}` });
        }
      }
      if (op.operation === "add_relationship" && op.relationship?.type === "Couple") {
        for (const f of op.relationship.facts ?? []) {
          if (isCoupleEventFactType(f?.type)) coupleRoute.push({ run, detail: `add_relationship Couple inline ${f.type}` });
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
        const tree = startingTree(run);
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

function report(name: string, fires: Fire[], noun = "fire(s)") {
  const runs = new Set(fires.map((f) => f.run));
  console.log(`\n${name}: ${fires.length} ${noun} across ${runs.size} run(s)`);
  if (fires.length && VERBOSE) for (const f of fires) console.log(`    ${f.run}\n      ${f.detail}`);
  else if (fires.length) {
    for (const f of fires.slice(0, 10)) console.log(`    ${f.detail}  [${f.run}]`);
    if (fires.length > 10) console.log(`    ... ${fires.length - 10} more (--verbose for all)`);
  }
}

console.log("Replaying Stage 1a's tree-writer refusals over the committed corpus.");
report("couple-event on a person", coupleEvent);
report("  update_fact retyping a person's fact into a couple event (candidates, not counted above)", coupleEventCandidates, "op(s)");
report("  couple event already written on the Couple edge (the route the refusal names)", coupleRoute, "op(s)");
report("self-Couple", selfCouple);
report("unscoped remove of a shared fact id", sharedRemove);
console.log(`\n  remove {factId} ops seen: ${removeFactOps}`);
if (removeUnresolved) console.log(`  (${removeUnresolved} unscoped, starting tree not resolvable — not counted either way)`);
console.log("\nEach fire above needs reading as a true positive before the refusal ships.");
