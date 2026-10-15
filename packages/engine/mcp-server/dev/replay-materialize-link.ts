// Replay the committed e2e corpus against the three holes issue #3363 closes in
// materialize_facts' existing-person link rule, per ADR-0011 limit 2: how often
// the rule fires over the corpus, each fire printed for inspection.
//
//   npx tsx dev/replay-materialize-link.ts [--verbose]
//
// Every op of a successful materialize_facts call that names a personId is
// judged by the shipped `existingPersonLinkRefusal`, never a copy of it, against
// the run's FINAL research (its links), its final tree, and the fixture's
// starting-tree ids. A final state stands in for the state at call time: a link
// written after the copy counts as present, so a figure here can only undercount.
//
//   named-party  a named-party op (assertionId form) onto a person the rule
//                refuses. That arm had no gate at all.
//   two-party    a persona op admitted while any persona assertion qualified,
//                refused now that only its own one-party assertions do.
//   baseline     a persona op exempt as "minted from this record" without the
//                starting-tree ids, refused with them.
//
// Exit is always 0: this reports a rate for a human to read, it is not a gate.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { existingPersonLinkRefusal } from "../src/tools/materialize-facts.js";
import { isRelationshipEstablishing } from "../src/utils/source-ref-resolver.js";
import { startingPersonIdsOf } from "../src/utils/starting-tree.js";
import { bareName, readRunLog, repoRoot, responseOf, runLogFiles, toolCalls } from "./runlog-calls.js";

const VERBOSE = process.argv.includes("--verbose");

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();
const opsOfCall = (args: any): any[] => {
  let ops = args.ops;
  if (typeof ops === "string") {
    try {
      ops = JSON.parse(ops);
    } catch {
      ops = undefined;
    }
  }
  return Array.isArray(ops) ? ops : [args];
};

type Fire = { run: string; detail: string };
const fires: Record<"namedParty" | "twoParty" | "baseline", Fire[]> = { namedParty: [], twoParty: [], baseline: [] };
const examined = { namedParty: 0, persona: 0 };
let runs = 0;
let noStartingTree = 0;
let noFinalState = 0;

const runFiles = runLogFiles("e2e").filter((f) => /[\/\\]run-[^\/\\]+\.json$/.test(f) && !f.includes(".final-"));
for (const file of runFiles) {
  const research = readJson(join(repoRoot, file.replace(/\.json$/, ".final-research.json")));
  const tree = readJson(join(repoRoot, file.replace(/\.json$/, ".final-tree.gedcomx.json")));
  if (!research || !tree) {
    noFinalState++;
    continue;
  }
  const slug = /runlogs[\/\\]e2e[\/\\]([^\/\\]+)/.exec(file)?.[1] ?? "";
  const baseline = readJson(join(repoRoot, "eval", "tests", "e2e", slug, "starting-tree.gedcomx.json"));
  if (!baseline) noStartingTree++;
  const starting = startingPersonIdsOf(baseline);
  const assertions: any[] = Array.isArray(research.assertions) ? research.assertions : [];
  runs++;

  for (const call of toolCalls(readRunLog(file))) {
    if (bareName(call) !== "materialize_facts" || responseOf(call)?.ok !== true) continue;
    for (const op of opsOfCall(call.args)) {
      const personId = typeof op?.personId === "string" ? op.personId : undefined;
      if (!personId) continue;

      if (typeof op.assertionId === "string") {
        examined.namedParty++;
        const named = assertions.find((a) => a?.id === op.assertionId);
        if (!named) continue;
        const qualifying = new Set<string>([op.assertionId]);
        for (const a of assertions) {
          if (a?.record_id === named.record_id && norm(a.record_role) === norm(op.relatedRole) &&
              typeof a.id === "string" && !isRelationshipEstablishing(a.fact_type)) {
            qualifying.add(a.id);
          }
        }
        const refusal = existingPersonLinkRefusal(tree, research, personId, String(named.record_id), qualifying, "it", starting);
        if (refusal !== null) fires.namedParty.push({ run: file, detail: `${personId} <- ${op.assertionId} (${op.relatedRole})` });
        continue;
      }

      if (typeof op.recordId !== "string" || typeof op.recordRole !== "string") continue;
      examined.persona++;
      const persona = assertions.filter((a) => a?.record_id === op.recordId && a?.record_role === op.recordRole && typeof a.id === "string");
      const all = new Set<string>(persona.map((a) => a.id));
      const own = new Set<string>(persona.filter((a) => !isRelationshipEstablishing(a.fact_type)).map((a) => a.id));
      const label = `${personId} <- ${op.recordId} ${op.recordRole}`;
      const admitsAll = existingPersonLinkRefusal(tree, research, personId, op.recordId, all, "it", starting) === null;
      const refusesOwn = own.size > 0 && existingPersonLinkRefusal(tree, research, personId, op.recordId, own, "it", starting) !== null;
      if (admitsAll && refusesOwn) fires.twoParty.push({ run: file, detail: label });
      const exemptWithout = existingPersonLinkRefusal(tree, research, personId, op.recordId, all, "it") === null;
      const refusedWith = existingPersonLinkRefusal(tree, research, personId, op.recordId, all, "it", starting) !== null;
      if (exemptWithout && refusedWith) fires.baseline.push({ run: file, detail: label });
    }
  }
}

console.log(`Runs replayed: ${runs} (skipped ${noFinalState} with no final state; ${noStartingTree} have no starting tree, so their baseline arm cannot fire)`);
console.log(`Named-party ops onto a personId examined: ${examined.namedParty}; persona ops onto a personId examined: ${examined.persona}`);
for (const [arm, list] of Object.entries(fires)) {
  console.log(`\n${arm}: ${list.length} would be refused`);
  for (const f of VERBOSE ? list : list.slice(0, 20)) console.log(`  ${f.run}  ${f.detail}`);
  if (!VERBOSE && list.length > 20) console.log(`  ... ${list.length - 20} more (--verbose)`);
}
