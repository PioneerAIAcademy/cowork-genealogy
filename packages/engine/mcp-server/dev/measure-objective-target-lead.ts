// Re-derive the refusal rate of the "objective's target record leads the plan"
// precondition (issue #2030; its ruling requires the rate measured before
// merging), quoted in research-append-tool-spec.md.
//
//   npx tsx dev/measure-objective-target-lead.ts          # the figures
//   npx tsx dev/measure-objective-target-lead.ts --rows   # + every plan the rule applies to
//
// Replays the SHIPPED parser and verdict (`objectiveTarget`,
// `objectiveTargetLeadError`) over the first plan written for the first question
// of every committed e2e final research document — the plan research_append
// would judge. Model-written plans only; fixture scenarios are hand-written.
//
// Corpus selection is `git ls-files`, NOT a filesystem glob, so untracked
// scratch_ runs are not counted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { objectiveTarget, objectiveTargetLeadError, targetsObjective } from "../src/utils/objective-target.js";

const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
const files = execFileSync("git", ["ls-files", "eval/runlogs/e2e"], { cwd: repo, encoding: "utf-8" })
  .split("\n")
  .filter((f) => f.endsWith(".final-research.json"));

const showRows = process.argv.includes("--rows");
const counts = { documents: 0, withPlan: 0, applies: 0, silent: 0, accepted: 0, refused: 0 };
const rows: string[] = [];

for (const f of files) {
  const research = JSON.parse(readFileSync(join(repo, f), "utf-8"));
  counts.documents++;
  const firstQuestion = Array.isArray(research.questions) ? research.questions[0]?.id : undefined;
  const plans: any[] = Array.isArray(research.plans) ? research.plans : [];
  const plan = plans.find((p) => p?.question_id === firstQuestion);
  if (!plan) continue;
  counts.withPlan++;
  const target = objectiveTarget(research.project?.objective);
  if (!target) continue;
  counts.applies++;
  const error = objectiveTargetLeadError(plan, target);
  const items: any[] = Array.isArray(plan.items) ? plan.items : [];
  if (error) {
    counts.refused++;
    rows.push(`REFUSED  ${f}\n  ${error}`);
  } else if (!items.some((i) => targetsObjective(i, target))) {
    counts.silent++;
    rows.push(`silent   ${f}  (${target.event} in ${target.place}: no item targets it)`);
  } else {
    counts.accepted++;
    rows.push(`accepted ${f}  (${target.event} in ${target.place})`);
  }
}

console.log(counts);
console.log(
  `refusal rate: ${counts.refused} of ${counts.withPlan} first-question plans ` +
    `(${counts.refused} of ${counts.applies} where the objective names a record and its place)`,
);
if (showRows) for (const r of rows) console.log(r);
