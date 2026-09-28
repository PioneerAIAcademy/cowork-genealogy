/// <reference types="node" />
/** Does the declared/detected core-identifier cap fire on a record that STATES
 *  a contradicting birthplace, and stay silent on a secondary informant? */
import { mkdtemp, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { researchAppend } from "../src/tools/research-append.js";

const SCENARIOS: Array<[string, string, string]> = [
  ["_012 birthplace", "../../../eval/fixtures/scenarios/flynn-birthplace-conflict-stated", "a_005"],
  ["_024 chronology", "../../../eval/fixtures/scenarios/flynn-baptism-names-mother", "a_001"],
  ["_024 via christening assertion", "../../../eval/fixtures/scenarios/flynn-baptism-names-mother", "a_003"],
  ["_023 weak match, stated conflict", "../../../eval/fixtures/scenarios/flynn-birthplace-conflict-stated", "a_002"],
];

async function tryTier(dir: string, confidence: string, aid: string): Promise<void> {
  const r: any = await researchAppend({
    projectPath: dir, section: "person_evidence", op: "append",
    entry: { assertion_id: aid, person_id: "I1", confidence,
      rationale: "Name matches; same_person 0.85.", match_score: 0.85,
      created: "2026-09-24", superseded_by: null },
  } as any);
  console.log(`  ${confidence.padEnd(12)} ${r.ok ? "ACCEPTED" : "REFUSED -> " + String(r.errors?.[0]).slice(0, 120)}`);
}

async function main(): Promise<void> {
  for (const [label, scen, aid] of SCENARIOS) {
    const dir = await mkdtemp(join(tmpdir(), "cap-"));
    await cp(scen, dir, { recursive: true });
    console.log(`\n${label} (assertion ${aid}):`);
    for (const c of ["confident", "probable", "speculative"]) await tryTier(dir, c, aid);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
