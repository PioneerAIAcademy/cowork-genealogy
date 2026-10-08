import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decisiveness } from "../../src/utils/person-search-decisiveness.js";

// Phase 4: "ask when the candidates are not decisive". The rule is DERIVED from a
// live probe of eight queries (dev/probe-person-search-decisiveness.json), not
// guessed -- and the probe refuted the rule originally proposed.

const s = (...scores: Array<number | undefined>): Array<{ score?: number }> =>
  scores.map((score) => (score === undefined ? {} : { score }));

describe("decisiveness", () => {
  it("is decisive when exactly one candidate holds the top score", () => {
    expect(decisiveness(s(5.12, 4.39, 4.38)).decisive).toBe(true);
  });

  it("is NOT decisive when the top score is tied", () => {
    // The flood signature: the same few fields matched for all of them, so the tool
    // has no basis to prefer one.
    expect(decisiveness(s(3.6236, 3.6236, 3.6236)).decisive).toBe(false);
  });

  it("is decisive on a TINY gap, because the gap is not the signal", () => {
    // flynn-qualified, probed live: 5.2936 vs 5.2836 — a gap of 0.01, and the case
    // ut_init_project_004 is right to auto-pick. Any gap threshold above 0.01
    // misclassifies it, which is why this rule does not use one.
    expect(decisiveness(s(5.2936, 5.2836003, 5.2736)).decisive).toBe(true);
  });

  it("treats an absent top score as not decisive", () => {
    // A pick the tool cannot justify is exactly the one a person should make.
    expect(decisiveness(s(undefined, 4.0)).decisive).toBe(false);
  });

  it("is not decisive with no candidates at all", () => {
    expect(decisiveness([]).decisive).toBe(false);
  });

  it("IS decisive with exactly one candidate", () => {
    expect(decisiveness(s(4.0)).decisive).toBe(true);
  });

  it("counts how many tie, so the reason can say it", () => {
    const d = decisiveness(s(3.6236, 3.6236, 3.6236, 3.6236, 3.6236));
    expect(d.tiedAtTop).toBe(5);
    expect(d.reason).toMatch(/5/);
  });

  it("gives a reason a reader can act on either way", () => {
    expect(decisiveness(s(5.12, 4.39)).reason).toBeTruthy();
    expect(decisiveness(s(3.6, 3.6)).reason).toBeTruthy();
  });

  it("never throws on malformed candidates", () => {
    expect(() => decisiveness([{ score: NaN }, {}, null as never])).not.toThrow();
  });

  it("treats NaN as no score rather than as a value", () => {
    expect(decisiveness([{ score: NaN }, { score: 1 }]).decisive).toBe(false);
  });
});

// --- Against the eight LIVE probes ------------------------------------------------
describe("decisiveness over the live probe corpus", () => {
  const probe = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "dev", "probe-person-search-decisiveness.json"), "utf8")
  ) as { probes: Array<{ label: string; topScores: Array<number | null> }> };

  // What the probe showed, and what the rule must reproduce.
  const EXPECTED: Record<string, boolean> = {
    "flynn-qualified": true,
    "mcandrew-qualified": true,
    "mogan-middle": true,
    "hales-flood": false,
    "smith-flood": false,
    "hales-year": false,
    "hales-year-place": false,
    "broyles-middle": false
  };

  it("has the corpus — a zero-length scan proves nothing", () => {
    expect(probe.probes).toHaveLength(8);
  });

  it("classifies every live probe the way the evidence says", () => {
    for (const p of probe.probes) {
      const cands = (p.topScores ?? []).map((x) => (x === null ? {} : { score: x }));
      expect(decisiveness(cands).decisive, `${p.label}`).toBe(EXPECTED[p.label]);
    }
  });
});
