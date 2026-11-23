/**
 * Re-run `locality_survey` live with logged arguments and write, per call, what the agent saw
 * (the inline answer) and what the tool fetched (the staged answer). Input: a JSON file of
 * `{ key, args }`; output: `<outDir>/<n>.json` holding `{ key, args, inline, full }`.
 *
 *   npx tsx dev/try-locality-survey-capture.ts <calls.json> <outDir>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runLocalitySurvey, liveSurveyDeps } from "../src/tools/locality-survey.js";
import { LOCAL } from "../src/auth/principal.js";

const [callsPath, outDir] = process.argv.slice(2);
if (!callsPath || !outDir) throw new Error("usage: try-locality-survey-capture.ts <calls.json> <outDir>");
const calls: { key: string; args: Record<string, unknown> }[] = JSON.parse(readFileSync(callsPath, "utf8"));
mkdirSync(outDir, { recursive: true });
for (const [n, { key, args }] of calls.entries()) {
  let full: unknown = null;
  const deps = { ...liveSurveyDeps(LOCAL), stage: async (payload: unknown) => ((full = payload), "results/.staging/capture.json") };
  const { projectPath: _ignored, ...input } = args;
  try {
    const inline = await runLocalitySurvey(input as never, deps);
    writeFileSync(join(outDir, `${n}.json`), JSON.stringify({ key, args: input, inline, full }));
    console.log(`${n} ${key}: inline ${JSON.stringify(inline).length} full ${JSON.stringify(full).length}`);
  } catch (e) {
    console.log(`${n} ${key}: ERROR ${e instanceof Error ? e.message : String(e)}`);
  }
}
