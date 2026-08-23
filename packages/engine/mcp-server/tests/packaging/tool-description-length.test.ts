import { describe, expect, it } from "vitest";
import { allToolSchemas } from "../../src/tool-schemas.js";

/**
 * Keeps the `*Exact` qualifier family from drifting back into paragraphs.
 *
 * The family had grown to the point where `record_search` shipped about 15,500
 * characters of description — roughly four times `person_search`'s — with six
 * `*Exact` toggles over the then-ceiling of 240 characters, and one at 475. The
 * corpus says the family is barely used: across every committed run log only four
 * of the 43 toggles have EVER appeared in a call.
 *
 * **The justification is clarity; the token saving is small.** Measured after the
 * #1409 rewrite and #1771's year-clause edit: `record_search` 15,509 -> 13,996 and
 * `person_search` 3,745 -> 4,996 (its toggles were stubs that were also wrong, so
 * correctness cost tokens there), for a combined 19,254 -> 18,992 — a net saving of
 * about 262 characters, under 2%. This figure has been an increase and a saving at
 * different points in the same branch, which is the point: it is a side effect, not
 * the argument. #1771 brought `record_search.birthYearExact` from 475 down to 207
 * (the year behaviour is now measured, so its paragraph collapses to a one-liner)
 * and deleted its exemption. What this lint buys is that the shared rule is stated
 * once and cannot silently be re-expanded into 43 paragraphs.
 *
 * The assertion below caught this pair going stale when the tool-level rule was
 * corrected — which is the first time a guard here caught my own staleness before it
 * shipped rather than a reviewer catching it after.
 *
 * Issue #1409's shape is the fix: state the rule ONCE in the tool-level
 * description, and give each parameter a one-liner underneath. This test is what
 * stops the next editor from re-expanding a one-liner into a paragraph, which is
 * how it got here.
 *
 * The ceiling is SIZED FROM THE ONE-LINERS ACTUALLY WRITTEN, not guessed. The
 * three longest descriptions are `record_search.givenNameExact` at
 * **238**, `record_search.surnameExact` at **237**, and
 * `record_search.birthPlaceExact` at **226**. Both `birthYearExact` toggles now
 * sit just below them at **207** (tied), so neither makes the top three, and since
 * #1771 there is no exemption. Before #1409 six toggles exceeded the old ceiling:
 * 475, 402, 375, 341, 269, 255.
 *
 * This list has been wrong in BOTH directions. An early revision named
 * `birthPlaceExact` third from a measurement whose filter had excluded BOTH tools'
 * `birthYearExact` when only one is exempt — right answer, wrong method. The "fix"
 * then over-corrected, promoting `person_search.birthYearExact` into third at a
 * quoted 209; re-measured it is 207 (after #1771's year-clause edit), still below `birthPlaceExact`'s 226, so
 * `birthPlaceExact` is third after all. `DOCUMENTED_LONGEST` below has carried the
 * right list throughout — the assertion binds those executable figures, not this
 * prose, which is how the prose could drift here while the test stayed green.
 *
 * **The ceiling sits high in the empirical gap, for headroom.** Legitimate
 * one-liners top out at 238; the smallest real offender was 255; so any ceiling in
 * 239..254 is defensible, and `CEILING` below is 250 — near the top of that range,
 * not its midpoint. High on purpose: 240 was the bottom and left only two
 * characters of headroom, which makes an ordinary clarification look like a defect.
 * 255 or above is NOT available: it would re-admit a description this PR shortened
 * for being too long, and a lint that permits what it was written to catch is
 * worse than a tight one.
 *
 * When it does bind, the fix is to shorten the description — NOT to raise the
 * ceiling, and NOT to add an `EXEMPT` entry, which is for a description whose
 * behaviour is under active measurement. Note what is NOT the fix: moving a clause
 * to the spec. The model reads these descriptions and never reads the spec, and the
 * initials clause on `givenNameExact` is the most actionable thing either tool says
 * about that leg. Shrinking model-facing guidance to satisfy a lint is the wrong
 * trade.
 *
 * **This comment has now been wrong three times about its own basis** — first
 * citing `surnameExact` at 205 with a baseline list uniformly +2 (counting the
 * enclosing quotes); then naming `birthPlaceExact` as longest while quoting a
 * bigger number for `givenNameExact` in the same sentence; then carrying 201/198
 * for two descriptions that a later commit rewrote to 181/237. The cause each time
 * was measuring, then editing the descriptions, then not re-measuring. If you
 * change any `*Exact` description, re-derive these numbers from `allToolSchemas`
 * before touching this comment — it is the only justification for CEILING, so being
 * wrong here is the same class of defect as guessing the threshold.
 *
 * **Two different scopes here, and it matters when this test fires.** `CEILING` is
 * enforced on the `*Exact` family ONLY. Other parameters carry genuinely
 * load-bearing prose (`projectPath`, `subjectId`, `batchNumber`) whose length is not
 * a smell, and inventing a per-description limit for those would be exactly the
 * guess this comment says the ceiling is not.
 *
 * `DOCUMENTED_TOTALS` is deliberately WHOLE-TOOL: it sums the tool-level description
 * plus every parameter, not just the `*Exact` ones. So it fires on ANY description
 * edit in either tool, including one with nothing to do with this family. That is
 * intended, not a leak — the totals are what the budget claim above rests on, and a
 * whole-tool figure is the only one that means anything for token cost. It is also
 * the reason the claim has stayed correct: it fired on every description edit made
 * after it was added, each one mine.
 *
 * So if you shortened `batchNumber` and this test went red, nothing is wrong with
 * your edit. Re-derive the two totals from `allToolSchemas` and update them here.
 * Do not scope the sum to `*Exact` to silence it — that would make the budget figure
 * measure something no one cares about.
 */
const CEILING = 250;

/**
 * The figures the docstring above rests on, asserted rather than trusted.
 *
 * That docstring has been wrong about its own basis THREE times — 205 with a
 * baseline list uniformly +2; then naming `birthPlaceExact` as longest while
 * quoting a bigger number for `givenNameExact` in the same sentence; then carrying
 * 201/198 for two descriptions a later commit rewrote to 181/237. The cause was the
 * same every time: measure, edit the descriptions being measured, forget to
 * re-measure. Raising the ceiling does nothing about that; this does.
 *
 * Keep these in step with the prose above. A drift is then a named test failure
 * rather than something a reviewer has to catch by re-deriving the numbers.
 */
const DOCUMENTED_LONGEST: Array<[string, number]> = [
  ["record_search.givenNameExact", 238],
  ["record_search.surnameExact", 237],
  ["record_search.birthPlaceExact", 226],
];
/** Smallest description that exceeded the ceiling before #1409 shortened it. */
const SMALLEST_HISTORICAL_OFFENDER = 255;

/**
 * The AFTER totals the docstring quotes, asserted for the same reason as
 * `DOCUMENTED_LONGEST`: they are live figures that change whenever any description
 * is edited, and they were stale in the PR body twice before being moved here.
 * The BEFORE pair (15,509 / 3,745) is a property of `origin/main` and cannot drift.
 */
const DOCUMENTED_TOTALS: Array<[string, number]> = [
  ["record_search", 13996],
  ["person_search", 4996],
];

/**
 * Empty since #1771. The sole former entry, `record_search.birthYearExact`, was
 * exempt while the year behaviour was under measurement; #1771 measured it (the
 * "records with no indexed year" population is empty — the index carries estimated
 * date RANGES matched by overlap), rewrote the paragraph to a 207-char one-liner,
 * and deleted this entry. Do not add an entry without an issue number and a
 * removal condition — an exemption is for a description whose behaviour is under
 * active measurement, never a way to keep a paragraph.
 */
const EXEMPT = new Map<string, string>([]);

describe("*Exact descriptions stay one-liners", () => {
  const TOOLS = ["record_search", "person_search"];

  for (const toolName of TOOLS) {
    it(`${toolName} keeps every *Exact description under ${CEILING} chars`, () => {
      const schema = allToolSchemas.find((t) => t.name === toolName);
      expect(schema, `${toolName} is not in allToolSchemas`).toBeDefined();
      const props = (schema?.inputSchema as { properties?: Record<string, { description?: string }> })
        ?.properties ?? {};

      const overLong = Object.entries(props)
        .filter(([name]) => /Exact$/.test(name))
        .filter(([name]) => !EXEMPT.has(`${toolName}.${name}`))
        .map(([name, prop]) => ({ name, len: (prop.description ?? "").length }))
        .filter((row) => row.len > CEILING)
        .map((row) => `${row.name}: ${row.len} chars`);

      expect(
        overLong,
        `an *Exact description has grown back into a paragraph.\n` +
          `  The rule these toggles share is stated ONCE in the tool-level\n` +
          `  description (issue #1409); a parameter needs only what is specific to\n` +
          `  it. If a toggle genuinely needs more than ${CEILING} chars, say why in\n` +
          `  EXEMPT with an issue number and a removal condition — do NOT raise the\n` +
          `  ceiling, which is sized from the longest one-liner actually written.`
      ).toEqual([]);
    });
  }

  it("the docstring's own figures still match the schemas", () => {
    const props = (toolName: string) =>
      ((allToolSchemas.find((t) => t.name === toolName)?.inputSchema as
        { properties?: Record<string, { description?: string }> })?.properties ?? {});
    const drift: string[] = [];
    for (const [path, documented] of DOCUMENTED_LONGEST) {
      const [tool, param] = path.split(".");
      const actual = ((props(tool!)[param!] ?? {}).description ?? "").length;
      if (actual !== documented) drift.push(`${path}: docstring says ${documented}, actual ${actual}`);
    }
    // The ordering claim matters as much as the values: the docstring names these
    // as the LONGEST, and the ceiling is derived from the first of them.
    const measured = ["record_search", "person_search"]
      .flatMap((t) => Object.entries(props(t)).map(([k, v]) => [`${t}.${k}`, (v.description ?? "").length] as [string, number]))
      .filter(([k]) => /Exact$/.test(k) && !EXEMPT.has(k))
      .sort((a, b) => b[1] - a[1]);
    const topThree = measured.slice(0, 3).map(([k]) => k);
    const documentedOrder = DOCUMENTED_LONGEST.map(([k]) => k);
    if (JSON.stringify(topThree) !== JSON.stringify(documentedOrder)) {
      drift.push(`longest three are now ${topThree.join(" > ")}, docstring names ${documentedOrder.join(" > ")}`);
    }
    for (const [tool, documented] of DOCUMENTED_TOTALS) {
      const schema = allToolSchemas.find((t) => t.name === tool);
      const toolLevel = (schema?.description ?? "").length;
      const params = Object.values(props(tool)).reduce(
        (a, v) => a + ((v.description ?? "").length),
        0
      );
      if (toolLevel + params !== documented) {
        drift.push(`${tool} total: docstring says ${documented}, actual ${toolLevel + params}`);
      }
    }
    if (CEILING <= (measured[0]?.[1] ?? 0)) drift.push(`CEILING ${CEILING} is below the longest description`);
    if (CEILING >= SMALLEST_HISTORICAL_OFFENDER) {
      drift.push(`CEILING ${CEILING} would re-admit the smallest historical offender (${SMALLEST_HISTORICAL_OFFENDER})`);
    }
    expect(
      drift,
      "the docstring above no longer describes reality.\n" +
        "  It is the ONLY justification for CEILING, and it has been wrong about its\n" +
        "  own basis three times — always by editing a description and not\n" +
        "  re-measuring. Re-derive from allToolSchemas and update both the prose and\n" +
        "  DOCUMENTED_LONGEST in the same commit."
    ).toEqual([]);
  });

  it("every exemption names a reason and stays reachable", () => {
    const problems: string[] = [];
    for (const [key, reason] of EXEMPT) {
      if (reason.trim().length < 20) problems.push(`${key}: reason too thin`);
      const [tool, param] = key.split(".");
      const schema = allToolSchemas.find((t) => t.name === tool);
      const props = (schema?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {};
      if (!(param in props)) {
        problems.push(`${key}: parameter no longer exists — delete the exemption`);
        continue;
      }
      // The docstring promises an exemption cannot outlive its reason, and only
      // this assertion makes that true. Checking the parameter still EXISTS is
      // not enough: when the description it excuses is rewritten as a one-liner
      // (which is exactly what the issue owning `birthYearExact` will do), a
      // leftover entry becomes a permanent pass for that parameter and nothing
      // goes red. An exemption for a description that already fits is dead.
      const len = ((props[param] as { description?: string }).description ?? "").length;
      if (len <= CEILING) {
        problems.push(
          `${key}: description is ${len} chars, already under the ${CEILING} ceiling — ` +
            `the exemption is dead, delete it`
        );
      }
    }
    expect(
      problems,
      "an exemption is unjustified or stale. A stale one is a permanent pass for a paragraph."
    ).toEqual([]);
  });
});
