/**
 * Probe: what does the bare-name rule (genealogist ruling 2026-10-06, option C
 * with fallback B′) change, on the bare single-segment places the committed e2e
 * corpus actually wrote?
 *
 * For each distinct bare name, with NO record context (the worst case — the
 * write paths pass the record's other places, which can only add resolutions):
 *   old = the best-scored hit, which is what `resolveStandardPlace` returned
 *   new = `resolveStandardPlace` now: kept only when the best hit is a
 *         jurisdiction (country, state, territory, county, region, admin div)
 *
 *   npx tsx dev/probe-bare-place-rule.ts <names.json>
 *
 * `names.json` is `{ "names": [...], "counts": { name: occurrences } }`, built
 * from every `eval/runlogs/e2e/<slug>/run-*.final-research.json` assertion whose
 * `place` has one comma segment.
 *
 * Result (2026-10-06, corpus at main deb6babea): 84 distinct bare names, 541
 * occurrences. 69 unchanged; 15 now unset (35 occurrences). Of those 15, the
 * old answer was wrong for most: "Birmingham" -> a farm in South Africa (10),
 * "Ulvig Prgj." -> a farm in Troms, "sitio do Lombo dos Aguiares" -> Romania,
 * "Lesje Hovedsogn" -> Serbia, "Ringebo Præstegjeld" -> Sweden, "Shawneetown"
 * -> Missouri, "Kingservigs Prgj." -> a cemetery. Right and now lost without
 * context: West Bromwich, Milwaukee, Dallerup, Banbridge, Stagstrup (~6).
 * The first run read FamilySearch's live county type as "County (Top level)"
 * and unset every county; `isJurisdiction` drops the bracketed qualifier.
 */
import { readFileSync } from "node:fs";
import { searchPlace } from "../src/utils/place-api.js";
import { resolveStandardPlace } from "../src/utils/place-resolver.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx dev/probe-bare-place-rule.ts <names.json>");
  process.exit(2);
}
const { names, counts } = JSON.parse(readFileSync(file, "utf-8")) as {
  names: string[];
  counts: Record<string, number>;
};

let same = 0;
let unset = 0;
let unsetOcc = 0;
for (const name of names) {
  const hits = await searchPlace(name);
  const best = hits.reduce<(typeof hits)[number] | undefined>(
    (b, e) => ((e.score ?? 0) > (b?.score ?? 0) ? e : b),
    undefined,
  );
  const now = await resolveStandardPlace(name);
  const old = best?.fullName ?? null;
  const tag = old === now ? "same " : now === null ? "UNSET" : "MOVED";
  if (tag === "same ") same++;
  else if (now === null) {
    unset++;
    unsetOcc += counts[name] ?? 0;
  }
  console.log(`${tag} ${String(counts[name] ?? 0).padStart(3)}  ${JSON.stringify(name)}  ` +
    `old=${JSON.stringify(old)} (${best?.type ?? "-"})  new=${JSON.stringify(now)}`);
}
console.log(`\n${names.length} names: ${same} unchanged, ${unset} now unset (${unsetOcc} occurrences)`);
