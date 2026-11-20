import { describe, expect, it } from "vitest";
import {
  FULLTEXT_ADVICE_KEYS,
  NAME_FIELD_RETRY_NOTE,
  TOO_MANY_RESULTS_NOTE,
  fulltextAdvice,
} from "../../src/utils/fulltext-advice.js";

describe("fulltextAdvice: nameFieldRetry", () => {
  it("fires on a keywords-only nil", () => {
    expect(fulltextAdvice({ keywords: "+Flynn +Schuylkill" }, 0)).toEqual({
      nameFieldRetry: NAME_FIELD_RETRY_NOTE,
    });
  });

  it("ignores arguments that do not narrow the search", () => {
    const input = { keywords: "+Flynn", includeFacets: true, count: 20, offset: 0, projectPath: "/p" };
    expect(fulltextAdvice(input, 0).nameFieldRetry).toBe(NAME_FIELD_RETRY_NOTE);
  });

  it("reads a blank name or filter as not sent", () => {
    expect(fulltextAdvice({ keywords: "+Flynn", name: "", place: "  " }, 0).nameFieldRetry).toBe(
      NAME_FIELD_RETRY_NOTE,
    );
  });

  it.each([
    ["place", { place: "Schuylkill, Pennsylvania" }],
    ["yearFrom", { yearFrom: 1870 }],
    ["yearTo", { yearTo: 1889 }],
    ["recordType", { recordType: "Probate" }],
    ["collectionId", { collectionId: "2220359" }],
    ["imageGroupNumber", { imageGroupNumber: "004022578" }],
    ["recordPlace0", { recordPlace0: "10,Pennsylvania" }],
    ["recordPlace3", { recordPlace3: "x" }],
  ])("is silent on a nil held by %s", (_name, filter) => {
    expect(fulltextAdvice({ keywords: "+Flynn", ...filter }, 0)).toEqual({});
  });

  it("is silent when the Name field was already sent", () => {
    expect(fulltextAdvice({ keywords: "+Flynn", name: "Thomas Flynn" }, 0)).toEqual({});
    expect(fulltextAdvice({ name: "Thomas Flynn" }, 0)).toEqual({});
  });

  it("is silent on a blank keywords, an nlQuery search, and a search that found something", () => {
    expect(fulltextAdvice({ keywords: "   " }, 0)).toEqual({});
    expect(fulltextAdvice({ keywords: "+Flynn", nlQuery: "KWCJ-RN4" }, 0)).toEqual({});
    expect(fulltextAdvice({ keywords: "+Flynn" }, 1)).toEqual({});
  });
});

describe("fulltextAdvice: tooManyResults", () => {
  it("fires above 500 on a keywords search", () => {
    expect(fulltextAdvice({ keywords: "+Flynn" }, 847)).toEqual({ tooManyResults: TOO_MANY_RESULTS_NOTE });
    expect(fulltextAdvice({ keywords: "+Flynn", place: "Schuylkill" }, 501).tooManyResults).toBeDefined();
  });

  it.each([500, 12, 0])("is silent at %d", (total) => {
    expect(fulltextAdvice({ keywords: "+Flynn", place: "x" }, total).tooManyResults).toBeUndefined();
  });

  it.each([["a string", "847"], ["NaN", Number.NaN], ["undefined", undefined], ["null", null]])(
    "is silent when the total is %s",
    (_name, total) => {
      expect(fulltextAdvice({ keywords: "+Flynn" }, total)).toEqual({});
    },
  );

  it("is silent on a search with no keywords, an nlQuery search, and a later page", () => {
    expect(fulltextAdvice({ name: "Thomas Flynn" }, 847)).toEqual({});
    expect(fulltextAdvice({ nlQuery: "KWCJ-RN4" }, 847)).toEqual({});
    expect(fulltextAdvice({ keywords: "+Flynn", nlQuery: "KWCJ-RN4" }, 847)).toEqual({});
    expect(fulltextAdvice({ keywords: "+Flynn", offset: 20 }, 847)).toEqual({});
  });
});

it("lists every key the function can return", () => {
  const all = { ...fulltextAdvice({ keywords: "+Flynn" }, 0), ...fulltextAdvice({ keywords: "+Flynn" }, 847) };
  expect(Object.keys(all).sort()).toEqual([...FULLTEXT_ADVICE_KEYS].sort());
});
