/**
 * Evidence for phase 4's "ask when the candidates are not decisive" threshold.
 *
 * WHY THIS EXISTS. The plan's rule is "derived, not guessed", and there was nothing to
 * derive from: one hand-authored mock fixture whose scores were INVENTED to look
 * decisive (so deriving a threshold that must keep it decisive is circular), and one
 * live query surviving only as agent prose with no raw response body anywhere.
 *
 * WHAT IT PROBES. A battery spanning the two known poles and — the point — the middle,
 * because a threshold is decided by the cases between the obvious ones, not by them:
 *
 *   qualified   a name with birth year, country and county   (expected: decisive)
 *   flood       a common name with nothing else              (expected: not decisive)
 *   middle      partial qualification                        (the cases that decide it)
 *
 * Two things the exhibits already settle, so the probe does not re-ask them:
 *   - `confidence` cannot gate decisiveness UPWARD: the decisive Flynn pick is
 *     confidence 3 while the hopeless Mary Hales top-ten are all confidence 4.
 *   - `score` is "not comparable across queries" per the tool spec, so only a
 *     WITHIN-response first-vs-second gap is safe to threshold.
 *
 * Usage:  npx tsx dev/probe-person-search-decisiveness.ts [--out probe.json]
 */
import { writeFileSync } from "node:fs";
import { LOCAL } from "../src/auth/principal.js";
import { personSearchTool } from "../src/tools/person-search.js";
import type { PersonSearchInput } from "../src/types/person-search.js";

interface Probe {
  label: string;
  shape: "qualified" | "middle" | "flood";
  input: PersonSearchInput;
}

const BATTERY: Probe[] = [
  // The shape ut_init_project_004 models, and the one the eval rightly auto-picks.
  { label: "flynn-qualified", shape: "qualified",
    input: { surname: "Flynn", givenName: "Patrick", birthYearFrom: 1840, birthYearTo: 1850,
             birthPlace: "Ireland", residencePlace: "Schuylkill, Pennsylvania, United States" } },
  // The shape that stalled the run: a name and nothing else.
  { label: "hales-flood", shape: "flood", input: { surname: "Hales", givenName: "Mary" } },
  { label: "smith-flood", shape: "flood", input: { surname: "Smith", givenName: "John" } },
  // The middle: enough to narrow, not obviously enough to decide.
  { label: "hales-year", shape: "middle",
    input: { surname: "Hales", givenName: "Mary", birthYearFrom: 1830, birthYearTo: 1840 } },
  { label: "hales-year-place", shape: "middle",
    input: { surname: "Hales", givenName: "Mary", birthYearFrom: 1830, birthYearTo: 1840,
             birthPlace: "England" } },
  { label: "mcandrew-qualified", shape: "qualified",
    input: { surname: "McAndrew", givenName: "Mary", birthYearFrom: 1845, birthYearTo: 1852,
             birthPlace: "New Brunswick, Canada" } },
  { label: "mogan-middle", shape: "middle",
    input: { surname: "Mogan", givenName: "John", residencePlace: "Detroit, Wayne, Michigan, United States" } },
  { label: "broyles-middle", shape: "middle",
    input: { surname: "Broyles", givenName: "Charles", birthYearFrom: 1875, birthYearTo: 1882 } },
];

function gap(results: Array<{ score?: number }>): number | null {
  const a = results[0]?.score;
  const b = results[1]?.score;
  if (typeof a !== "number" || typeof b !== "number") return null;
  return Number((a - b).toFixed(4));
}

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf("--out");
  const out = outFlag >= 0 ? process.argv[outFlag + 1] : "dev/probe-person-search-decisiveness.json";
  const captured: unknown[] = [];

  for (const probe of BATTERY) {
    process.stderr.write(`probing ${probe.label} ... `);
    try {
      const res = await personSearchTool(probe.input, LOCAL);
      const results = (res.results ?? []) as Array<{ personId?: string; score?: number; confidence?: number }>;
      const row = {
        label: probe.label,
        shape: probe.shape,
        input: probe.input,
        totalMatches: res.totalMatches,
        returned: res.returned,
        topScores: results.slice(0, 5).map((r) => r.score ?? null),
        topConfidences: results.slice(0, 5).map((r) => r.confidence ?? null),
        firstSecondGap: gap(results),
        scoresPresent: results.filter((r) => typeof r.score === "number").length,
      };
      captured.push(row);
      process.stderr.write(
        `total=${res.totalMatches} returned=${res.returned} gap=${row.firstSecondGap ?? "n/a"}\n`
      );
    } catch (err) {
      captured.push({ label: probe.label, shape: probe.shape, input: probe.input,
                      error: String((err as Error)?.message ?? err) });
      process.stderr.write(`ERROR ${String((err as Error)?.message ?? err).slice(0, 80)}\n`);
    }
  }

  writeFileSync(out, JSON.stringify({ captured_at: new Date().toISOString().slice(0, 10), probes: captured }, null, 2), "utf8");
  process.stderr.write(`\nwrote ${out} (${captured.length} probes)\n`);
}

void main();
