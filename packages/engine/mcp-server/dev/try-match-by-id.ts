/**
 * After-tool smoke test for the four match-by-id tools. Hits the live FS API.
 *
 * Usage:
 *   npx tsx dev/try-match-by-id.ts                              # all four with default ids
 *   npx tsx dev/try-match-by-id.ts <which> <id>                 # one tool, custom id
 *
 * <which> is one of: pr, rp, pp, rr (or the full tool name).
 * <id> can be a bare pid or a full ARK; the tool will normalize.
 */
import {
  personRecordMatches,
  recordPersonMatches,
  personPersonMatches,
  recordRecordMatches,
} from "../src/tools/match-by-id.js";

const fns: Record<string, (input: { id: string }) => Promise<unknown>> = {
  pr: personRecordMatches,
  person_record_matches: personRecordMatches,
  rp: recordPersonMatches,
  record_person_matches: recordPersonMatches,
  pp: personPersonMatches,
  person_person_matches: personPersonMatches,
  rr: recordRecordMatches,
  record_record_matches: recordRecordMatches,
};

const DEFAULTS: Array<[string, string]> = [
  ["pr", "KNDX-MKG"],   // George Washington tree person
  ["rp", "QPTX-TMQ2"],  // Lincoln record persona
  ["pp", "KNDX-MKG"],
  ["rr", "QPTX-TMQ2"],
];

async function runOne(which: string, id: string): Promise<void> {
  const fn = fns[which];
  if (!fn) {
    console.error(`Unknown tool selector: ${which}. Use one of: ${Object.keys(fns).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n=== ${which} id=${id} ===`);
  try {
    const result = await fn({ id });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const [, , which, id] = process.argv;
if (which && id) {
  await runOne(which, id);
} else {
  for (const [w, i] of DEFAULTS) await runOne(w, i);
}
