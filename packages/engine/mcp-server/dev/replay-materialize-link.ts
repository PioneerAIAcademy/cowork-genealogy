// Replay the committed e2e corpus against materialize_facts' existing-person
// rule (issue #3363), per ADR-0011 limit 2: how often each arm's decision fires
// over the corpus, each fire printed for inspection.
//
//   npx tsx dev/replay-materialize-link.ts [--verbose]
//
// Every op of a successful materialize_facts call that names a personId is
// judged by the shipped decision, never a copy of it: `personaTargetRefusal`
// for the persona arm, `namedPartyTargetRefusal` for the named-party arm. Each
// runs against the run's FINAL research (its links), its final tree, and the
// fixture's starting-tree ids. A final state stands in for the state at call
// time, so a figure can be off either way: a link written after the copy hides
// a refusal, and a link superseded after it adds one.
//
//   persona      every persona op the rule refuses, with the persona's links to
//                the target, so each fire can be read.
//   two-party    of those, the ones admitted when every persona assertion
//                qualifies, the rule before issue #3363: what the one-party
//                rule adds.
//   baseline     of those, the ones admitted without the starting-tree ids.
//   named-party  every named-party op the arm's decision refuses.
//
// Exit is always 0: this reports a rate for a human to read, it is not a gate.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  existingPersonLinkRefusal,
  namedPartyTargetRefusal,
  personaTargetRefusal,
} from "../src/tools/materialize-facts.js";
import { startingPersonIdsOf } from "../src/utils/starting-tree.js";
import { bareName, opsOf, readRunLog, repoRoot, responseOf, runLogFiles, toolCalls } from "./runlog-calls.js";

const VERBOSE = process.argv.includes("--verbose");

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

type Fire = { run: string; detail: string };
const fires: Record<"persona" | "twoParty" | "baseline" | "namedParty", Fire[]> = {
  persona: [],
  twoParty: [],
  baseline: [],
  namedParty: [],
};
const examined = { persona: 0, personaBatched: 0, namedParty: 0 };
const why: Record<string, number> = {};
const fireDates: string[] = [];
const fireRuns = new Set<string>();
let runs = 0;
let noStartingTree = 0;
let noFinalState = 0;

const strong = (e: any) => e.confidence === "probable" || e.confidence === "confident";

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
  const links: any[] = Array.isArray(research.person_evidence) ? research.person_evidence : [];
  runs++;

  for (const call of toolCalls(readRunLog(file))) {
    if (bareName(call) !== "materialize_facts" || responseOf(call)?.ok !== true) continue;
    const batched = call.args.ops !== undefined;
    for (const op of opsOf(call.args)) {
      const personId = typeof op?.personId === "string" ? op.personId : undefined;
      if (!personId) continue;

      if (typeof op.assertionId === "string") {
        examined.namedParty++;
        const named = assertions.find((a) => a?.id === op.assertionId);
        if (!named) continue;
        const refusal = namedPartyTargetRefusal(tree, research, named, String(op.relatedRole ?? ""), personId, op.gender, starting);
        if (refusal !== null) fires.namedParty.push({ run: file, detail: `${personId} <- ${op.assertionId} (${op.relatedRole})` });
        continue;
      }

      if (typeof op.recordId !== "string" || typeof op.recordRole !== "string") continue;
      examined.persona++;
      if (batched) examined.personaBatched++;
      if (personaTargetRefusal(tree, research, op, starting) === null) continue;

      const persona = new Set<string>(
        assertions
          .filter((a) => a?.record_id === op.recordId && a?.record_role === op.recordRole && typeof a.id === "string")
          .map((a) => a.id),
      );
      const toTarget = links.filter((e) => e && e.person_id === personId && persona.has(e.assertion_id));
      const live = toTarget.filter((e) => !e.superseded_by);
      const reason =
        toTarget.length === 0 ? "no link from the persona"
        : live.some(strong) ? "probable or better only through a two-party assertion"
        : live.length > 0 ? "speculative only"
        : "superseded only";
      why[reason] = (why[reason] ?? 0) + 1;
      const linkText = toTarget.length === 0
        ? "none"
        : toTarget.map((e) => `${e.id} ${e.assertion_id} ${e.confidence}${e.superseded_by ? " superseded" : ""}`).join(", ");
      const label = `${personId} <- ${op.recordId} ${op.recordRole}${batched ? " (batch)" : ""}; links: ${linkText}`;
      fires.persona.push({ run: file, detail: label });
      fireRuns.add(file);
      const date = /run-(\d{4}-\d{2}-\d{2})/.exec(file)?.[1];
      if (date) fireDates.push(date);

      if (existingPersonLinkRefusal(tree, research, personId, op.recordId, persona, "it", starting) === null) {
        fires.twoParty.push({ run: file, detail: label });
      }
      if (personaTargetRefusal(tree, research, op) === null) fires.baseline.push({ run: file, detail: label });
    }
  }
}

const show = (list: Fire[]) => {
  for (const f of VERBOSE ? list : list.slice(0, 40)) console.log(`  ${f.run}  ${f.detail}`);
  if (!VERBOSE && list.length > 40) console.log(`  ... ${list.length - 40} more (--verbose)`);
};
fireDates.sort();

console.log(`Runs replayed: ${runs} (skipped ${noFinalState} with no final state; ${noStartingTree} have no starting tree, so the baseline cannot apply to them)`);
console.log(`Persona ops onto a personId: ${examined.persona} (${examined.personaBatched} in an ops[] batch); named-party ops onto a personId: ${examined.namedParty}`);
console.log(
  `\npersona: ${fires.persona.length} refused, in ${fireRuns.size} run(s)` +
    (fireDates.length ? ` dated ${fireDates[0]} to ${fireDates[fireDates.length - 1]}` : "") +
    (Object.keys(why).length ? ` (${Object.entries(why).map(([k, v]) => `${k} ${v}`).join("; ")})` : ""),
);
show(fires.persona);
console.log(`\ntwo-party: ${fires.twoParty.length} of those admitted when every persona assertion qualifies`);
show(fires.twoParty);
console.log(`\nbaseline: ${fires.baseline.length} of those admitted without the starting-tree ids`);
show(fires.baseline);
console.log(
  `\nnamed-party: ${fires.namedParty.length} refused` +
    (examined.namedParty === 0 ? " (no successful named-party op in this corpus names a personId, so the arm has no executed population)" : ""),
);
show(fires.namedParty);
