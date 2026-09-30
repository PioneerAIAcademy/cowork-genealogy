/**
 * Can a researcher actually tell the tied candidates apart?
 *
 * WHY THIS EXISTS. Phase 4 ships the ask: when `person_search` reports `pick.decisive:
 * false`, `init-project` stops and asks the researcher which person. That is only an
 * improvement if the options are distinguishable. The hand-authored flood fixture
 * (`eval/fixtures/mcp/person-search-hales-namesakes.json`) carries five candidates
 * named "Mary Hales" with NO facts at all — five identical options, an unanswerable
 * question. Whether that reflects the live API or is an artifact of a fixture written
 * to exercise the scoring rule was never measured: the decisiveness probe captured
 * scores and confidences only.
 *
 * The parent plan asks for candidate cards carrying "lifespan, places, parents and
 * spouse", and notes `person_search` strips relatives by design. So the question this
 * probe settles is narrower and prior to that one: of those four, how many does a
 * live response ALREADY carry? If lifespan and places are there, the ask works today
 * and only the fixture is wrong. If they are not, the ask needs enrichment before it
 * helps anyone.
 *
 * Usage:  npx tsx dev/probe-candidate-distinguishability.ts [--out probe.json]
 */
import { writeFileSync } from "node:fs";
import { LOCAL } from "../src/auth/principal.js";
import { personSearchTool } from "../src/tools/person-search.js";
import type { PersonSearchInput } from "../src/types/person-search.js";

interface Probe {
  label: string;
  input: PersonSearchInput;
}

// The three shapes that produced ties in the decisiveness probe — the exact
// population the ask will be shown for.
const BATTERY: Probe[] = [
  { label: "hales-flood", input: { surname: "Hales", givenName: "Mary" } },
  { label: "smith-flood", input: { surname: "Smith", givenName: "John" } },
  { label: "hales-year-place", input: { surname: "Hales", givenName: "Mary",
                                        birthYearFrom: 1850, birthYearTo: 1860,
                                        birthPlace: "England" } },
  // A decisive one as the control: if even the qualified case carries no facts, the
  // gap is in the tool's output shape, not in what a flood query can know.
  { label: "flynn-qualified", input: { surname: "Flynn", givenName: "Patrick",
                                       birthYearFrom: 1840, birthYearTo: 1850,
                                       birthPlace: "Pennsylvania, United States" } },
];

interface Person {
  names?: Array<{ given?: string; surname?: string }>;
  facts?: Array<{ type?: string; date?: string; place?: string }>;
  gender?: string;
}

/** What a candidate would actually show a researcher choosing between namesakes. */
function card(r: { personId?: string; gedcomx?: { persons?: Person[] } }) {
  const p = r.gedcomx?.persons?.[0] ?? {};
  const facts = p.facts ?? [];
  const pick = (t: string) => facts.find((f) => f.type === t);
  const birth = pick("Birth");
  const death = pick("Death");
  return {
    personId: r.personId ?? null,
    gender: p.gender ?? null,
    factCount: facts.length,
    factTypes: facts.map((f) => f.type ?? "?"),
    birthDate: birth?.date ?? null,
    birthPlace: birth?.place ?? null,
    deathDate: death?.date ?? null,
    deathPlace: death?.place ?? null,
  };
}

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf("--out");
  const out =
    outFlag >= 0 ? process.argv[outFlag + 1] : "dev/probe-candidate-distinguishability.json";
  const captured: unknown[] = [];

  for (const probe of BATTERY) {
    process.stderr.write(`probing ${probe.label} ... `);
    try {
      const res = await personSearchTool(probe.input, LOCAL);
      const results = (res.results ?? []) as Array<{
        personId?: string;
        score?: number;
        gedcomx?: { persons?: Person[] };
      }>;
      const cards = results.slice(0, 5).map(card);

      // The measurement the plan needs, stated as a number rather than an impression:
      // how many of the top five are distinguishable from each other at all?
      const keys = cards.map((c) =>
        [c.birthDate, c.birthPlace, c.deathDate, c.deathPlace].join("|"),
      );
      const distinct = new Set(keys).size;

      captured.push({
        label: probe.label,
        input: probe.input,
        totalMatches: res.totalMatches,
        pick: res.pick,
        topFive: cards,
        withAnyFact: cards.filter((c) => c.factCount > 0).length,
        withBirthDate: cards.filter((c) => c.birthDate).length,
        withBirthPlace: cards.filter((c) => c.birthPlace).length,
        distinctLifeEventKeys: distinct,
        allIdentical: distinct <= 1,
      });
      process.stderr.write(
        `tied=${res.pick?.tiedAtTop} withAnyFact=${cards.filter((c) => c.factCount > 0).length}/5 ` +
          `distinct=${distinct}/5\n`,
      );
    } catch (err) {
      captured.push({
        label: probe.label,
        input: probe.input,
        error: String((err as Error)?.message ?? err),
      });
      process.stderr.write(`ERROR ${String((err as Error)?.message ?? err).slice(0, 80)}\n`);
    }
  }

  writeFileSync(
    out,
    JSON.stringify({ captured_at: new Date().toISOString().slice(0, 10), probes: captured }, null, 2),
    "utf8",
  );
  process.stderr.write(`\nwrote ${out} (${captured.length} probes)\n`);
}

void main();
