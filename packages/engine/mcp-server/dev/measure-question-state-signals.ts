/**
 * How often do `unregisteredDisagreements` and `competingParentSets` fire on the
 * committed corpus?
 *
 * The project-context spec quotes these rates, and a rate whose method is not
 * committed cannot be re-derived by the next reviewer, so this is committed
 * rather than run once and quoted. It reads only committed artifacts: no API,
 * no token, no network.
 *
 *   npx tsx dev/measure-question-state-signals.ts          # counts
 *   npx tsx dev/measure-question-state-signals.ts --list   # plus every hit
 *
 * Method: the corpus is every `eval/fixtures/scenarios/<s>/research.json`
 * (with its sibling `tree.gedcomx.json`) plus every e2e final state
 * `eval/runlogs/e2e/<slug>/run-<ts>.final-research.json` (with its
 * `.final-tree.gedcomx.json`). `scratch_<ts>` final states are developer
 * scratch runs, not benchmark runs, and are left out. Each is run through the shipped
 * `questionStates`. A "question entry" is one element of `questions[]` with a
 * string id; a "question-run" hit is one such entry whose signal is non-empty.
 * A file that does not parse is dropped and counted under `unreadable`.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { questionStates } from "../src/utils/question-state.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCENARIOS = join(REPO, "eval", "fixtures", "scenarios");
const E2E = join(REPO, "eval", "runlogs", "e2e");
const LIST = process.argv.includes("--list");

let unreadable = 0;
const readJson = (file: string): any => {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    unreadable++;
    return null;
  }
};

type Doc = { kind: "scenario" | "e2e"; label: string; research: any; tree: any };
const docs: Doc[] = [];

for (const s of existsSync(SCENARIOS) ? readdirSync(SCENARIOS) : []) {
  const research = readJson(join(SCENARIOS, s, "research.json"));
  if (research) docs.push({ kind: "scenario", label: s, research, tree: readJson(join(SCENARIOS, s, "tree.gedcomx.json")) });
}
for (const slug of existsSync(E2E) ? readdirSync(E2E) : []) {
  let names: string[];
  try {
    names = readdirSync(join(E2E, slug));
  } catch {
    continue;
  }
  for (const name of names) {
    if (!name.startsWith("run-") || !name.endsWith(".final-research.json")) continue;
    const research = readJson(join(E2E, slug, name));
    const treeName = name.replace(".final-research.json", ".final-tree.gedcomx.json");
    if (research) docs.push({ kind: "e2e", label: `${slug}/${name}`, research, tree: readJson(join(E2E, slug, treeName)) });
  }
}

const tally = {
  scenario: { files: 0, questions: 0, disagreements: 0, parentSets: 0 },
  e2e: { files: 0, questions: 0, disagreements: 0, parentSets: 0 },
};
const hits: string[] = [];
for (const d of docs) {
  const t = tally[d.kind];
  t.files++;
  for (const s of questionStates(d.research, d.tree)) {
    t.questions++;
    if (s.unregisteredDisagreements.length > 0) {
      t.disagreements++;
      for (const u of s.unregisteredDisagreements) {
        hits.push(`disagreement  ${d.label} ${s.id}: ${u.personId} ${u.fact} [${u.assertionIds.join(", ")}]`);
      }
    }
    if (s.competingParentSets.length > 0) {
      t.parentSets++;
      for (const p of s.competingParentSets) {
        hits.push(`parent-set    ${d.label} ${s.id}: ${p.personId} <- ${p.parentIds.join(", ")}`);
      }
    }
  }
}

const total = tally.scenario.questions + tally.e2e.questions;
console.log(`question entries: ${total} (${tally.scenario.questions} in ${tally.scenario.files} scenarios, ${tally.e2e.questions} in ${tally.e2e.files} e2e final states)`);
console.log(`unregistered disagreements: ${tally.e2e.disagreements} e2e question-runs, ${tally.scenario.disagreements} scenario questions`);
console.log(`competing parent sets:      ${tally.e2e.parentSets} e2e question-runs, ${tally.scenario.parentSets} scenario questions`);
console.log(`unreadable files dropped: ${unreadable}`);
if (LIST) for (const h of hits.sort()) console.log(h);
