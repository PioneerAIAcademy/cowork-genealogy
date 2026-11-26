// The attached-births proof gate (issue #4444) over the committed e2e corpus, per
// ADR-0011 limit 2: every proof summary it refuses, read from each committed e2e
// final state, and whether project_context's identity rung names the same pairs
// for that question (so no refusal is left without a route). Replays the shipped
// `attachedBirthProofInvariants`; re-implements nothing.
//
//   npx tsx dev/measure-attached-birth-proofs.ts           # offline: no place data
//   npx tsx dev/measure-attached-birth-proofs.ts --live    # reads coordinates and
//                                                          # other names, as the tool does
//
// Offline is a superset: a pair found with no place data can only be released
// once coordinates and other names are read. The gate only reads a state whose
// person mode linked FamilySearch attachments, which only runs after PR D of
// #3516, so the committed corpus holds few such states; the 183-subject live walk
// in dev/measure-attached-birth-conflicts.ts is the false-positive evidence.
//
// Exits 2 when a floor fails: no state read, no state with attachment links, or
// no proof judged in one, so a broken corpus read cannot read as a clean zero.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  attachedBirthPairPlaces,
  attachedBirthPairsByQuestion,
  attachedBirthProofInvariants,
  attachedBirthScopePersons,
  lookupBirthPlaceInfo,
  unansweredAttachedBirthPairs,
  type BirthPlaceCoords,
} from "../src/tools/research-append.js";
import { questionStates } from "../src/utils/question-state.js";
import { ATTACHMENT_LINK_RATIONALE } from "../src/utils/tree-person.js";
import { repoRoot } from "./runlog-calls.js";

const LIVE = process.argv.includes("--live");
/** Offline reads no place, as a refused lookup does: the superset reading. */
const read: (c: string[], a: string[]) => Promise<BirthPlaceCoords> = LIVE ? lookupBirthPlaceInfo : async () => new Map();
const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8", maxBuffer: 1 << 28 });
const sha = git("rev-parse", "--short=9", "HEAD").trim();

function readJson(rel: string): any {
  try {
    return JSON.parse(readFileSync(join(repoRoot, rel), "utf-8"));
  } catch {
    return null;
  }
}

let floorsFailed = 0;
function floor(ok: boolean, what: string): void {
  if (!ok) {
    floorsFailed += 1;
    console.log(`  FLOOR FAILED: ${what}`);
  }
}

const files = git("ls-files", "eval/runlogs/e2e").split("\n").filter((f) => f.endsWith(".final-research.json"));
let states = 0, withAttachments = 0, judged = 0, refused = 0, unrouted = 0;
for (const f of files) {
  const research = readJson(f);
  const tree = readJson(f.replace(/\.final-research\.json$/, ".final-tree.gedcomx.json"));
  if (!research || !tree) continue;
  states += 1;
  const attached = ((research.person_evidence ?? []) as any[]).some((pe) => pe?.rationale === ATTACHMENT_LINK_RATIONALE);
  if (!attached) continue;
  withAttachments += 1;
  const label = `${basename(dirname(f))}/${basename(f).slice(4, 23)}`;
  // The rung's pairs as project_context computes them, by the shipped function.
  const byQuestion = await attachedBirthPairsByQuestion(research, tree, read);
  const steps = new Map(questionStates(research, tree, byQuestion).map((s) => [s.id, s.nextStep ?? ""]));
  for (const ps of (research.proof_summaries ?? []) as any[]) {
    if (!ps || typeof ps.question_id !== "string") continue;
    judged += 1;
    // The gate's place data as research_append's prefetch reads it for this op.
    const unread = unansweredAttachedBirthPairs(attachedBirthScopePersons(research, tree, ps.question_id), research, tree);
    const { coordNames, aliasNames } = attachedBirthPairPlaces(unread);
    const coords = coordNames.length > 0 || aliasNames.length > 0 ? await read(coordNames, aliasNames) : undefined;
    // The pairs the gate refuses on, which the rung must name.
    const pairs = unansweredAttachedBirthPairs(attachedBirthScopePersons(research, tree, ps.question_id), research, tree, coords);
    const errors = attachedBirthProofInvariants(ps, research, tree, coords);
    if (errors.length === 0) continue;
    refused += 1;
    const step = steps.get(ps.question_id) ?? "";
    const routed = step.startsWith("conflict-resolution — identity") && pairs.every((p) => step.includes(p.a.id) && step.includes(p.b.id));
    if (!routed) unrouted += 1;
    console.log(`REFUSED ${label} ${ps.id} (${ps.tier}) rung ${routed ? "routes it" : "DOES NOT route it"}`);
    for (const p of pairs) console.log(`    ${p.personId}: ${p.a.id} '${p.a.place}' vs ${p.b.id} '${p.b.place}'`);
  }
}

console.log(`measured at ${sha} (${LIVE ? "live place data" : "offline, no place data"})`);
console.log(`committed e2e final states read: ${states}`);
console.log(`  with FamilySearch attachment links (the gate's population): ${withAttachments}`);
console.log(`proof summaries judged in those states: ${judged}`);
console.log(`  refused: ${refused}`);
console.log(`  refused with no identity rung naming the same pairs: ${unrouted}`);
floor(states > 0, "no committed e2e final state was read");
floor(withAttachments > 0, "no committed state carries attachment links");
floor(judged > 0, "no proof summary was judged in a state with attachment links");
floor(unrouted === 0, "a refusal has no identity rung routing it");
process.exit(floorsFailed > 0 ? 2 : 0);
