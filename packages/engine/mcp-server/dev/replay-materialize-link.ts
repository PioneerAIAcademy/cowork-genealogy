// Replay the committed e2e corpus against materialize_facts' existing-person
// rule (issue #3363), per ADR-0011 limit 2: how often each arm's decision fires
// over the corpus, each fire printed for inspection.
//
//   npx tsx dev/replay-materialize-link.ts [--verbose]
//
// Every op of a materialize_facts call that names a personId is judged by the
// shipped decision, never a copy of it: `personaTargetRefusal` for the persona
// arm, `namedPartyTargetRefusal` for the named-party arm. Calls that succeeded
// and calls whose outcome the run log did not record (no response, or one too
// truncated to parse) are reported apart; calls that failed are skipped.
//
// Each op is judged against the run's FINAL research (its links), its final
// tree, and the fixture's starting-tree ids. A final state stands in for the
// state at call time, so a figure can be off either way: a link written after
// the copy hides a refusal, and a link superseded after it adds one. And the
// copy itself has landed in that tree, so a person the run added whose refs
// reached no other record before it can read as this record's stub, which both
// decisions admit with no link.
//
//   persona      every persona op the rule refuses, with each of the persona's
//                links to the target and the start of its rationale, so each
//                fire can be read.
//   two-party    of those, the ones admitted when every persona assertion
//                qualifies, the rule before issue #3363: what this rule adds.
//   baseline     of those, the ones admitted without the starting-tree ids.
//   named-party  every named-party op the arm's decision refuses.
//   exempt       persona ops onto a person minted from the op's own record
//                (`mintedFromThisRecord`), explicit ones by their personId and
//                implicit ones by every person their persona's facts reach in
//                the final tree: how many item 34 keeps exempt (the person
//                traces to this party and to no other) and how many it
//                withholds, carrying another party or no party.
//
// Exit is 0 unless the exempt bucket of the calls recorded as successes is empty,
// which would read as coverage and be none; otherwise this reports rates for a
// human to read and is not a gate.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  existingPersonLinkRefusal,
  mintedExemption,
  personaParty,
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
type Tally = {
  examined: { persona: number; batched: number; namedParty: number };
  fires: Record<"persona" | "twoParty" | "baseline" | "namedParty", Fire[]>;
  exempt: { explicit: number; implicit: number; kept: number; anotherParty: Fire[]; noParty: Fire[] };
  why: Record<string, number>;
  dates: string[];
  runs: Set<string>;
};
const tally = (): Tally => ({
  examined: { persona: 0, batched: 0, namedParty: 0 },
  fires: { persona: [], twoParty: [], baseline: [], namedParty: [] },
  exempt: { explicit: 0, implicit: 0, kept: 0, anotherParty: [], noParty: [] },
  why: {},
  dates: [],
  runs: new Set(),
});
const buckets = { succeeded: tally(), unrecorded: tally() };
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
  const date = /run-(\d{4}-\d{2}-\d{2})/.exec(file)?.[1];
  runs++;

  for (const call of toolCalls(readRunLog(file))) {
    if (bareName(call) !== "materialize_facts") continue;
    const ok = responseOf(call)?.ok;
    if (ok === false) continue;
    const t = ok === true ? buckets.succeeded : buckets.unrecorded;
    const batched = call.args.ops !== undefined;
    for (const op of opsOf(call.args)) {
      const personId = typeof op?.personId === "string" ? op.personId : undefined;
      if (typeof op?.assertionId !== "string" && typeof op?.recordId === "string" && typeof op?.recordRole === "string") {
        const party = personaParty(research, op.recordId, op.recordRole);
        const own = new Set(
          assertions
            .filter((a) => a?.record_id === op.recordId && a?.record_role === op.recordRole && typeof a.id === "string")
            .map((a) => a.id),
        );
        const targets = personId !== undefined
          ? [personId]
          : ((tree.persons ?? []) as any[])
              .filter((p) => (p?.facts ?? []).some((f: any) => own.has(f?.assertion_id)))
              .map((p) => String(p.id));
        for (const target of targets) {
          const how = mintedExemption(tree, research, target, op.recordId, party, starting);
          if (how === "not minted") continue;
          if (personId !== undefined) t.exempt.explicit++;
          else t.exempt.implicit++;
          const fire = { run: file, detail: `${target} <- ${op.recordId} ${op.recordRole}${personId === undefined ? " (implicit)" : ""}` };
          if (how === "exempt") t.exempt.kept++;
          else (how === "another party" ? t.exempt.anotherParty : t.exempt.noParty).push(fire);
        }
      }
      if (!personId) continue;

      if (typeof op.assertionId === "string") {
        t.examined.namedParty++;
        const named = assertions.find((a) => a?.id === op.assertionId);
        if (!named) continue;
        const refusal = namedPartyTargetRefusal(tree, research, named, String(op.relatedRole ?? ""), personId, op.gender, starting, op.name);
        if (refusal !== null) t.fires.namedParty.push({ run: file, detail: `${personId} <- ${op.assertionId} (${op.relatedRole})` });
        continue;
      }

      if (typeof op.recordId !== "string" || typeof op.recordRole !== "string") continue;
      t.examined.persona++;
      if (batched) t.examined.batched++;
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
        : live.some(strong) ? "probable or better only through a link that does not count"
        : live.length > 0 ? "speculative only"
        : "superseded only";
      t.why[reason] = (t.why[reason] ?? 0) + 1;
      const linkText = toTarget.length === 0
        ? "none"
        : toTarget
            .map((e) => `${e.id} ${e.assertion_id} ${e.confidence}${e.superseded_by ? " superseded" : ""} "${String(e.rationale ?? "").replace(/\s+/g, " ").slice(0, 200)}"`)
            .join("; ");
      const label = `${personId} <- ${op.recordId} ${op.recordRole}${batched ? " (batch)" : ""}; links: ${linkText}`;
      t.fires.persona.push({ run: file, detail: label });
      t.runs.add(file);
      if (date) t.dates.push(date);

      if (existingPersonLinkRefusal(tree, research, personId, op.recordId, persona, "it", starting, personaParty(research, op.recordId, op.recordRole)) === null) {
        t.fires.twoParty.push({ run: file, detail: label });
      }
      if (personaTargetRefusal(tree, research, op) === null) t.fires.baseline.push({ run: file, detail: label });
    }
  }
}

const show = (list: Fire[]) => {
  for (const f of VERBOSE ? list : list.slice(0, 40)) console.log(`  ${f.run}  ${f.detail}`);
  if (!VERBOSE && list.length > 40) console.log(`  ... ${list.length - 40} more (--verbose)`);
};

const sha = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();
console.log(`measured at ${sha} (working tree of this checkout)`);
console.log(`Runs replayed: ${runs} (skipped ${noFinalState} with no final state; ${noStartingTree} have no starting tree, so the baseline cannot apply to them)`);
for (const [name, t] of Object.entries(buckets)) {
  t.dates.sort();
  console.log(`\n=== calls whose outcome is ${name === "succeeded" ? "recorded as a success" : "not recorded"} ===`);
  console.log(`Persona ops onto a personId: ${t.examined.persona} (${t.examined.batched} in an ops[] batch); named-party ops onto a personId: ${t.examined.namedParty}`);
  console.log(
    `\npersona: ${t.fires.persona.length} refused, in ${t.runs.size} run(s)` +
      (t.dates.length ? ` dated ${t.dates[0]} to ${t.dates[t.dates.length - 1]}` : "") +
      (Object.keys(t.why).length ? ` (${Object.entries(t.why).map(([k, v]) => `${k} ${v}`).join("; ")})` : ""),
  );
  show(t.fires.persona);
  console.log(`\ntwo-party: ${t.fires.twoParty.length} of those admitted when every persona assertion qualifies`);
  show(t.fires.twoParty);
  console.log(`\nbaseline: ${t.fires.baseline.length} of those admitted without the starting-tree ids`);
  show(t.fires.baseline);
  console.log(
    `\nnamed-party: ${t.fires.namedParty.length} refused` +
      (t.examined.namedParty === 0 ? " (no named-party op here names a personId, so the arm has no population)" : ""),
  );
  show(t.fires.namedParty);
  const exempt = t.exempt.explicit + t.exempt.implicit;
  console.log(
    `\nexempt: ${exempt} (op, person) pair(s) onto a person minted from the op's record (${t.exempt.explicit} ` +
      `explicit, ${t.exempt.implicit} implicit); item 34 keeps ${t.exempt.kept} and withholds ` +
      `${t.exempt.anotherParty.length} carrying another party and ${t.exempt.noParty.length} carrying no party`,
  );
  show(t.exempt.anotherParty);
  show(t.exempt.noParty);
}

if (buckets.succeeded.exempt.explicit + buckets.succeeded.exempt.implicit === 0) {
  console.log("\nfloor failed: no persona op of a call recorded as a success landed on a stub of its own record");
  process.exit(1);
}
