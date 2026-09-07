/**
 * Probe — evidence trail behind the death-like anchor's suppression corollary
 * in docs/specs/person-warnings-tool-spec.md ("Three consequences a reader has
 * to hold", consequence 4) and behind the `hasEventAfterDeath1` cause guidance
 * in packages/engine/plugin/skills/check-warnings/.
 *
 * It exists because a live case was misdiagnosed on hand arithmetic. Issue
 * #2210 came from alpha feedback #2167: a widow's pension filed 11 Jul 1890
 * against a death of 17 Apr 1889 was reported to the tester as a date conflict.
 * The first two readings of that case both assumed `hasEventAfterDeath1` had
 * fired — one arguing it could not (year-only dates, exactly 365 days), one
 * arguing it must (day-precision dates, 450 days). Both were wrong, because
 * both looked at two facts when the person had nine. The tester's William M
 * Nickle also carried a year-only `Burial 1889`, and `Burial` is death-like.
 *
 * Run: cd packages/engine/mcp-server && npx tsx dev/probe-event-after-death-anchor.ts
 *
 * Offline — no token, no network. Every verdict below is derived from the run.
 *
 *   LEG 1 — The naive reading: day-precision death, claim 450 days later, no
 *           burial recorded. Does the tag fire?
 *   LEG 2 — The tester's actual shape: same, plus a year-only `Burial` in the
 *           year of death. This is the leg that refuted both earlier readings.
 *   LEG 3 — Where the boundary actually falls: the same year-only burial, with
 *           the claim moved two calendar years out.
 *   LEG 4 — The issue body's own arithmetic: year-only death against a
 *           year-only claim the following year — exactly 365 days, and the
 *           check is `> 365`.
 */

import { Mob, DEATHLIKE_FACT_TYPES } from "../src/utils/mob.js";
import { factDaysDiffLatestLatest } from "../src/utils/fact-helpers.js";
import { hasEventAfterDeath } from "../src/tools/person-warnings.js";
import type { SimplifiedGedcomX } from "../src/types/gedcomx.js";

interface FactSpec {
  type: string;
  standard_date: string;
}

/** A one-person tree. Only facts matter here — the tag reads self-facts.
 *  Deliberately un-cast: if the simplified shape drifts, this probe should
 *  fail to compile rather than quietly measure the wrong thing. */
function tree(facts: FactSpec[]): SimplifiedGedcomX {
  return {
    persons: [
      {
        id: "I1",
        gender: "Male",
        names: [
          { id: "N1", preferred: true, given: "William", surname: "Nickle" },
        ],
        facts: facts.map((f, i) => ({
          id: `F${i + 1}`,
          type: f.type,
          standard_date: f.standard_date,
        })),
      },
    ],
  };
}

interface Leg {
  n: number;
  label: string;
  facts: FactSpec[];
  /** What the leg is there to establish. */
  asks: string;
}

const DEATH: FactSpec = { type: "Death", standard_date: "17 Apr 1889" };
const BURIAL_YEAR_ONLY: FactSpec = { type: "Burial", standard_date: "1889" };
const CLAIM_1890: FactSpec = { type: "Pension", standard_date: "11 Jul 1890" };
const CLAIM_1891: FactSpec = { type: "Pension", standard_date: "11 Jul 1891" };

const LEGS: Leg[] = [
  {
    n: 1,
    label: "death day-precision + claim 450 days later, NO burial",
    facts: [DEATH, CLAIM_1890],
    asks: "the naive two-fact reading",
  },
  {
    n: 2,
    label: "same + year-only Burial in the death year (the tester's shape)",
    facts: [DEATH, BURIAL_YEAR_ONLY, CLAIM_1890],
    asks: "whether a year-only burial suppresses the tag",
  },
  {
    n: 3,
    label: "year-only Burial, claim moved two calendar years out",
    facts: [DEATH, BURIAL_YEAR_ONLY, CLAIM_1891],
    asks: "where the boundary falls once the anchor has moved",
  },
  {
    n: 4,
    label: "year-only death vs year-only claim the next year",
    facts: [
      { type: "Death", standard_date: "1889" },
      { type: "Pension", standard_date: "1890" },
    ],
    asks: "the issue body's arithmetic: exactly 365 days against a `> 365` check",
  },
];

const results: { leg: Leg; diff: number | null; fires: boolean }[] = [];

for (const leg of LEGS) {
  const mob = new Mob(tree(leg.facts), "I1");
  const diff = factDaysDiffLatestLatest(
    mob,
    DEATHLIKE_FACT_TYPES,
    null,
    null,
    null,
  );
  const fires = hasEventAfterDeath(mob, 365);
  results.push({ leg, diff, fires });

  console.log(`\nLEG ${leg.n} — ${leg.label}`);
  console.log(`  asks: ${leg.asks}`);
  console.log(`  facts: ${leg.facts.map((f) => `${f.type} ${f.standard_date}`).join(" | ")}`);
  console.log(`  latest(any) - latest(death-like) = ${diff} days`);
  console.log(`  hasEventAfterDeath(365) => ${fires}`);
}

// ─── Verdicts, derived from the run above ────────────────────────────────────

const byLeg = new Map(results.map((r) => [r.leg.n, r]));
const l1 = byLeg.get(1)!;
const l2 = byLeg.get(2)!;
const l3 = byLeg.get(3)!;
const l4 = byLeg.get(4)!;

console.log("\n─── VERDICTS ───");

if (l1.fires && !l2.fires) {
  console.log(
    `SUPPRESSION CONFIRMED. Adding a year-only Burial in the year of death took the\n` +
      `  gap from ${l1.diff} to ${l2.diff} days and turned the tag off. A year-only date resolves to\n` +
      `  its late edge (31 Dec), and Burial is death-like, so the anchor moves from the\n` +
      `  death date to 31 Dec of the death year.`,
  );
} else {
  console.log(
    "NOT MEASURED as suppression — legs 1 and 2 did not split. Re-read before citing.",
  );
}

if (!l2.fires && l3.fires) {
  console.log(
    `BOUNDARY: with that anchor, a claim in the calendar year AFTER the death is silent\n` +
      `  (${l2.diff} days) and one two years out fires (${l3.diff} days). So a survivor's claim filed\n` +
      `  the year after a death is exactly the case the tag cannot see — which is the\n` +
      `  case a survivor's-claim cue would be written for.`,
  );
} else {
  console.log("BOUNDARY: NOT MEASURED — legs 2 and 3 did not split.");
}

if (!l4.fires) {
  console.log(
    `YEAR-ONLY PAIR: ${l4.diff} days against a strict \`> 365\`, so it does not fire either.\n` +
      `  The issue body's arithmetic was right about the dates as it stated them; those\n` +
      `  were not the dates in the tree.`,
  );
} else {
  console.log(`YEAR-ONLY PAIR: fired at ${l4.diff} days — the \`> 365\` reading is wrong.`);
}

console.log(
  `\nNet: three of the four shapes are silent. Reaching for this tag to catch a\n` +
    `survivor's claim filed soon after a death is reaching for a check that will\n` +
    `usually not fire, because a same-year burial is ordinary in tree data.`,
);
