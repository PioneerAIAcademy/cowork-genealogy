import { describe, it, expect } from "vitest";
import { gapQuestion, withQuestions } from "../../src/utils/tree-gap-question.js";
import {
  BOTH_PARENTS_MISSING,
  FATHER_MISSING,
  MOTHER_MISSING,
  NO_BIRTH_DATE,
  NO_BIRTH_DATE_OR_PLACE,
  NO_BIRTH_PLACE,
} from "../../src/utils/tree-gap-detect.js";
import type { TreeGap, TreeGapType } from "../../src/types/tree-gaps.js";

function gap(over: Partial<TreeGap>): TreeGap {
  return {
    type: "no_death_date",
    personId: "P-1",
    name: "Hannah Pruitt",
    lifespan: "1861-1934",
    generation: 1,
    detail: "",
    yearRange: { start: 1860, end: 1864 },
    place: "Lancaster, Pennsylvania",
    coverage: null,
    pendingHints: null,
    ...over,
  };
}

const ALL_TYPES: TreeGapType[] = [
  "missing_parents",
  "no_children",
  "child_gap",
  "early_last_child",
  "missing_surname",
  "no_birth_info",
  "no_spouse",
  "no_death_date",
];

describe("gapQuestion", () => {
  it("asks for the missing parent, or both, using the detector's own detail strings", () => {
    expect(gapQuestion(gap({ type: "missing_parents", detail: BOTH_PARENTS_MISSING }))).toBe(
      "Who were the parents of Hannah Pruitt (1861-1934), born in Lancaster, Pennsylvania between 1860 and 1864?",
    );
    expect(gapQuestion(gap({ type: "missing_parents", detail: FATHER_MISSING }))).toMatch(/^Who was the father of Hannah Pruitt/);
    expect(gapQuestion(gap({ type: "missing_parents", detail: MOTHER_MISSING }))).toMatch(/^Who was the mother of Hannah Pruitt/);
  });

  it("asks one question for a couple's children, whichever of the three child holes it is", () => {
    for (const type of ["no_children", "child_gap", "early_last_child"] as const) {
      expect(
        gapQuestion(gap({ type, name: "Edmund Ashby", spouseName: "Clara Weis", yearRange: { start: 1881, end: 1886 }, place: "Dayton, Ohio" })),
      ).toBe("Who were the children born to Edmund Ashby and Clara Weis in Dayton, Ohio between 1881 and 1886?");
    }
  });

  it("does not claim a marriage place for a maiden surname, and names the spouse only when there is one", () => {
    expect(
      gapQuestion(gap({ type: "missing_surname", name: "Clara", lifespan: "1854-1927", spouseName: "Edmund Ashby", yearRange: { start: 1879, end: 1881 }, place: "Dayton, Ohio" })),
    ).toBe("What was the maiden surname of Clara (1854-1927), wife of Edmund Ashby, of Dayton, Ohio between 1879 and 1881?");
    expect(gapQuestion(gap({ type: "missing_surname", name: "Clara", lifespan: null }))).toBe(
      "What was the maiden surname of Clara, of Lancaster, Pennsylvania between 1860 and 1864?",
    );
  });

  it("does not claim a birthplace for a missing birth date, since the place may be a death or marriage place", () => {
    for (const detail of [NO_BIRTH_DATE, NO_BIRTH_DATE_OR_PLACE]) {
      expect(gapQuestion(gap({ type: "no_birth_info", detail, place: "Chicago, Illinois" }))).toBe(
        "When was Hannah Pruitt (1861-1934), of Chicago, Illinois, born between 1860 and 1864?",
      );
    }
    expect(gapQuestion(gap({ type: "no_birth_info", detail: NO_BIRTH_PLACE }))).toBe(
      "Where was Hannah Pruitt (1861-1934) born between 1860 and 1864?",
    );
  });

  it("asks one spouse and one death date", () => {
    expect(gapQuestion(gap({ type: "no_spouse" }))).toBe(
      "Whom did Hannah Pruitt (1861-1934) marry in Lancaster, Pennsylvania between 1860 and 1864?",
    );
    expect(gapQuestion(gap({ type: "no_death_date" }))).toBe(
      "When did Hannah Pruitt (1861-1934), born in Lancaster, Pennsylvania, die between 1860 and 1864?",
    );
  });

  it("leaves no dangling word or null when a hole has neither place nor years", () => {
    for (const type of ALL_TYPES) {
      const q = gapQuestion(gap({ type, place: null, yearRange: null, lifespan: null, detail: BOTH_PARENTS_MISSING }));
      expect(q).toMatch(/^[A-Z].*\?$/);
      expect(q).not.toMatch(/null|undefined|,\s*\?|,\s*(born|married|of)\?$/);
    }
    expect(gapQuestion(gap({ type: "missing_parents", detail: BOTH_PARENTS_MISSING, place: null, yearRange: null, lifespan: null }))).toBe(
      "Who were the parents of Hannah Pruitt?",
    );
    expect(gapQuestion(gap({ type: "missing_surname", place: null, yearRange: null, lifespan: null }))).toBe(
      "What was the maiden surname of Hannah Pruitt?",
    );
  });

  it("shows a lifespan only when it gives both years", () => {
    for (const lifespan of ["1850-", "-1901", "Deceased", "1861-Deceased", ""]) {
      expect(gapQuestion(gap({ type: "no_spouse", lifespan }))).toMatch(/^Whom did Hannah Pruitt marry/);
    }
  });
});

describe("withQuestions", () => {
  it("puts `question` right after `detail`, keeps the other keys in order, and leaves its input alone", () => {
    const input = [gap({ type: "no_spouse" })];
    const out = withQuestions(input);
    const keys = Object.keys(out[0]);
    expect(keys[keys.indexOf("detail") + 1]).toBe("question");
    expect(keys.filter((k) => k !== "question")).toEqual(Object.keys(input[0]));
    expect(out[0].question).toMatch(/^Whom did/);
    expect("question" in input[0]).toBe(false);
    expect(withQuestions([])).toEqual([]);
  });
});
