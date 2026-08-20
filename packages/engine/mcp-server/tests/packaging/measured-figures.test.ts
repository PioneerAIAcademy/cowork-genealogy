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
  // which is exactly what should never appear in a description whose endpoint has
  // no probe. Without it a stale comma-grouped total could be pasted into the
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
 * figure, and its endpoint has no probe to source one from. What neither list does is
 * make it an EVIDENCE surface, which would invite the figures the 2026-08-17 ruling
 * forbids. So "wording only" describes the SPEC in this list, not both entries.
 *
 * `person_search` hits a different endpoint (`platform/tree/search`) and carries
 * no measured figure, so it must NOT join `EVIDENCE_SURFACES`: doing so would
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
 * reason, because an unexplained entry here is how a wrong number gets a
 * permanent pass.
 */
const EXEMPT = new Map<number, string>([
  [
    14095,
    "disclosed in the spec as measured in the original probe session under a query shape the committed probe does not run",
  ],
  [251867, "same original-session disclosure — the batch-number pair"],
  [31606, "same original-session disclosure — the alternate-surname pair"],
  [
    10730,
    "placed facts across trees — a different investigation entirely, not a qualifier measurement",
  ],
  [9, "facet-aggregation speedup on `m.defaultFacets`, unrelated to the qualifiers"],
  [
    3380,
    "row count of a payload-size measurement in record-search.ts, unrelated to the qualifiers",
  ],
  [
    1478,
    "the HISTORICAL count quoted from issue #1088's transcript, deliberately preserved as the observation being explained rather than as a current measurement",
  ],
  [
    947,
    "the other half of that same #1088 transcript pair (947 -> 1,478); surfaced when the tolerance floor dropped from 2 to 0.5, which stopped it matching section X's current 948 by luck. Historical, like 1478 — not a re-measurement",
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
  const traces = (n: number): boolean => {
    if (EXEMPT.has(n)) return true;
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
        .filter((f) => !traces(f.value))
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
      // Section H states its own prohibition in the verdict string. Honour it
      // literally: while H declines to answer, no surface may claim the thing it
      // names. Six documents said this while H read OPEN.
      verdict: "H.verdict:silence tolerated",
      activeWhen: /^(?:OPEN|STILL OPEN|NOT MEASURED)/,
      mustNotSay:
        /an unqualified range (?:does \*\*not\*\*|does not) require an indexed year|still returned year-silent records|tolerates year-silent records/i,
      why: "H's verdict explicitly says: do not say an unqualified range keeps year-silent records",
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
   * `H.verdict:silence tolerated`, which two specs currently cite. Nothing else
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
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([n]) => n);
    expect(
      unjustified,
      "every EXEMPT entry needs a real reason — an unexplained one is a permanent pass for a wrong number"
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
    const HEAD_EXEMPT = new Map<string, string>([
      [
        "H.verdict:an unqualified range fuzzes past its bounds",
        'template opens with `${fuzzes ? "CONFIRMED" : "NOT CONFIRMED"}` (probe ~line 2208)',
      ],
      [
        "H.verdict:.exact hardens the range",
        'template opens with `${hardens ? "CONFIRMED" : "NOT CONFIRMED"}` (probe ~line 2213)',
      ],
    ]);

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
