/**
 * How many committed proofs does the unlinked-parent proof gate refuse?
 *
 * `unlinkedParentProofInvariants` refuses a proof above `not_proved` when a parent
 * side it cites has no cited, linked parent-role assertion (#3659). The spec row
 * quotes its refusal rate, and a row whose evidence cannot be re-derived is not
 * evidence -- so this is committed rather than run once. It reads only committed
 * artifacts: no API, no token, no network.
 *
 *   npx tsx dev/measure-unlinked-parent-proofs.ts
 *
 * Method: every `proof_summaries` entry at proved/probable/possible in each
 * `eval/runlogs/e2e/<slug>/run-*.final-research.json` and each
 * `eval/fixtures/scenarios/<name>/research.json`, checked against its own
 * document. The final document stands in for the pre-call snapshot, so a link
 * written AFTER the proof counts here: the figure is a lower bound on refusals.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  unlinkedParentNarrativeInvariants,
  unlinkedParentProofInvariants,
  unlinkedProofInvariants,
} from "../src/tools/research-append.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const E2E = join(REPO, "eval", "runlogs", "e2e");
const SCENARIOS = join(REPO, "eval", "fixtures", "scenarios");

function documents(): Array<{ label: string; doc: any }> {
  const out: Array<{ label: string; doc: any }> = [];
  const read = (label: string, file: string) => {
    try {
      out.push({ label, doc: JSON.parse(readFileSync(file, "utf-8")) });
    } catch {
      // A malformed committed file is not this measurement's to report.
    }
  };
  if (existsSync(E2E)) {
    for (const slug of readdirSync(E2E)) {
      let names: string[];
      try {
        names = readdirSync(join(E2E, slug));
      } catch {
        continue;
      }
      for (const name of names) {
        if (name.startsWith("run-") && name.endsWith(".final-research.json")) read(`e2e ${slug}/${name}`, join(E2E, slug, name));
      }
    }
  }
  if (existsSync(SCENARIOS)) {
    for (const name of readdirSync(SCENARIOS)) {
      const file = join(SCENARIOS, name, "research.json");
      if (existsSync(file)) read(`scenario ${name}`, file);
    }
  }
  return out;
}

let denominator = 0;
const refused: string[] = [];
const narrativeRefused: string[] = [];
for (const { label, doc } of documents()) {
  for (const ps of Array.isArray(doc?.proof_summaries) ? doc.proof_summaries : []) {
    if (!["proved", "probable", "possible"].includes(ps?.tier)) continue;
    denominator++;
    const narrative = unlinkedParentNarrativeInvariants(ps, doc);
    if (narrative.length > 0) narrativeRefused.push(`${label} ${ps.id} (${ps.tier})\n    ${narrative[0].split(" — ")[1] ?? narrative[0]}`);
    const errors = unlinkedParentProofInvariants(ps, doc);
    if (errors.length === 0) continue;
    const alsoZeroLinks = unlinkedProofInvariants(ps, doc).length > 0;
    refused.push(`${label} ${ps.id} (${ps.tier})${alsoZeroLinks ? " [also refused by unlinkedProofInvariants]" : ""}\n    ${errors[0].split(" — ")[1] ?? errors[0]}`);
  }
}
for (const line of refused) console.log(line);
console.log(`\nproofs above not_proved: ${denominator}; refused: ${refused.length}`);
console.log("\nunlinkedParentNarrativeInvariants (a parentage stated in prose):");
for (const line of narrativeRefused) console.log(line);
console.log(`refused: ${narrativeRefused.length}`);
console.log("snapshot: final document (a link written after the proof counts), so this is a lower bound");
