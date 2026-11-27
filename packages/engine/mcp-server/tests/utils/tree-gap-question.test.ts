import { describe, it, expect } from "vitest";
import { gapQuestion, withQuestions } from "../../src/utils/tree-gap-question.js";
import type { TreeGap } from "../../src/types/tree-gaps.js";

function gap(over: Partial<TreeGap>): TreeGap {
  return {
    type: "no_death_date",
    personId: "P-1",
    name: "Hannah Pruitt",
    lifespan: "1861-1934",
    generation: 1,
    detail: "",
    yearRange: { start: 1860, end: 1864 },
    place: "Lancaster, Pennsylvania, United States",
    coverage: null,
    pendingHints: null,
    ...over,
  };
}

describe("gapQuestion", () => {
  it("asks for the missing parent, or both, of a person", () => {
    expect(gapQuestion(gap({ type: "missing_parents", detail: "Father and mother are both missing from the tree." }))).toBe(
      "Who were the parents of Hannah Pruitt (1861-1934), born in Lancaster, Pennsylvania, United States between 1860 and 1864?",
    );
    expect(gapQuestion(gap({ type: "missing_parents", detail: "The father is missing from the tree." }))).toMatch(
      /^Who was the father of Hannah Pruitt/,
    );
    expect(gapQuestion(gap({ type: "missing_parents", detail: "The mother is missing from the tree." }))).toMatch(
      /^Who was the mother of Hannah Pruitt/,
    );
  });

  it("asks one question for a couple's children, whichever of the three child holes it is", () => {
    for (const type of ["no_children", "child_gap", "early_last_child"] as const) {
      expect(gapQuestion(gap({ type, name: "Edmund Ashby", spouseName: "Clara Weis", yearRange: { start: 1881, end: 1886 }, place: "Dayton, Montgomery, Ohio, United States" }))).toBe(
        "Who were the children born to Edmund Ashby and Clara Weis in Dayton, Montgomery, Ohio, United States between 1881 and 1886?",
      );
    }
  });

  it("names the spouse for a maiden surname when there is one, and not otherwise", () => {
    expect(gapQuestion(gap({ type: "missing_surname", name: "Clara", lifespan: "1854-1927", spouseName: "Edmund Ashby", yearRange: { start: 1879, end: 1881 }, place: "Dayton, Ohio" }))).toBe(
      "What was the maiden surname of Clara (1854-1927), wife of Edmund Ashby, married in Dayton, Ohio between 1879 and 1881?",
    );
    expect(gapQuestion(gap({ type: "missing_surname", name: "Clara", lifespan: null }))).toBe(
      "What was the maiden surname of Clara, married in Lancaster, Pennsylvania, United States between 1860 and 1864?",
    );
  });

  it("asks one spouse, one death date, and one birth fact, never two", () => {
    expect(gapQuestion(gap({ type: "no_spouse" }))).toMatch(/^Whom did Hannah Pruitt \(1861-1934\) marry in Lancaster/);
    expect(gapQuestion(gap({ type: "no_death_date" }))).toBe(
      "When did Hannah Pruitt (1861-1934), born in Lancaster, Pennsylvania, United States, die between 1860 and 1864?",
    );
    expect(gapQuestion(gap({ type: "no_birth_info", detail: "Deceased, but the tree gives no birth date or place." }))).toMatch(/^When was Hannah Pruitt/);
    expect(gapQuestion(gap({ type: "no_birth_info", detail: "Deceased, but the tree gives no birth date." }))).toMatch(/^When was Hannah Pruitt/);
    expect(gapQuestion(gap({ type: "no_birth_info", detail: "Deceased, but the tree gives no birth place." }))).toBe(
      "Where was Hannah Pruitt (1861-1934) born between 1860 and 1864?",
    );
  });

  it("drops the place or the years when the hole has none, rather than printing null", () => {
    const q = gapQuestion(gap({ type: "no_death_date", place: null, yearRange: null, lifespan: null }));
    expect(q).toBe("When did Hannah Pruitt die?");
    expect(gapQuestion(gap({ type: "child_gap", spouseName: undefined }))).toMatch(/^Who were the children born to Hannah Pruitt \(1861-1934\) in/);
  });
});

describe("withQuestions", () => {
  it("puts `question` right after `detail`, keeps one already there, and leaves its input alone", () => {
    const input = [gap({ type: "no_spouse" }), { ...gap({ type: "no_spouse" }), question: "kept" }];
    const out = withQuestions(input);
    const keys = Object.keys(out[0]);
    expect(keys[keys.indexOf("detail") + 1]).toBe("question");
    expect(out[0].question).toMatch(/^Whom did/);
    expect(out[1].question).toBe("kept");
    expect("question" in input[0]).toBe(false);
    expect(withQuestions([])).toEqual([]);
  });
});
