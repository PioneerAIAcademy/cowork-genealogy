import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Keeps the qualifier documentation honest about `dev/measured-figures.json`.
 *
 * CI cannot re-measure — the probe needs a live FamilySearch token and several
 * hundred requests — so the artifact is committed and the docs are checked
 * against it. That is the whole reason this file exists.
 *
 * ## Why this replaced a much larger check
 *
 * The first version of this file held 35 hand-written claims, each a regex
 * matching a specific SENTENCE plus the artifact path it was supposed to quote.
 * It ran green at 36/36 while the branch contained a wrong figure in the spec
 * (`442,053 of 456,644` against a recorded `441,206 of 455,763`), an off-by-one
 * county pair repeated in four files, a stale total contradicting the spec's own
 * table three lines away, a `11%` where the artifact said ~28%, and a noise
 * floor cited as `0-2` where the maximum recorded was 1. It caught none of them.
 *
 * The reason is structural, not a missing claim: a claim-first check only covers
 * figures somebody remembered to write a claim FOR. Section F's totals — the
 * headline finding — had no claim at all, so nothing checked them. And because
 * each pattern was keyed to wording chosen by the same author, rewording a
 * sentence silently removed its coverage.
 *
 * So the direction is inverted. Instead of "for each claim, find it in the
 * docs", this is "for each figure in the docs, prove it came from the artifact".
 * A new number cannot slip in unnoticed, because being unrecognised is the
 * failure rather than the default.
 *
 * ## What it deliberately does NOT do
 *
 * It does not check reasoning. Whether a sentence draws the right conclusion
 * from a figure is checked where the measurement is taken: the probe derives
 * every verdict from the run it just did, prints NOT MEASURED rather than a
 * direction when a leg is missing, and refuses to print a claim it cannot
 * support. That check cannot drift from the data because it IS the data.
 */

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, "..", ".."); // packages/engine/mcp-server
const projectRoot = join(mcpRoot, "..", "..", ".."); // repo root
const FIGURES = join(mcpRoot, "dev", "measured-figures.json");

/**
 * Surfaces that MAY carry a precise figure, because they are the evidence
 * trail: a human auditing what was measured reads these.
 */
const EVIDENCE_SURFACES = [
  "docs/specs/record-search-tool-spec-v2.md",
  "packages/engine/mcp-server/src/tools/record-search.ts",
  // The person SPEC, added 2026-08-20. It carries real comma-grouped figures
  // (56,177 / ~9,700 / 2,916 from a 2026-05-28 probe) and was in
  // `WORDING_ONLY_SURFACES` alone — so no traceability check and no total ban, which
  // left the hole this file closed for `person-search.ts` open on the one
  // `person_search` file that actually holds numbers.
  //
  // The 2026-08-17 ruling forbids adding `person-search.ts` — the TOOL file, whose
  // text the model pays for and which the 2026-08-17 ruling keeps figure-free (its
  // tree endpoint IS now probed -- section P -- but its surfaces quote no figure). It says nothing about
  // the spec, which is an evidence trail read by humans. The three figures below
  // predate `measured-figures.json` and are exempted by name; any NEW figure in that
  // spec must now trace.
  "docs/specs/person-search-tool-spec.md",
];

/**
 * Surfaces that may NOT, because they are read by a model deciding what to do.
 * It needs "an unqualified county scope barely narrows", not `35,509` — and a
 * figure here goes stale on every re-run, which is how six documents came to
 * disagree with each other and with the artifact.
 */
const AGENT_SURFACES = [
  // `person-search.ts` is a MODEL-READ surface, so it belongs here even though it
  // is deliberately not an EVIDENCE surface: this list forbids absolute totals,
  // which is exactly what should never appear in a description the ruling keeps
  // figure-free (the endpoint is probed in section P; the surfaces still quote nothing). Without it a stale comma-grouped total could be pasted into the
  // shipped `person_search` description with the whole suite green — the same hole
  // this file closes elsewhere, left open one file over.
  "packages/engine/mcp-server/src/tools/person-search.ts",
  "packages/engine/plugin/skills/search-records/SKILL.md",
  "packages/engine/plugin/skills/search-records/references/name-search-mechanics.md",
  "packages/engine/plugin/skills/search-records/references/place-date-mechanics.md",
  "packages/engine/plugin/skills/search-records/references/search-strategy-levers.md",
  "packages/engine/plugin/skills/search-records/references/collection-quirks.md",
];

/**
 * Scanned for CONTRADICTED WORDING.
 *
 * Note the one overlap, deliberate: `person-search.ts` is ALSO in `AGENT_SURFACES`,
 * which forbids absolute totals — a model-read surface should carry no comma-grouped
 * figure, and its surfaces quote none by the 2026-08-17 ruling (its tree endpoint is
 * now probed in section P). What neither list does is
 * make it an EVIDENCE surface, which would invite the figures the 2026-08-17 ruling
 * forbids. So "wording only" describes the SPEC in this list, not both entries.
 *
 * `person-search.ts` — the TOOL file — hits a different endpoint
 * (`platform/tree/search`) and carries no figure, so it must NOT join
 * `EVIDENCE_SURFACES`: doing so would
 * invite figures onto a surface whose behaviour was established separately, and
 * issue #1409 rules it out explicitly. But it describes the same qualifier family
 * as `record_search`, so a sentence here can contradict a recorded verdict
 * exactly as one there can — and until this list existed, nothing checked that.
 *
 * PR #1699 found the gap by accident and called it what it was: `person_search`'s
 * duplicated schema block "happened to still match its tool. That was luck — no
 * wording rule in tests/packaging/measured-figures.test.ts covers either
 * person_search surface."
 *
 * Verified before this list existed: a sentence reading "an unqualified range
 * tolerates year-silent records" could be added to person-search.ts and the whole
 * file stayed green, while the same sentence in record-search.ts failed.
 */
const WORDING_ONLY_SURFACES = [
  "packages/engine/mcp-server/src/tools/person-search.ts",
  "docs/specs/person-search-tool-spec.md",
];

/**
 * A "precise figure": a comma-grouped integer, or an `N×` / `N-fold` ratio.
 *
 * Bare percentages are deliberately NOT matched. They are the most rounded
 * thing in the docs, and small ones (`0%`, `100%`) coincide with some artifact
 * value by chance — which would make this check pass for the wrong reason.
 * Years and issue numbers carry no separator and are excluded for free.
 */
const FIGURE = new RegExp(
  [
    // Comma-grouped totals — the drifting kind.
    String.raw`\b\d{1,3}(?:,\d{3})+\b`,
    // Ratios.
    // `x` as well as `×`: record-search.ts writes ratios ASCII (`799x`, `172x`),
    // and that file is an EVIDENCE surface, so editing `799x` to any value left
    // the suite green.
    String.raw`\b\d+(?:×|x\b|-fold\b)`,
    // Sub-1,000 figures in the three shapes this repo states them in. Matching
    // every bare integer would flag years, list numbers and ordinary prose, which
    // is why the first version of this pattern required a comma group — but that
    // left section B's entire headline table (`469 -> 423`, "54 records, the
    // largest by 34 positions", "rank 103") completely unchecked, which is the
    // same hole the header of this file says it closed for section F. Two digits
    // minimum, so "-> 0" and "rank 1" stay out.
    String.raw`(?<=(?:→|->)\s{0,3})\d{2,4}\b`,
    String.raw`\b\d{2,4}(?=\s{0,3}(?:→|->))`,
    String.raw`(?<=\brank\s)\d{2,4}\b`,
    String.raw`\d{2,4}(?=\s+positions\b)`,
  ].join("|"),
  "g"
);

/**
 * Absolute totals only — the drifting kind.
 *
 * Agent surfaces are held to this rather than to FIGURE, because a RATIO is the
 * stable, transferable part of a measurement: "the count fell roughly 800-fold"
 * stays true across runs and tells the reader something they can act on, while
 * "18,515,786" is a snapshot that is wrong by the next morning. The levers doc
 * makes the same distinction in prose — the ratios are the finding, not the
 * digits — so banning totals while allowing ratios is the rule that matches it.
 */
const ABSOLUTE_TOTAL = /\b\d{1,3}(?:,\d{3})+\b/g;

/**
 * Figures that are real but provably NOT from this artifact. Each needs a
 * `reason`, because an unexplained entry here is how a wrong number gets a
 * permanent pass.
 *
 * `scope` (optional) names the surfaces the exemption is granted FOR. `traces`
 * runs per surface and this map is keyed by VALUE, so without a scope an
 * exemption written for one document silently excuses the same number in every
 * other — a stale `56,177` pasted into the record-side spec would trace for free
 * on a reason naming the person-side probe. Omit `scope` for a figure that
 * genuinely appears in more than one place (`9` does, in three): absent means
 * every surface, the historical default. `reason` and `scope` live on one entry
 * so the pair cannot drift out of sync; each scope was placed by tokenising every
 * figure on the four surfaces and testing membership, not by reading the reasons.
 */
const EXEMPT = new Map<number, { reason: string; scope?: readonly string[] }>([
  [
    14095,
    {
      reason: "disclosed in the spec as measured in the original probe session under a query shape the committed probe does not run",
      scope: ["docs/specs/record-search-tool-spec-v2.md"],
    },
  ],
  [
    251867,
    {
      reason: "same original-session disclosure — the batch-number pair",
      scope: ["docs/specs/record-search-tool-spec-v2.md"],
    },
  ],
  [
    31606,
    {
      reason: "same original-session disclosure — the alternate-surname pair",
      scope: ["docs/specs/record-search-tool-spec-v2.md"],
    },
  ],
  [
    10730,
    {
      reason: "placed facts across trees — a different investigation entirely, not a qualifier measurement",
      scope: ["docs/specs/record-search-tool-spec-v2.md"],
    },
  ],
  [
    9,
    { reason: "facet-aggregation speedup on `m.defaultFacets`, unrelated to the qualifiers" },
  ],
  [
    3380,
    {
      reason: "row count of a payload-size measurement in record-search.ts, unrelated to the qualifiers",
      scope: ["packages/engine/mcp-server/src/tools/record-search.ts"],
    },
  ],
  [
    1478,
    {
      reason: "the HISTORICAL count quoted from issue #1088's transcript, deliberately preserved as the observation being explained rather than as a current measurement",
      scope: ["packages/engine/mcp-server/src/tools/record-search.ts"],
    },
  ],
  [
    1100,
    {
      reason: "the Brazil/Lapa/1880 pool that made the surname empty-field leg provable, from dev/explore-name-empty-field-leg-records.ts on 2026-08-20 — a session script, not a probe section, so no verdict records it; re-run the script to check it",
      scope: ["docs/specs/record-search-tool-spec-v2.md"],
    },
  ],
  [
    56177,
    {
      reason: "person_search spec, from a 2026-05-28 session probe that predates this artifact AND left no committed script — see that spec's Evidence note: the unqualified `surname=Lincoln` pool, quoted twice to show the require-switch has no effect without it",
      scope: ["docs/specs/person-search-tool-spec.md"],
    },
  ],
  [
    9700,
    {
      reason: "same 2026-05-28 probe — the gibberish-surname pool, quoted as `~9,700` to make the surname-plus-one rule's case",
      scope: ["docs/specs/person-search-tool-spec.md"],
    },
  ],
  [
    2916,
    {
      reason: "same 2026-05-28 probe — the same query WITH `m.queryRequireDefault=on`, which is the contrast the 56,177 figure exists for",
      scope: ["docs/specs/person-search-tool-spec.md"],
    },
  ],
  [
    947,
    {
      reason: "the other half of that same #1088 transcript pair (947 -> 1,478); surfaced when the tolerance floor dropped from 2 to 0.5, which stopped it matching section X's current 948 by luck. Historical, like 1478 — not a re-measurement",
      scope: ["packages/engine/mcp-server/src/tools/record-search.ts"],
    },
  ],
]);

/** Documented API limits, not measurements — allowed on agent surfaces. */
const API_LIMITS = new Set([4999, 5000]);

/**
 * Resolve `"<section>.<key>"`, splitting on the FIRST dot only.
 *
 * Verdict keys contain dots and colons of their own
 * (`R.verdict:retention equals the silent share`), so a naive `split(".")`
 * would look for a nested object that does not exist and silently return
 * undefined — which a consistency check would then read as "no conflict".
 */
function get(fig: Record<string, unknown>, path: string): unknown {
  const dot = path.indexOf(".");
  if (dot < 0) return fig[path];
  const section = fig[path.slice(0, dot)];
  if (section === null || typeof section !== "object") return undefined;
  return (section as Record<string, unknown>)[path.slice(dot + 1)];
}

/** Every numeric value anywhere in the artifact. */
function artifactValues(node: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof node === "number" && Number.isFinite(node)) out.add(node);
  else if (Array.isArray(node)) for (const v of node) artifactValues(v, out);
  else if (node && typeof node === "object")
    for (const v of Object.values(node)) artifactValues(v, out);
  return out;
}

/**
 * Figures the docs legitimately COMPUTE from recorded values, with the formula
 * written out so it is checked against the artifact rather than trusted. A
 * derived figure that stops matching means either the prose or the derivation
 * is wrong — both worth failing on.
 */
interface Derived {
  label: string;
  why: string;
  compute: (fig: Record<string, never>) => number | null;
}
const DERIVED: Derived[] = [];

function collectFigures(
  text: string,
  pattern: RegExp = FIGURE
): Array<{ raw: string; value: number }> {
  const out: Array<{ raw: string; value: number }> = [];
  for (const m of text.matchAll(pattern)) {
    const raw = m[0];
    const value = Number(raw.replace(/[^\d]/g, ""));
    if (Number.isFinite(value)) out.push({ raw, value });
  }
  return out;
}

describe("measured figures stay traceable to the probe artifact", () => {
  it("has a committed artifact to check against", () => {
    expect(
      existsSync(FIGURES),
      "dev/measured-figures.json is missing — run `npx tsx dev/probe-search-qualifiers.ts` and commit it"
    ).toBe(true);
  });

  const fig = existsSync(FIGURES)
    ? (JSON.parse(readFileSync(FIGURES, "utf8")) as Record<string, never>)
    : ({} as Record<string, never>);
  const recorded = artifactValues(fig);
  const derived = new Set(
    DERIVED.map((d) => d.compute(fig)).filter((n): n is number => n !== null)
  );

  /**
   * Live totals drift between runs, so match on magnitude — but only just.
   *
   * The band is set from measured drift, not guessed. Repeating the same probe
   * sections minutes apart moved an 11.4M total by 28, an 11.3M total by 41 and
   * an 86.6M total by 183 — all around 0.0003% — while the county totals did not
   * move at all. 0.1% is therefore ~300x the observed drift and still tight
   * enough to matter.
   *
   * That last part is the whole point, and it was nearly got wrong: at the 1%
   * this check was first written with, the defect that motivated replacing the
   * old guard — the spec citing `442,053 of 456,644` against a recorded
   * `441,206 of 455,763` — sails through, because 847 is well inside 1% of
   * 441,206. At 0.1% it fails, which is the behaviour worth having.
   *
   * KNOWN LIMIT, stated so nobody assumes otherwise: this cannot separate a
   * stale figure from genuine drift below 0.1%. A months-old total on an 18M
   * pool can sit within the band and pass. That is accepted — a difference that
   * small changes no reader's decision, and tightening further would fail on
   * honest re-runs, which is how a check gets deleted.
   */
  const DRIFT = 0.001;
  const traces = (n: number, rel: string): boolean => {
    const exemption = EXEMPT.get(n);
    if (exemption !== undefined) {
      const scope = exemption.scope;
      // Out of scope falls THROUGH to the artifact check rather than passing.
      if (scope === undefined || scope.includes(rel)) return true;
    }
    for (const v of [...recorded, ...derived]) {
      // Relative only, with a floor small enough that it cannot bridge two
    // genuinely different small numbers. The old floor was 2, which let `100×`
    // trace to an unrelated 99.1 and `3×` to an unrelated 1 — passing for the
    // wrong reason, which is worse than failing. Rounded large figures still
    // pass on the relative term (441,000 against 441,205 is 0.05%).
    if (Math.abs(n - v) <= Math.max(0.5, Math.abs(v) * DRIFT)) return true;
    }
    return false;
  };

  for (const rel of EVIDENCE_SURFACES) {
    it(`every precise figure in ${rel} traces to the artifact`, () => {
      const text = readFileSync(join(projectRoot, rel), "utf8");
      const orphans = collectFigures(text)
        .filter((f) => !traces(f.value, rel))
        .map((f) => f.raw);
      expect(
        [...new Set(orphans)],
        `these figures appear in the prose but match nothing the probe recorded.\n` +
          `  Either the figure is wrong, or the probe section needs re-running and\n` +
          `  dev/measured-figures.json committing, or — if it genuinely comes from\n` +
          `  somewhere else — add it to EXEMPT with the reason.`
      ).toEqual([]);
    });
  }

  for (const rel of AGENT_SURFACES) {
    it(`${rel} carries no absolute totals`, () => {
      const text = readFileSync(join(projectRoot, rel), "utf8");
      const found = collectFigures(text, ABSOLUTE_TOTAL)
        .filter((f) => !API_LIMITS.has(f.value))
        .map((f) => f.raw);
      expect(
        [...new Set(found)],
        `an agent-facing document should describe the BEHAVIOUR, not quote a total.\n` +
          `  These figures drift on every re-run, and six documents quoting the same\n` +
          `  number is how they came to disagree with each other and with the probe.\n` +
          `  Round it ("tens of thousands", "about a twentieth"), or move the precise\n` +
          `  value into the spec, which is the evidence trail.`
      ).toEqual([]);
    });
  }

  /**
   * Two sections must not record opposite answers to the same question.
   *
   * This is not hypothetical. The artifact simultaneously held
   * `R.verdict:retention tracks how often the relative is indexed → True` and
   * `S.verdict:retention tracks the indexed share → REFUTED`, and
   * `T.verdict:fatherGivenName → RANKS ONLY` against an enumerated result
   * showing it filters. Anyone grepping the artifact got whichever answer they
   * happened to hit first, and nothing complained — the traceability check above
   * reads figures quoted in prose, and has no opinion about the artifact
   * disagreeing with itself.
   *
   * Pairs are matched on the QUESTION, not on wording, because the wording is
   * exactly what drifts. A verdict withheld under RULE 0 ("NOT MEASURED…")
   * conflicts with nothing — declining to answer is always compatible.
   */
  const CONTRADICTION_PAIRS: Array<{ question: string; a: string; b: string }> = [
    {
      question: "does retention under an unmatchable relative name track how often that relative is indexed?",
      a: "R.verdict:retention equals the silent share",
      b: "S.verdict:retention tracks the indexed share",
    },
    {
      // #1771 step 4. After the year rename H and N record the same question, from
      // the same band instrument — H owns the birth pool, N reads H's result — so
      // they must agree.
      question: "does an unqualified range match records by estimate overlap, beyond those dated inside it?",
      a: "H.verdict:an unqualified range admits estimate overlaps",
      b: "N.verdict:an unqualified range admits estimate overlaps",
    },
  ];

  /** Which way a verdict points, or null when it declines to answer. */
  function polarityOf(v: unknown): boolean | null {
    if (typeof v === "boolean") return v;
    const s = String(v).toUpperCase();
    if (/NOT MEASURED|STILL OPEN|^OPEN\b|INCONCLUSIVE|NOT MEASURABLE/.test(s)) return null;
    if (/\bREFUTED\b|DOES NOT HOLD|NOT CONFIRMED|\bNO —|^NO\b/.test(s)) return false;
    if (/\bHOLDS\b|CONFIRMED|^YES\b|\bYES —/.test(s)) return true;
    return null;
  }

  for (const pair of CONTRADICTION_PAIRS) {
    it(`sections agree: ${pair.question}`, () => {
      const av = polarityOf(get(fig, pair.a));
      const bv = polarityOf(get(fig, pair.b));
      const clash = av !== null && bv !== null && av !== bv;
      expect(
        clash ? [`${pair.a} = ${av}`, `${pair.b} = ${bv}`] : [],
        `two sections record OPPOSITE answers to the same question.\n` +
          `  Re-run whichever section is measuring it badly, or withhold its verdict\n` +
          `  under RULE 0 — a withheld verdict conflicts with nothing. Do NOT hand-edit\n` +
          `  measured-figures.json to make them agree: it is generated output, and\n` +
          `  editing it would make the artifact say something no run produced.`
      ).toEqual([]);
    });
  }

  /**
   * Prose must not assert the negation of a recorded verdict.
   *
   * This is the hole that mattered. The traceability check above proves a NUMBER
   * came from the artifact; nothing proved a SENTENCE still agreed with it. When
   * section B was re-measured over complete sets and recorded that `.exact`
   * reorders the records it keeps, eleven passages across the spec, SKILL.md,
   * three reference docs and the shipped tool descriptions went on asserting "no
   * effect on ranking was detectable" — and the suite stayed green, because
   * every figure in them still traced.
   *
   * Each rule names a verdict key, the value that makes the rule active, and a
   * pattern that must then NOT appear. Keep the patterns narrow: this fires on
   * WORDING, so a loose one turns into noise the next person silences.
   */
  const FORBIDDEN_WHEN: Array<{
    verdict: string;
    activeWhen: RegExp;
    mustNotSay: RegExp;
    why: string;
  }> = [
    {
      verdict: "B.verdict:exact reorders the shared records",
      activeWhen: /^YES/,
      mustNotSay:
        /no (?:effect on )?(?:ranking|re-?ordering)[^.]{0,40}(?:detectable|was detected)|no effect on which records rank first|not measured to change \*?which\*? records rank first/i,
      why: "section B measured reordering over complete sets; these phrasings deny it",
    },
    {
      verdict: "R.verdict:drop-contradicting",
      activeWhen: /^HOLDS/,
      mustNotSay: /drop-contradicting (?:does not hold|is refuted)/i,
      why: "R enumerated it and it holds",
    },
    {
      // Added after the THIRD round of doc edits on one claim. Section Y's
      // roll-up read DOES NOT GENERALISE, then GENERALISES, then NOT MEASURED
      // inside one afternoon, and prose written at each step survived into the
      // next — because nothing tied a sentence to the verdict's *existence*,
      // only to its polarity once stated. A withheld verdict supports nothing,
      // and "measured across four families" is the exact sentence that outlived
      // two reversals.
      verdict: "Y.verdict:generalises past birth (impossible-range)",
      activeWhen: /^(?:NOT MEASURED|PARTIAL|DOES NOT GENERALISE)/,
      mustNotSay:
        /measured on the (?:birth, )?death, marriage and residence families|the year toggle's behaviour,? not birth's alone|treat it as how the year toggle works/i,
      why: "section Y withholds the generalisation; these phrasings assert it as measured",
    },
    {
      // #1771 step 4. Repointed from the retired `H.verdict:silence tolerated`.
      // The band instrument measures index-silent personas at ZERO, so this reads
      // NO. The rule FAILS CLOSED: `/^NO/` matches the measured "NO —" and also
      // "NOT MEASURED", so it stays active whenever the measurement is absent
      // rather than implying it tracks a measured negative. `mustNotSay` is the OLD
      // vocabulary, so the rule now guards against reintroducing the disproven
      // "year-silent records" story from stale memory or an old doc.
      verdict: "H.verdict:index-silent personas exist",
      activeWhen: /^NO/,
      mustNotSay:
        /tolerates year-silent records|keeps (?:year-silent|undated) records|tolerates silence/i,
      why: "the index places every persona in time; do not say an unqualified range keeps year-silent/undated records",
    },
  ];

  for (const rule of FORBIDDEN_WHEN) {
    it(`prose does not contradict ${rule.verdict}`, () => {
      const recorded = String(get(fig, rule.verdict) ?? "");
      if (!rule.activeWhen.test(recorded)) return; // rule inactive for this run
      const offenders: string[] = [];
      // Deduped: `person-search.ts` is in both AGENT_SURFACES (no absolute totals)
      // and WORDING_ONLY_SURFACES (contradicted wording), so without this it is read
      // twice and any offending line is reported twice in the failure message.
      for (const rel of new Set([...EVIDENCE_SURFACES, ...AGENT_SURFACES, ...WORDING_ONLY_SURFACES])) {
        const text = readFileSync(join(projectRoot, rel), "utf8");
        for (const line of text.split("\n")) {
          if (rule.mustNotSay.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 110)}`);
        }
      }
      expect(
        offenders,
        `prose asserts the negation of a recorded verdict.\n` +
          `  ${rule.verdict} = ${recorded.slice(0, 120)}\n` +
          `  ${rule.why}\n` +
          `  Update the prose, or re-run the section if the behaviour changed.\n` +
          `  Do NOT relax the pattern to make this pass, and do NOT reword around\n` +
          `  it. When a recorded measurement disagrees with what you believe is true,\n` +
          `  re-probe until the two agree (CLAUDE.md, "A measurement that disagrees\n` +
          `  with belief is re-measured, not reworded"). A verdict stuck at OPEN or\n` +
          `  NOT MEASURED is a measurement-design task, not a re-run.`
      ).toEqual([]);
    });
  }

  /**
   * Every rule above must actually BIND to something in the artifact.
   *
   * `get()` returns `undefined` for a key that is not there, `String(undefined ??
   * "")` is `""`, and no `activeWhen` pattern matches the empty string — so a
   * rule whose verdict key was renamed or deleted returns early at the
   * `activeWhen` check and its `it` PASSES. The rule is gone and the suite is
   * green. Nothing above notices: the traceability checks read figures quoted in
   * prose, and the producibility check only inspects keys that are present.
   *
   * Verified before this test existed: renaming `H.verdict:silence tolerated` in
   * the artifact left the whole file at 15/15, and the producibility check missed
   * it too, because the renamed key still starts with `verdict:` and its value was
   * unchanged.
   *
   * This matters right now. The year sections are being rewritten around indexed
   * date RANGES (issue #1771), which deletes the estimator block that emits
   * `H.verdict:silence tolerated` (probe:2463 and probe:2744) and renames several
   * other keys. Without this test, that rewrite silently removes two of the four
   * wording guards — including the pair this whole investigation is organised
   * around — and no suite anywhere goes red.
   *
   * A missing grant fails loudly; a missing DENY fails open and silently. Same
   * shape as the agent-tool deny rule in CLAUDE.md, and the same reason it needs
   * its own check.
   */
  it("every wording rule and contradiction pair binds to a key that exists", () => {
    const dangling: string[] = [];
    for (const rule of FORBIDDEN_WHEN) {
      const v = get(fig, rule.verdict);
      if (v === undefined || String(v).trim() === "") {
        dangling.push(`FORBIDDEN_WHEN -> ${rule.verdict}`);
      }
    }
    for (const pair of CONTRADICTION_PAIRS) {
      for (const path of [pair.a, pair.b]) {
        const v = get(fig, path);
        if (v === undefined || String(v).trim() === "") {
          dangling.push(`CONTRADICTION_PAIRS -> ${path}`);
        }
      }
    }
    expect(
      dangling,
      `a rule names a verdict key that is not in dev/measured-figures.json.\n` +
        `  Such a rule is INERT: the key resolves to undefined, no activeWhen\n` +
        `  pattern matches "", and its test passes while guarding nothing.\n` +
        `  Either the probe section was renamed/deleted without updating the rule\n` +
        `  (fix the rule in the SAME commit as the rename), or the section has not\n` +
        `  been run since the key was introduced (run it).\n` +
        `  Do NOT delete the rule to make this pass unless the claim it forbids is\n` +
        `  also gone from every surface it scans.`
    ).toEqual([]);
  });

  /**
   * Prose that NAMES a verdict key must name one that exists.
   *
   * The dangling-key test above covers the other direction — a `FORBIDDEN_WHEN`
   * rule pointing at a missing key. This covers prose: a spec sentence that cites
   * `F.verdict:relative .exact requires the relative to be present` as its
   * evidence is worthless the moment that key is renamed, and worse than
   * worthless, because it still reads as sourced.
   *
   * This is not speculative. Issue #1771 rewrites the year sections around indexed
   * date RANGES and renames several keys by name, including
   * `H.verdict:silence tolerated` -> `H.verdict:index-silent personas exist`, which
   * two specs cited (updated to the new key in the same PR). Nothing else
   * here would notice: the traceability check reads FIGURES, the wording rules read
   * sentences, and the producibility check reads the artifact against the probe —
   * none of them reads a citation.
   *
   * WHITESPACE IS THE TRAP. These keys are long enough to wrap inside a markdown
   * inline-code span, so a naive per-line regex reports a real key as dangling —
   * the first draft of this check did exactly that on
   * `R.verdict:spouse .exact requires the spouse to be present`. Normalise runs of
   * whitespace on BOTH sides before comparing. That is the same "a grep is wrong in
   * both directions" hazard CLAUDE.md describes for the encoding lint.
   *
   * Scoped to `verdict:` keys, deliberately. Data keys (`B.rows`, `I.fuzzy`) are
   * cited far less often and get renamed as a matter of course; a verdict is a
   * claim, and a claim is what prose leans on.
   */
  it("prose cites verdict keys that exist in the artifact", () => {
    const CITING_SURFACES = [
      ...EVIDENCE_SURFACES,
      ...WORDING_ONLY_SURFACES,
      "docs/specs/person-search-tool-spec.md",
    ];
    const known = new Set<string>();
    for (const [section, body] of Object.entries(fig)) {
      if (!body || typeof body !== "object") continue;
      for (const key of Object.keys(body as Record<string, unknown>)) {
        // Normalised on BOTH sides, as the docstring says. Building `known` from
        // raw keys passes today only because every artifact key happens to hold
        // single spaces; one emitted with a newline or a double space would make
        // every real citation of it report as dangling.
        if (key.startsWith("verdict:")) known.add(`${section}.${key}`.replace(/\s+/g, " "));
      }
    }
    // `H.verdict:…` up to the closing backtick, with whitespace collapsed first so
    // a key wrapped across two lines still matches its artifact form.
    // `[A-Z][A-Z0-9]?` not `[A-Z]`: every section today is one letter, so a
    // single-letter pattern passes — but #1771 adds and renames sections, and a
    // two-character one would have its citations skipped silently while the
    // `cited > 0` guard below stayed green on the remaining single-letter ones.
    const CITE = /`([A-Z][A-Z0-9]?)\.(verdict:[^`]+)`/g;
    const dangling: string[] = [];
    let cited = 0;
    for (const rel of new Set(CITING_SURFACES)) {
      const text = readFileSync(join(projectRoot, rel), "utf8").replace(/\s+/g, " ");
      for (const m of text.matchAll(CITE)) {
        cited++;
        const key = `${m[1]}.${m[2]}`.trim();
        if (!known.has(key)) dangling.push(`${rel} cites ${key}`);
      }
    }
    expect(
      cited,
      "no prose cites a verdict key by name — either the citations were removed, or " +
        "this check's pattern no longer matches how they are written"
    ).toBeGreaterThan(0);
    expect(
      dangling,
      `prose names a verdict key that is not in dev/measured-figures.json.\n` +
        `  The sentence still reads as sourced while its source is gone. Either the\n` +
        `  probe section was renamed (update the citation in the SAME commit), or the\n` +
        `  section has not been run since the key was introduced (run it).\n` +
        `  Do NOT delete the citation to make this pass unless the claim goes with it.`
    ).toEqual([]);
  });

  it("the exemption list stays justified", () => {
    const unjustified = [...EXEMPT.entries()]
      .filter(([, { reason }]) => reason.trim().length < 20)
      .map(([n]) => n);
    expect(
      unjustified,
      "every EXEMPT entry needs a real reason — an unexplained one is a permanent pass for a wrong number"
    ).toEqual([]);
  });

  it("no surface is classified both evidence and agent", () => {
    // The three surface arrays are hand-maintained and nothing else checks they
    // stay consistent. EVIDENCE_SURFACES MAY carry precise figures; AGENT_SURFACES
    // may NOT carry absolute totals — contradictory rules, so a surface in both
    // would be checked twice with the outcome depending on loop order. That overlap
    // is never legitimate. (`person-search.ts` in AGENT + WORDING_ONLY, and the
    // person spec in EVIDENCE + WORDING_ONLY, are the DELIBERATE overlaps —
    // WORDING_ONLY is orthogonal to the figure rules and so is excluded here.)
    const both = EVIDENCE_SURFACES.filter((s) => AGENT_SURFACES.includes(s));
    expect(
      both,
      "a surface is in both EVIDENCE_SURFACES and AGENT_SURFACES, which permit and " +
        "forbid figures respectively — put it in exactly one."
    ).toEqual([]);
  });
});

/**
 * Every recorded verdict must still be PRODUCIBLE by the probe.
 *
 * The artifact is generated output, but it is generated one section at a time —
 * `npx tsx dev/probe-search-qualifiers.ts N` rewrites N and leaves the rest.
 * So a section whose verdict WORDING is rewritten, and which is then not re-run,
 * leaves the old string sitting in the artifact looking exactly as authoritative
 * as a fresh one. Nothing else here notices: the traceability checks read
 * figures quoted in prose, and FORBIDDEN_WHEN only covers verdicts someone
 * thought to write a rule for.
 *
 * That is not hypothetical. Section I shipped
 * `"CONFIRMED — fuzzy returns the transposition, exact does not"` while the code
 * could only emit `"SAMPLED ONLY — …"` or `"NOT CONFIRMED"`, because the section
 * was hardened for RULE 0 and never re-run. Three documents asserted the
 * withdrawn claim, one of them recommending a query parameter on the strength of
 * it, and every suite was green.
 *
 * The check: reduce a verdict to its longest run of non-numeric text and require
 * that run to appear in the probe source. Digits are what interpolation
 * substitutes, so removing them leaves the literal skeleton the template must
 * still contain. Both sides are normalised so that a template split across
 * string concatenation still matches the single line it produces.
 */
/**
 * The empty-field asymmetry is stated on four shipped surfaces and backed by NO
 * artifact key.
 *
 * `dev/explore-name-empty-field-leg-records.ts` measures it but never calls
 * `record()`, so there is no `verdict:` to trace against;
 * `T.verdict:all name fields behave alike` still reads NOT MEASURED. That means the
 * three guards above — traceability, contradiction pairs, dangling keys — cannot see
 * this claim at all: every one of them starts from a recorded verdict. The suite
 * would stay green while all four surfaces told the model the opposite of the truth.
 *
 * Promoting the script into a probe section is the real fix and belongs to #1771
 * (its own docblock says so). Until then this is what is checkable without a verdict:
 *
 *   1. All four surfaces state BOTH halves. Drift between surfaces is the exact
 *      defect class that produced three findings in one review round on this PR —
 *      a skill file, a spec table and a tool description each disagreeing with the
 *      others about the same rule.
 *   2. The script that is the claim's only evidence still exists and still prints
 *      both verdict strings, so it cannot be quietly deleted or reworded out from
 *      under four surfaces that depend on it.
 *
 * It cannot check the claim against FamilySearch. Nothing here can, which is the
 * point of recording the gap rather than leaving it invisible.
 */
describe("the unbacked empty-field asymmetry stays consistent", () => {
  const SURFACES = [
    "packages/engine/mcp-server/src/tools/record-search.ts",
    "packages/engine/mcp-server/src/tools/person-search.ts",
    "docs/specs/record-search-tool-spec-v2.md",
    "docs/specs/person-search-tool-spec.md",
  ];
  const SCRIPT = "packages/engine/mcp-server/dev/explore-name-empty-field-leg-records.ts";

  /** Join TS string concatenation and strip blockquote markers, then flatten. */
  const flatten = (text: string): string =>
    text
      .replace(/"\s*\+\s*\n\s*"/g, "")
      .split("\n")
      .map((l) => l.replace(/^\s*>\s?/, ""))
      .join("\n")
      .replace(/\s+/g, " ");

  const KEEPS =
    /that field is (?:empty|EMPTY)\*{0,2} — for `givenName` and for a father's, mother's, parent's or spouse's name/;
  const DROPS =
    /but \*{0,2}(?:not|NOT)\*{0,2} for `surname`, where an unqualified value drops surname-empty/;

  it("every surface states both halves of the asymmetry", () => {
    const missing: string[] = [];
    for (const rel of SURFACES) {
      const flat = flatten(readFileSync(join(projectRoot, rel), "utf8"));
      if (!KEEPS.test(flat)) missing.push(`${rel}: the KEEPS half (givenName + the four relatives)`);
      if (!DROPS.test(flat)) missing.push(`${rel}: the DROPS half (surname)`);
    }
    expect(
      missing,
      "no artifact key backs this claim, so cross-surface agreement is the only guard it has.\n" +
        "  A surface that drops or reverses a half is how three findings in one review round\n" +
        "  came about. If you changed the wording deliberately, update the regexes here in the\n" +
        "  same commit — and if the CLAIM changed, the four surfaces and the script all move."
    ).toEqual([]);
  });

  it("the script that is its only evidence still prints both verdicts", () => {
    const src = readFileSync(join(projectRoot, SCRIPT), "utf8");
    const expected = [
      "unqualified KEEPS records with no typed Given part",
      "unqualified DROPS surname-empty records",
    ];
    expect(
      expected.filter((v) => !src.includes(v)),
      `${SCRIPT} is the only evidence for a claim on four shipped surfaces. ` +
        "If its verdict strings changed, the surfaces quoting it need to change too."
    ).toEqual([]);
  });
});

describe("recorded verdicts are still producible by the probe", () => {
  const PROBE = join(mcpRoot, "dev", "probe-search-qualifiers.ts");

  /** Collapse quoting, concatenation and interpolation into comparable text. */
  const normalise = (s: string): string =>
    s
      // `${…}`, including one level of nested braces, is where the digits go.
      .replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, " ")
      .replace(/["`+]/g, " ")
      // Digits go too, on BOTH sides. A head often opens with an interpolated
      // count ("YES — 54 record(s) move"), which the source spells `${n}`; with
      // digits stripped from each side the two heads line up, and the words that
      // carry the polarity are what actually get compared.
      // Thousands separators go with the digits: "357,893" is `${fmt(n)}` in
      // the source, so a surviving comma would misalign the two heads.
      .replace(/[\d,]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  it("every verdict: value has a literal counterpart in the probe source", () => {
    if (!existsSync(FIGURES) || !existsSync(PROBE)) return;
    const fig = JSON.parse(readFileSync(FIGURES, "utf8")) as Record<string, unknown>;
    const probe = normalise(readFileSync(PROBE, "utf8"));

    // Match the HEAD of the verdict, where its polarity lives.
    //
    // Two weaker designs were tried and both failed on the real case:
    //   - split on digits, require the longest chunk: interpolation is not only
    //     numeric (`${fam.family}` inserts "birth"), so it flagged eight
    //     verdicts whose text is demonstrably in the source.
    //   - any 32-char window anywhere: the superseded section-I verdict shares
    //     the phrase "fuzzy returns the transposition" with its replacement, so
    //     a stale CONFIRMED passed while the code could only emit SAMPLED ONLY.
    //     Verified by injecting that exact string.
    //
    // The head is the discriminating part — CONFIRMED / SAMPLED ONLY / NOT
    // MEASURED / HOLDS / REFUTED all sit there, and it is almost always literal
    // because a template rarely opens with a substitution. A verdict whose head
    // is not in the source is one the probe cannot currently open with.
    /**
     * Verdicts whose template OPENS with a substitution, so the polarity word is
     * not literal in the source:
     *
     *     `${fuzzes ? "CONFIRMED" : "NOT CONFIRMED"} (SAMPLED — ...`
     *
     * The head then reads `(SAMPLED —` in the source and `CONFIRMED (SAMPLED —`
     * in the artifact, which no amount of normalising reconciles without also
     * blinding the check to the rot it exists for. Two entries, both verified by
     * reading the record() call; anything added here needs the same.
     */
    // Empty since #1771 step 4: both former entries were section-H year verdicts
    // whose templates opened with a `${cond ? "..." : "..."}` head. Section H was
    // rebuilt around the band instrument and its verdicts now open with a LITERAL
    // directional word ("YES — ", "NO — "), so none needs a head exemption. A new
    // entry here needs the same justification the old ones had — read the record()
    // call and confirm the template opens with a substitution.
    const HEAD_EXEMPT = new Map<string, string>([]);

    const HEAD = 28;
    const orphans: string[] = [];
    const producible = (v: string): boolean => {
      const s = normalise(v);
      if (s.length < HEAD) return true; // too short to judge
      return probe.includes(s.slice(0, HEAD));
    };

    for (const [section, body] of Object.entries(fig)) {
      if (!body || typeof body !== "object") continue;
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        if (!key.startsWith("verdict:") || typeof value !== "string") continue;
        if (HEAD_EXEMPT.has(`${section}.${key}`)) continue;
        if (!producible(value)) {
          orphans.push(`${section}.${key} -> ${JSON.stringify(value.slice(0, 80))}`);
        }
      }
    }

    expect(
      orphans,
      "these recorded verdicts cannot be produced by the probe as it stands.\n" +
        "  Almost always: the section's wording was changed and the section was not\n" +
        "  re-run, so the artifact still holds the SUPERSEDED verdict — and any prose\n" +
        "  resting on it is asserting something the probe would now refuse to publish.\n" +
        "  Re-run that section (`npx tsx dev/probe-search-qualifiers.ts <SECTION>`).\n" +
        "  Do NOT hand-edit measured-figures.json: it is generated output, and editing\n" +
        "  it would make the artifact say something no run produced."
    ).toEqual([]);
  });
});
