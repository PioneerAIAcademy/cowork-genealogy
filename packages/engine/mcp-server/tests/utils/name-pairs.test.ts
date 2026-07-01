import { describe, it, expect } from "vitest";
import { getSimilarNamePairs } from "../../src/utils/name-pairs.js";
import type { SimplifiedPerson } from "../../src/types/gedcomx.js";

function p(
  id: string,
  given: string,
  surname?: string,
  extraNames: Array<{ given?: string; surname?: string }> = [],
): SimplifiedPerson {
  return {
    id,
    names: [{ given, surname }, ...extraNames],
  };
}

describe("getSimilarNamePairs — Dice cutoff signal", () => {
  it("finds a pair when given names are highly similar (Patrick vs Patric)", () => {
    const pairs = getSimilarNamePairs(
      [p("I1", "Patrick", "Flynn")],
      [p("I2", "Patric", "Flynn")],
      [],
      true, // compareGivenOnly
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual(["I1", "I2"]);
  });

  it("does NOT find a pair when names are unrelated (Patrick vs Quentin)", () => {
    const pairs = getSimilarNamePairs(
      [p("I1", "Patrick", "Flynn")],
      [p("I2", "Quentin", "Flynn")],
      [],
      true,
    );
    expect(pairs).toHaveLength(0);
  });

  it("ignores diacritics: Renée vs Renee → similar", () => {
    const pairs = getSimilarNamePairs(
      [p("I1", "Renée", "Smith")],
      [p("I2", "Renee", "Smith")],
      [],
      true,
    );
    expect(pairs).toHaveLength(1);
  });
});

describe("getSimilarNamePairs — subset signal", () => {
  it("matches 'John' vs 'John Smith' as a subset hit (given-only mode disables this)", () => {
    // In given-only mode, only the given name is compared, so "John" vs
    // "John" — that's a Dice = 1.0 hit, NOT a subset hit. The subset
    // signal only meaningfully fires when full names are compared.
    const pairs = getSimilarNamePairs(
      [p("I1", "John")],
      [p("I2", "John", "Smith")],
      [],
      true,
    );
    expect(pairs).toHaveLength(1);
  });

  it("matches when one full name is a subset of another (compareGivenOnly=false)", () => {
    // Full names "john" vs "john smith". parts1 = ["john"], parts2 = ["john","smith"].
    // shared = 1, parts1.unshared = 0, parts2.unshared = 1 → subset hit.
    const pairs = getSimilarNamePairs(
      [p("I1", "John")],
      [p("I2", "John", "Smith")],
      [],
      false,
    );
    expect(pairs).toHaveLength(1);
  });

  it("does NOT match unrelated full names (compareGivenOnly=false)", () => {
    const pairs = getSimilarNamePairs(
      [p("I1", "Alice", "Brown")],
      [p("I2", "Robert", "Davis")],
      [],
      false,
    );
    expect(pairs).toHaveLength(0);
  });
});

describe("getSimilarNamePairs — pair canonicalization and self-skip", () => {
  it("returns each pair at most once when given the same list twice", () => {
    const list = [p("I1", "John", "Smith"), p("I2", "John", "Smith")];
    const pairs = getSimilarNamePairs(list, list, [], false);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual(["I1", "I2"]);
  });

  it("skips comparing a person with themselves (diagonal)", () => {
    const list = [p("I1", "Solo", "Singleton")];
    const pairs = getSimilarNamePairs(list, list, [], false);
    expect(pairs).toHaveLength(0);
  });

  it("orders the returned pair canonically (lower id first)", () => {
    const pairs = getSimilarNamePairs(
      [p("I2", "Mary", "Brown")],
      [p("I1", "Mary", "Brown")],
      [],
      false,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0][0] < pairs[0][1]).toBe(true);
  });
});

describe("getSimilarNamePairs — noise-name filter", () => {
  it("ignores a name when it appears in the noiseNames list", () => {
    // If "smith" is noise, two spouses both named "John Smith" share only
    // the noise → no signal remains.
    const pairs = getSimilarNamePairs(
      [p("I1", "John", "Smith")],
      [p("I2", "John", "Smith")],
      ["john smith"], // entire normalized full-name is noise
      false,
    );
    expect(pairs).toHaveLength(0);
  });
});

describe("getSimilarNamePairs — edge cases", () => {
  it("returns an empty array when either side has no comparable names", () => {
    const pairs = getSimilarNamePairs(
      [{ id: "I1", names: [] }],
      [p("I2", "John", "Smith")],
      [],
      true,
    );
    expect(pairs).toEqual([]);
  });

  it("returns an empty array when persons have no id", () => {
    const pairs = getSimilarNamePairs(
      [{ names: [{ given: "John", surname: "Smith" }] }],
      [{ names: [{ given: "John", surname: "Smith" }] }],
      [],
      false,
    );
    expect(pairs).toEqual([]);
  });
});
