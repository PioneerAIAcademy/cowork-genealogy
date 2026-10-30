/**
 * dev/matcher-accuracy.ts (issue #3553). The math, the fixture classification
 * and the persona pick are pure; `main` runs over a temp fixtures directory
 * with the record fetch and the scorer faked, so nothing here touches
 * FamilySearch.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auc,
  cachePath,
  classifyFixture,
  confusion,
  main,
  misranked,
  parseArgs,
  parseMinAuc,
  passesFloor,
  personaIdFor,
  recordDocument,
  researchProblem,
  type Deps,
  type ScoredPair,
} from "../../dev/matcher-accuracy.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";

const pair = (slug: string, label: 0 | 1, score: number): ScoredPair => ({ slug, label, score });

describe("auc", () => {
  it("is 1 when every true pair outscores every false pair", () => {
    expect(auc([pair("a", 1, 0.9), pair("b", 1, 0.8), pair("c", 0, 0.2), pair("d", 0, 0.1)])).toBe(1);
  });

  it("is 0 when the ranking is inverted", () => {
    expect(auc([pair("a", 1, 0.1), pair("b", 1, 0.2), pair("c", 0, 0.8), pair("d", 0, 0.9)])).toBe(0);
  });

  it("counts a tie as half", () => {
    expect(auc([pair("a", 1, 0.5), pair("b", 0, 0.5)])).toBe(0.5);
    // (tie 0.5 + win 1) / 2 comparisons
    expect(auc([pair("a", 1, 0.5), pair("b", 0, 0.5), pair("c", 0, 0.2)])).toBe(0.75);
  });

  it("is undefined (null) on empty input or a single class", () => {
    expect(auc([])).toBeNull();
    expect(auc([pair("a", 1, 0.9), pair("b", 1, 0.1)])).toBeNull();
    expect(auc([pair("a", 0, 0.9)])).toBeNull();
  });

  it("refuses a non-finite score rather than ranking it silently", () => {
    expect(() => auc([pair("a", 1, Number.NaN), pair("b", 0, 0.1)])).toThrow(/non-finite/);
  });
});

describe("confusion", () => {
  it("predicts same only strictly above the cut: 0.7 exactly is not > 0.7", () => {
    const pairs = [pair("t70", 1, 0.7), pair("f70", 0, 0.7)];
    expect(confusion(pairs, 0.7)).toEqual({ cut: 0.7, tp: 0, fn: 1, fp: 0, tn: 1 });
    expect(confusion(pairs, 0.4)).toEqual({ cut: 0.4, tp: 1, fn: 0, fp: 1, tn: 0 });
  });

  it("puts 0.4 exactly below the 0.4 cut and just above it over", () => {
    const pairs = [pair("t40", 1, 0.4), pair("f40", 0, 0.4), pair("t41", 1, 0.400001)];
    expect(confusion(pairs, 0.4)).toEqual({ cut: 0.4, tp: 1, fn: 1, fp: 0, tn: 1 });
  });

  it("is all zeros on empty input", () => {
    expect(confusion([], 0.7)).toEqual({ cut: 0.7, tp: 0, fn: 0, fp: 0, tn: 0 });
  });
});

describe("misranked", () => {
  it("lists true pairs below 0.4 and false pairs above 0.7, boundaries excluded", () => {
    const m = misranked([
      pair("true-weak", 1, 0.39),
      pair("true-weakest", 1, 0.01),
      pair("true-at-0.4", 1, 0.4),
      pair("true-strong", 1, 0.95),
      pair("false-strong", 0, 0.71),
      pair("false-strongest", 0, 0.99),
      pair("false-at-0.7", 0, 0.7),
      pair("false-weak", 0, 0.05),
    ]);
    expect(m.weakTrue.map((p) => p.slug)).toEqual(["true-weakest", "true-weak"]);
    expect(m.strongFalse.map((p) => p.slug)).toEqual(["false-strongest", "false-strong"]);
  });

  it("is empty on empty input", () => {
    expect(misranked([])).toEqual({ weakTrue: [], strongFalse: [] });
  });
});

describe("the MIN_AUC floor", () => {
  it("defaults to 0.65 and reads a valid override, whitespace and all", () => {
    expect(parseMinAuc(undefined)).toBe(0.65);
    expect(parseMinAuc("")).toBe(0.65);
    expect(parseMinAuc("0.7")).toBe(0.7);
    expect(parseMinAuc(" 0.7 ")).toBe(0.7);
    expect(parseMinAuc("1")).toBe(1);
  });

  it("refuses a value that would parse to NaN or sits outside 0..1", () => {
    for (const bad of ["abc", "NaN", "0.7x", "1.5", "-0.1", "Infinity"]) {
      expect(() => parseMinAuc(bad), bad).toThrow(/MIN_AUC/);
    }
  });

  it("passes at the floor exactly, fails below it, and never passes an undefined AUC", () => {
    expect(passesFloor(0.65, 0.65)).toBe(true);
    expect(passesFloor(0.6499, 0.65)).toBe(false);
    expect(passesFloor(null, 0)).toBe(false);
  });
});

describe("parseArgs", () => {
  it("reads --refresh and --csv and refuses anything else", () => {
    expect(parseArgs([])).toEqual({ refresh: false, csv: null });
    expect(parseArgs(["--refresh", "--csv", "out.csv"])).toEqual({ refresh: true, csv: "out.csv" });
    expect(() => parseArgs(["--csv"])).toThrow(/output path/);
    expect(() => parseArgs(["--csv", "--refresh"])).toThrow(/output path/);
    expect(() => parseArgs(["--refesh"])).toThrow(/unknown argument/);
  });
});

describe("classifyFixture", () => {
  const ark = "ark:/61903/1:1:XS6N-1GXK";

  it("labels same 1 and different 0", () => {
    expect(classifyFixture({ hint: { persona_ark: ark, identity: "same" } }, "")).toMatchObject({ kind: "scored", label: 1 });
    expect(classifyFixture({ hint: { persona_ark: ark, identity: "different" } }, "")).toMatchObject({ kind: "scored", label: 0 });
    expect(classifyFixture({ hint: { persona_ark: "ark:/61903/1:1:QVS9-DHD", identity: "same" } }, null)).toMatchObject({ kind: "scored" });
  });

  it("skips unresolved, an explicit null, an absent key and a draft, by reason", () => {
    expect(classifyFixture({ hint: { persona_ark: ark, identity: "unresolved" } }, "")).toEqual({ kind: "skipped", reason: "unresolved" });
    expect(classifyFixture({ hint: null }, "")).toEqual({ kind: "skipped", reason: "no-hint" });
    expect(classifyFixture({}, "")).toEqual({ kind: "skipped", reason: "hint-absent" });
    const draft = "# x\n\n**DRAFT PENDING ADJUDICATION**\n";
    expect(classifyFixture({ hint: { persona_ark: ark, identity: "same" } }, draft)).toEqual({ kind: "skipped", reason: "draft" });
  });

  it("skips a draft before reading its hint at all, malformed or absent", () => {
    const draft = "**DRAFT PENDING ADJUDICATION**\n";
    for (const meta of [
      {},
      { hint: "same" },
      { hint: { persona_ark: "GRS9-MCH", identity: 2, outcome: "b" } },
      { hint: { persona_ark: ark, identity: "unresolved", note: "x" } },
    ]) {
      expect(classifyFixture(meta, draft), JSON.stringify(meta)).toEqual({ kind: "skipped", reason: "draft" });
    }
  });

  it("refuses to score a persona_ark that is not a full 1:1: persona ark", () => {
    for (const bad of [
      "ark:/61903/1:2:XS6N-1GXK",
      "ark:/61903/3:1:3Q9M-CSNL-S98H-M",
      "XS6N-1GXK",
      "GRS9-MCH",
      "https://www.familysearch.org/ark:/61903/1:1:XS6N-1GXK",
      `${ark}\n`,
      42,
      undefined,
    ]) {
      expect(classifyFixture({ hint: { persona_ark: bad, identity: "same" } }, ""), String(bad)).toMatchObject({ kind: "error" });
    }
  });

  it("checks persona_ark on an unresolved hint too, rather than skipping it unread", () => {
    for (const bad of ["ark:/61903/1:2:XS6N-1GXK", "XS6N-1GXK", undefined]) {
      expect(classifyFixture({ hint: { persona_ark: bad, identity: "unresolved" } }, ""), String(bad)).toMatchObject({
        kind: "error",
        message: expect.stringMatching(/hint\.persona_ark must be a full 1:1:/),
      });
    }
    expect(classifyFixture({ hint: { identity: "unresolved" } }, "")).toMatchObject({ kind: "error" });
  });

  it("refuses a hint key outside persona_ark and identity, whatever the identity", () => {
    for (const identity of ["same", "different", "unresolved"]) {
      expect(
        classifyFixture({ hint: { persona_ark: ark, identity, outcome: "b" } }, ""),
        identity,
      ).toEqual({
        kind: "error",
        message: 'hint has unrecognized field(s) "outcome" (only persona_ark, identity are defined)',
      });
    }
    // A misspelt key is unknown AND leaves the real one missing: both are named.
    const typo = classifyFixture({ hint: { persona_ark: ark, identiy: "same" } }, "");
    expect(typo).toMatchObject({ kind: "error" });
    expect((typo as { message: string }).message).toMatch(/unrecognized field\(s\) "identiy"/);
    expect((typo as { message: string }).message).toMatch(/hint\.identity must be one of/);
  });

  it("refuses an identity that is an outcome number or the wrong case", () => {
    for (const bad of [2, "2", "Same", "b", null]) {
      expect(classifyFixture({ hint: { persona_ark: ark, identity: bad } }, ""), String(bad)).toMatchObject({ kind: "error" });
    }
    expect(classifyFixture({ hint: "same" }, "")).toMatchObject({ kind: "error" });
    expect(classifyFixture({ hint: [ark, "same"] }, "")).toMatchObject({ kind: "error" });
  });
});

describe("personaIdFor", () => {
  const doc = (persons: SimplifiedGedcomX["persons"]): SimplifiedGedcomX => ({ persons });

  it("picks the hinted persona even when it is not persons[0]", () => {
    const d = doc([
      { id: "p_1", ark: "ark:/61903/1:1:AAAA-111" },
      { id: "p_2", ark: "ark:/61903/1:1:XS6N-1GXK" },
    ]);
    expect(personaIdFor(d, "ark:/61903/1:1:XS6N-1GXK")).toBe("p_2");
  });

  it("matches a resolver-URL ark on the persona", () => {
    const d = doc([{ id: "XS6N-1GXK", ark: "https://familysearch.org/ark:/61903/1:1:XS6N-1GXK" }]);
    expect(personaIdFor(d, "ark:/61903/1:1:XS6N-1GXK")).toBe("XS6N-1GXK");
  });

  it("throws instead of falling back to persons[0] when no persona carries the ark", () => {
    const d = doc([
      { id: "p_1", ark: "ark:/61903/1:1:AAAA-111" },
      { id: "p_2" },
      // Same suffix, different ARK type: a different entity.
      { id: "p_3", ark: "ark:/61903/1:2:XS6N-1GXK" },
    ]);
    expect(() => personaIdFor(d, "ark:/61903/1:1:XS6N-1GXK")).toThrow(/no persona/);
    expect(() => personaIdFor(doc([]), "ark:/61903/1:1:XS6N-1GXK")).toThrow(/no persona/);
  });

  it("throws when two different persons carry the ark", () => {
    const d = doc([
      { id: "p_1", ark: "ark:/61903/1:1:XS6N-1GXK" },
      { id: "p_2", ark: "ark:/61903/1:1:XS6N-1GXK" },
    ]);
    expect(() => personaIdFor(d, "ark:/61903/1:1:XS6N-1GXK")).toThrow(/2 personas/);
  });
});

describe("researchProblem", () => {
  it("accepts a starting research with no assertions to strip", () => {
    expect(researchProblem({ assertions: [] })).toBeNull();
    expect(researchProblem({ sources: [] })).toBeNull();
  });

  it("refuses any assertion, since same_person would strip what it sources and this script does not", () => {
    expect(researchProblem({ assertions: [{ id: "a_001", record_id: "XS6N-1GXK" }] })).toMatch(
      /holds 1 assertion\(s\): same_person would strip .*withoutRecordSourced/,
    );
  });

  it("refuses a research document of the wrong shape rather than reading it as empty", () => {
    for (const bad of [null, [], "x", { assertions: null }, { assertions: {} }]) {
      expect(researchProblem(bad), JSON.stringify(bad)).toMatch(/starting-research\.json/);
    }
  });
});

// ─── main, over a temp fixtures directory ────────────────────────────────────

const TREE_PID = "GRS9-MCH";
const PARENT_PID = "PRNT-AAA";
const STRANGER_PID = "STRN-GER";
const tree: SimplifiedGedcomX = {
  persons: [
    { id: TREE_PID, gender: "Female", names: [{ given: "Adela", surname: "Martínez" }] },
    { id: PARENT_PID, gender: "Male", names: [{ given: "José", surname: "Martínez" }] },
    // No relationship reaches this person, so same_person's matchSubset mob leaves them out.
    { id: STRANGER_PID, gender: "Male", names: [{ given: "Unrelated", surname: "Stranger" }] },
  ],
  relationships: [{ type: "ParentChild", parent: PARENT_PID, child: TREE_PID }],
};

function recordFor(ark: string): SimplifiedGedcomX {
  // The hinted persona deliberately second, so a persons[0] fallback would score p_1.
  return {
    persons: [
      { id: "p_1", ark: "ark:/61903/1:1:ZZZZ-999", names: [{ given: "Someone", surname: "Else" }] },
      { id: "p_2", ark, names: [{ given: "Adela", surname: "Martínez" }] },
    ],
  };
}

describe("main", () => {
  let root: string;
  let fixturesDir: string;
  let cacheDir: string;
  let lines: string[];
  let scored: Array<{ id1: string; id2: string; ark: string | undefined }>;
  let treeSides: string[][];
  let fetched: string[];
  let scores: Record<string, number>;

  /** `research` is starting-research.json's raw text; null writes no file. */
  function fixture(
    slug: string,
    meta: Record<string, unknown>,
    { readme = "# fixture\n", research = JSON.stringify({ assertions: [] }) }: { readme?: string; research?: string | null } = {},
  ): void {
    const dir = join(fixturesDir, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fixture.json"), JSON.stringify({ genre: "record-hint", source_pid: TREE_PID, ...meta }), "utf8");
    writeFileSync(join(dir, "README.md"), readme, "utf8");
    writeFileSync(join(dir, "starting-tree.gedcomx.json"), JSON.stringify(tree), "utf8");
    if (research !== null) writeFileSync(join(dir, "starting-research.json"), research, "utf8");
  }

  function deps(over: Partial<Deps> = {}): Deps {
    return {
      fixturesDir,
      cacheDir,
      fetchRecord: async (ark) => {
        fetched.push(ark);
        return recordFor(ark);
      },
      score: async (g1, id1, g2, id2) => {
        const ark = g1.persons?.find((p) => p.id === id1)?.ark;
        scored.push({ id1, id2, ark });
        treeSides.push((g2.persons ?? []).map((p) => p.id ?? "(no id)"));
        return { score: scores[ark ?? ""] ?? 0 };
      },
      ensureLogin: async () => {},
      log: (line) => lines.push(line),
      ...over,
    };
  }

  const hint = (id: string, identity: string) => ({ hint: { persona_ark: `ark:/61903/1:1:${id}`, identity } });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "matcher-accuracy-"));
    fixturesDir = join(root, "e2e");
    cacheDir = join(root, "cache");
    mkdirSync(fixturesDir);
    lines = [];
    scored = [];
    treeSides = [];
    fetched = [];
    scores = {};
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("scores same/different pairs on the hinted persona, skips the rest, and passes above the floor", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    fixture("c-unresolved", hint("CCCC-CCC", "unresolved"));
    fixture("d-null", { hint: null });
    fixture("e-absent", {});
    fixture("f-draft", hint("FFFF-FFF", "same"), { readme: "**DRAFT PENDING ADJUDICATION**\n" });
    fixture("g-strip", { genre: "strip" });
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.9, "ark:/61903/1:1:BBBB-BBB": 0.1 };

    expect(await main([], {}, deps())).toBe(0);
    expect(scored).toEqual([
      { id1: "p_2", id2: TREE_PID, ark: "ark:/61903/1:1:AAAA-AAA" },
      { id1: "p_2", id2: TREE_PID, ark: "ark:/61903/1:1:BBBB-BBB" },
    ]);
    const out = lines.join("\n");
    expect(out).toContain("6 record-hint fixtures");
    expect(out).toContain("scored   2 (same 1, different 1");
    expect(out).toContain("skipped  4");
    expect(out).toMatch(/unresolved 1: c-unresolved/);
    expect(out).toMatch(/no-hint 1: d-null/);
    expect(out).toMatch(/hint-absent 1: e-absent/);
    expect(out).toMatch(/draft 1: f-draft/);
    expect(out).toContain("AUC 1.000");
    expect(out).toContain("floor MIN_AUC = 0.65");
    expect(out).toContain("PASS");
  });

  it("scores the tree as same_person sends it: the source_pid's matchSubset mob, not the whole tree", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.9, "ark:/61903/1:1:BBBB-BBB": 0.1 };

    expect(await main([], {}, deps())).toBe(0);
    expect(treeSides).toHaveLength(2);
    for (const ids of treeSides) {
      expect(ids).toContain(TREE_PID);
      expect(ids).toContain(PARENT_PID);
      expect(ids).not.toContain(STRANGER_PID);
    }
  });

  it("fails below the floor and names the misranked pairs", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.05, "ark:/61903/1:1:BBBB-BBB": 0.95 };

    expect(await main([], {}, deps())).toBe(1);
    const out = lines.join("\n");
    expect(out).toContain("AUC 0.000");
    expect(out).toMatch(/same\s+0\.0500\s+a-same/);
    expect(out).toMatch(/different\s+0\.9500\s+b-different/);
    expect(out).toContain("FAIL: AUC 0.000 is below MIN_AUC 0.65");
  });

  it("honours MIN_AUC from the environment and refuses a malformed one", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    fixture("c-different", hint("CCCC-CCC", "different"));
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.5, "ark:/61903/1:1:BBBB-BBB": 0.9, "ark:/61903/1:1:CCCC-CCC": 0.1 };

    expect(await main([], { MIN_AUC: "0.5" }, deps())).toBe(0);
    expect(await main([], { MIN_AUC: "0.6" }, deps())).toBe(1);
    expect(await main([], { MIN_AUC: "zero" }, deps())).toBe(2);
    expect(scored.length).toBe(6);
  });

  it("exits 1 when nothing was scored, without asking for a login", async () => {
    fixture("d-null", { hint: null });
    fixture("e-absent", {});
    let loginAsked = false;
    expect(await main([], {}, deps({ ensureLogin: async () => { loginAsked = true; } }))).toBe(1);
    expect(loginAsked).toBe(false);
    expect(lines.join("\n")).toContain("FAIL: nothing was scored.");
  });

  it("exits 1 when only one class was scored: the AUC is undefined", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    expect(await main([], {}, deps())).toBe(1);
    expect(lines.join("\n")).toContain("AUC is undefined");
  });

  it("fails on a fixture whose record lacks the hinted persona, never scoring persons[0]", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    fixture("c-missing", hint("CCCC-CCC", "same"));
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.9, "ark:/61903/1:1:BBBB-BBB": 0.1 };
    const fetchRecord = async (ark: string) =>
      ark.endsWith("CCCC-CCC") ? { persons: [{ id: "p_1", ark: "ark:/61903/1:1:ZZZZ-999" }] } : recordFor(ark);

    expect(await main([], {}, deps({ fetchRecord }))).toBe(1);
    expect(scored.map((s) => s.ark)).not.toContain("ark:/61903/1:1:ZZZZ-999");
    const out = lines.join("\n");
    expect(out).toContain("errors   1 (NOT scored");
    expect(out).toMatch(/c-missing: no persona in the record document carries ark:\/61903\/1:1:CCCC-CCC/);
    expect(out).toContain("FAIL: 1 record-hint fixture(s) could not be scored; the AUC above covers only the rest.");
    expect(out).not.toContain("PASS");
  });

  it("fails on one unscoreable fixture even when the AUC over the rest clears the floor", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    fixture("c-bad-identity", hint("CCCC-CCC", "b"));
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.9, "ark:/61903/1:1:BBBB-BBB": 0.1 };

    expect(await main([], {}, deps())).toBe(1);
    const out = lines.join("\n");
    expect(out).toContain("AUC 1.000");
    expect(out).toMatch(/c-bad-identity: hint\.identity must be one of/);
    expect(out).toContain("FAIL: 1 record-hint fixture(s) could not be scored");
    expect(out).not.toContain("is below MIN_AUC");
    expect(out).not.toContain("PASS");
  });

  it("names both failures when a fixture errors and the AUC is also below the floor", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    fixture("c-bad-ark", { hint: { persona_ark: "CCCC-CCC", identity: "same" } });
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.1, "ark:/61903/1:1:BBBB-BBB": 0.9 };

    expect(await main([], {}, deps())).toBe(1);
    const out = lines.join("\n");
    expect(out).toContain("FAIL: 1 record-hint fixture(s) could not be scored");
    expect(out).toContain("FAIL: AUC 0.000 is below MIN_AUC 0.65.");
  });

  it("lists a malformed hint and a source_pid absent from the tree as errors", async () => {
    fixture("a-bad-ark", { hint: { persona_ark: "ark:/61903/1:2:AAAA-AAA", identity: "same" } });
    fixture("b-no-anchor", { ...hint("BBBB-BBB", "same"), source_pid: "NOPE-NOP" });
    expect(await main([], {}, deps())).toBe(1);
    const out = lines.join("\n");
    expect(out).toMatch(/a-bad-ark: hint\.persona_ark must be a full 1:1:/);
    expect(out).toMatch(/b-no-anchor: Mob: anchor person "NOPE-NOP" not found/);
  });

  it("lists an empty, absent or non-string source_pid as an error without fetching its record", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    fixture("c-empty-pid", { ...hint("CCCC-CCC", "same"), source_pid: "" });
    fixture("d-absent-pid", { ...hint("DDDD-DDD", "same"), source_pid: undefined });
    fixture("e-numeric-pid", { ...hint("EEEE-EEE", "same"), source_pid: 42 });
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.9, "ark:/61903/1:1:BBBB-BBB": 0.1 };

    expect(await main([], {}, deps())).toBe(1);
    const out = lines.join("\n");
    for (const slug of ["c-empty-pid", "d-absent-pid", "e-numeric-pid"]) {
      expect(out).toContain(`${slug}: fixture.json has no source_pid`);
    }
    expect(fetched.sort()).toEqual(["ark:/61903/1:1:AAAA-AAA", "ark:/61903/1:1:BBBB-BBB"]);
    expect(out).toContain("FAIL: 3 record-hint fixture(s) could not be scored");
  });

  it("refuses a fixture whose starting research holds assertions, without fetching its record", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    fixture("c-researched", hint("CCCC-CCC", "same"), {
      research: JSON.stringify({ assertions: [{ id: "a_001", record_id: "CCCC-CCC" }] }),
    });
    fixture("d-unparseable", hint("DDDD-DDD", "same"), { research: "{ truncated" });
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.9, "ark:/61903/1:1:BBBB-BBB": 0.1, "ark:/61903/1:1:CCCC-CCC": 0.9 };

    expect(await main([], {}, deps())).toBe(1);
    expect(fetched.sort()).toEqual(["ark:/61903/1:1:AAAA-AAA", "ark:/61903/1:1:BBBB-BBB"]);
    const out = lines.join("\n");
    expect(out).toMatch(/c-researched: starting-research\.json holds 1 assertion\(s\): same_person would strip/);
    expect(out).toMatch(/d-unparseable: starting-research\.json does not parse/);
    expect(out).toContain("FAIL: 2 record-hint fixture(s) could not be scored");
  });

  it("scores a fixture with no starting-research.json: there are no assertions to strip", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"), { research: null });
    fixture("b-different", hint("BBBB-BBB", "different"), { research: JSON.stringify({ sources: [], assertions: [] }) });
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.9, "ark:/61903/1:1:BBBB-BBB": 0.1 };

    expect(await main([], {}, deps())).toBe(0);
    expect(scored).toHaveLength(2);
  });

  it("skips a draft before its source_pid, starting research or hint are read", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    fixture("c-draft", { hint: "garbage", source_pid: "" }, {
      readme: "# x\n\n**DRAFT PENDING ADJUDICATION**\n",
      research: JSON.stringify({ assertions: [{ id: "a_001" }] }),
    });
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.9, "ark:/61903/1:1:BBBB-BBB": 0.1 };

    expect(await main([], {}, deps())).toBe(0);
    const out = lines.join("\n");
    expect(out).toMatch(/draft 1: c-draft/);
    expect(out).toContain("errors   0");
  });

  it("stops with a login instruction when there is no FamilySearch session", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    const ensureLogin = async () => {
      throw new Error("Call the login tool to authenticate.");
    };
    expect(await main([], {}, deps({ ensureLogin }))).toBe(1);
    expect(fetched).toEqual([]);
    expect(lines.join("\n")).toContain("make e2e-login");
  });

  it("caches record documents and re-fetches on --refresh", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.9, "ark:/61903/1:1:BBBB-BBB": 0.1 };

    await main([], {}, deps());
    expect(fetched.sort()).toEqual(["ark:/61903/1:1:AAAA-AAA", "ark:/61903/1:1:BBBB-BBB"]);
    expect(existsSync(cachePath(cacheDir, "ark:/61903/1:1:AAAA-AAA"))).toBe(true);

    fetched = [];
    await main([], {}, deps());
    expect(fetched).toEqual([]);
    expect(lines.join("\n")).toContain("records fetched 0, cached 2");

    await main(["--refresh"], {}, deps());
    expect(fetched.length).toBe(2);
  });

  it("writes the scored pairs to --csv", async () => {
    fixture("a-same", hint("AAAA-AAA", "same"));
    fixture("b-different", hint("BBBB-BBB", "different"));
    scores = { "ark:/61903/1:1:AAAA-AAA": 0.9, "ark:/61903/1:1:BBBB-BBB": 0.1 };
    const csv = join(root, "out.csv");

    expect(await main(["--csv", csv], {}, deps())).toBe(0);
    expect(readFileSync(csv, "utf8").trim().split("\n")).toEqual([
      "slug,identity,label,persona_ark,persona_id,score",
      "a-same,same,1,ark:/61903/1:1:AAAA-AAA,p_2,0.9",
      "b-different,different,0,ark:/61903/1:1:BBBB-BBB,p_2,0.1",
    ]);
  });

  it("exits 2 on an unknown argument", async () => {
    expect(await main(["--only", "x"], {}, deps())).toBe(2);
  });
});

describe("recordDocument", () => {
  it("treats an unparseable cache file as a miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "matcher-cache-"));
    try {
      const ark = "ark:/61903/1:1:AAAA-AAA";
      writeFileSync(cachePath(dir, ark), "{ truncated", "utf8");
      let calls = 0;
      const got = await recordDocument(ark, {
        refresh: false,
        cacheDir: dir,
        fetchRecord: async () => {
          calls += 1;
          return { persons: [{ id: "p_1", ark }] };
        },
      });
      expect(calls).toBe(1);
      expect(got.cached).toBe(false);
      expect(JSON.parse(readFileSync(cachePath(dir, ark), "utf8"))).toEqual({ persons: [{ id: "p_1", ark }] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
