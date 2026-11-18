// #4549: count how many committed `person_evidence` links carry
// `match_score: null` even though `same_person` already scored that exact
// (assertion, tree person) pairing in the same run -- the defect this issue
// fixes. `dev/replay-score-gate.ts` can't see this: the committed corpus has
// no `results/.scores/` files, so it re-derives scores from the raw run log's
// `tool_calls` instead of reading an attestation file.
//
//   npx tsx dev/replay-null-score-links.ts
//
// Only the EXACT-KEY same_person shape is replayed here (no `recordRole`,
// `recordPersonaId` or `matchRelatives` in the call's args): that is the shape
// `findRecordedScore`'s exact lookup answers, and it is what the fix's own
// refusal message quotes. A score filed through the persona arm or a batch
// `matchRelatives` call is not joined, so this count is a LOWER BOUND, same as
// the issue's own review-comment measurement.
import { repoRoot, runLogFiles, readRunLog, toolCalls, bareName, responseOf } from "./runlog-calls.js";

type ExactScore = { score: number };

/** The exact-key same_person score(s) a run log's tool calls attest, keyed
 *  `assertionId|treePersonId`. A later call for the same pairing replaces an
 *  earlier one, matching `recordMatchScore`'s own "newest wins" rule.
 *  `bareName` strips whatever server prefix the run exposed the tool under
 *  (CLAUDE.md "Dual-spelled tool names") -- unexercised on today's corpus,
 *  which carries only the bare `mcp__genealogy__` form, but a run recorded
 *  through a different transport must not silently drop out of this count. */
function exactScoresFrom(runLog: unknown): Map<string, ExactScore> {
  const out = new Map<string, ExactScore>();
  for (const call of toolCalls(runLog)) {
    if (bareName(call) !== "same_person") continue;
    const args = call.args ?? {};
    if (typeof args.assertionId !== "string" || args.assertionId === "") continue;
    if (typeof args.treePersonId !== "string" || args.treePersonId === "") continue;
    if (args.recordRole != null || args.recordPersonaId != null || args.matchRelatives != null) continue;
    if (call.is_error) continue;
    const response = responseOf(call);
    if (typeof response?.score !== "number") continue;
    out.set(`${args.assertionId}|${args.treePersonId}`, { score: response.score });
  }
  return out;
}

let runsRead = 0;
let nullLinks = 0;
let nullLinksBesideScore = 0;
let belowHalf = 0;
let superseded = 0;
const byConfidence = new Map<string, number>();

for (const file of runLogFiles("e2e")) {
  if (file.includes(".final-")) continue; // a final document, not a run log
  const finalPath = file.replace(/\.json$/, ".final-research.json");
  const runLog = readRunLog(file);
  const final = readRunLog(finalPath) as any;
  if (runLog === undefined || final === undefined) continue; // no sibling final document
  runsRead += 1;
  const exact = exactScoresFrom(runLog);
  if (exact.size === 0) continue;
  for (const pe of (final.person_evidence ?? []) as any[]) {
    if (pe?.match_score !== null) continue;
    nullLinks += 1;
    const attested = exact.get(`${pe.assertion_id}|${pe.person_id}`);
    if (!attested) continue;
    nullLinksBesideScore += 1;
    if (attested.score < 0.5) belowHalf += 1;
    if (pe.superseded_by != null) superseded += 1;
    const conf = String(pe.confidence ?? "unknown");
    byConfidence.set(conf, (byConfidence.get(conf) ?? 0) + 1);
  }
}

console.log(`repo root                                 : ${repoRoot}`);
console.log(`runs read with a final document           : ${runsRead}`);
console.log(`null-match_score links (all)              : ${nullLinks}`);
console.log(`  beside an exact-key same_person score    : ${nullLinksBesideScore}`);
console.log(`    scored below 0.5                       : ${belowHalf}`);
console.log(`    superseded                             : ${superseded}`);
console.log(`    by confidence                          : ${JSON.stringify(Object.fromEntries(byConfidence))}`);
console.log(`(lower bound -- exact-key same_person calls only; a persona-arm or matchRelatives score is not joined)`);
