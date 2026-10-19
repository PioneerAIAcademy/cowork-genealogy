import { describe, it, expect, beforeEach } from "vitest";

import {
  lookupNameFamily,
  expandLookingFor,
  __clearVariantCacheForTests,
} from "../../src/utils/name-variants.js";

beforeEach(() => {
  __clearVariantCacheForTests();
});

describe("lookupNameFamily", () => {
  it("returns the family for a formal name", () => {
    const family = lookupNameFamily("Elizabeth");
    expect(family).not.toBeNull();
    expect(family!.formal).toBe("Elizabeth");
    expect(family!.allForms).toContain("Elizabeth");
    expect(family!.allForms).toContain("Betty");
    expect(family!.allForms).toContain("Bess");
    expect(family!.allForms).toContain("Eliza");
  });

  it("returns the family for a variant form (bidirectional)", () => {
    const family = lookupNameFamily("Betty");
    expect(family).not.toBeNull();
    expect(family!.formal).toBe("Elizabeth");
    expect(family!.allForms).toContain("Elizabeth");
    expect(family!.allForms).toContain("Betty");
  });

  it("is case-insensitive", () => {
    const lower = lookupNameFamily("elizabeth");
    const upper = lookupNameFamily("ELIZABETH");
    const mixed = lookupNameFamily("eLiZaBeTh");
    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    expect(mixed).not.toBeNull();
    expect(lower!.formal).toBe("Elizabeth");
    expect(upper!.formal).toBe("Elizabeth");
    expect(mixed!.formal).toBe("Elizabeth");
  });

  it("returns null for unknown names", () => {
    expect(lookupNameFamily("Xyzzy")).toBeNull();
    expect(lookupNameFamily("Martin")).toBeNull();
    expect(lookupNameFamily("")).toBeNull();
  });

  it("merges Catherine and Katherine into one family", () => {
    const fromCatherine = lookupNameFamily("Catherine");
    const fromKatherine = lookupNameFamily("Katherine");
    const fromKate = lookupNameFamily("Kate");
    expect(fromCatherine).not.toBeNull();
    expect(fromKatherine).not.toBeNull();
    expect(fromKate).not.toBeNull();

    // All three lookups should resolve to the same family
    expect(fromCatherine!.allForms).toContain("Catherine");
    expect(fromCatherine!.allForms).toContain("Katherine");
    expect(fromCatherine!.allForms).toContain("Kate");
    expect(fromKatherine!.allForms).toContain("Catherine");
    expect(fromKate!.allForms).toContain("Katherine");
  });

  it("includes the three attested variants", () => {
    // Betty→Elizabeth, Peggy→Margaret, Polly→Mary
    expect(lookupNameFamily("Betty")!.formal).toBe("Elizabeth");
    expect(lookupNameFamily("Peggy")!.formal).toBe("Margaret");
    expect(lookupNameFamily("Polly")!.formal).toBe("Mary");
  });
});

describe("expandLookingFor", () => {
  it("builds a natural-language expansion", () => {
    const result = expandLookingFor("Elizabeth Martin");
    expect(result).not.toBeNull();
    expect(result!.expanded).toMatch(
      /^Elizabeth Martin \(also known as .+\)$/
    );
    expect(result!.expanded).toContain("Betty");
    expect(result!.expanded).toContain("Bess");
  });

  it("includes period-containing forms (scribal abbreviations)", () => {
    const result = expandLookingFor("Elizabeth Martin");
    expect(result).not.toBeNull();
    // VLM reads natural language — periods are fine here
    expect(result!.expanded).toContain("Eliz.");
  });

  it("returns null when no expansion applies", () => {
    expect(expandLookingFor("Patrick Flynn")).toBeNull();
    expect(expandLookingFor("")).toBeNull();
  });

  it("includes the formal name when searching by variant", () => {
    const result = expandLookingFor("Betty Martin");
    expect(result).not.toBeNull();
    expect(result!.expanded).toContain("Elizabeth");
  });

  it("skips lowercase tokens that match common words", () => {
    // "will" and "may" are in the table but are ordinary English words
    expect(expandLookingFor("the last will and testament")).toBeNull();
    expect(expandLookingFor("marked in may")).toBeNull();
  });

  it("skips ambiguous words without an adjacent proper name", () => {
    // "MAY" in a date context — "1774" is not capitalized, "29" is not → skip MAY
    expect(expandLookingFor("born 12 May 1877")).toBeNull();
    // "MAY" surrounded by numbers/lowercase → skip
    expect(expandLookingFor("29 MAY 1774")).toBeNull();
  });

  it("skips ambiguous words in isolation", () => {
    // "Will" alone has no adjacent capital → skip
    expect(expandLookingFor("Will")).toBeNull();
    // "May" alone → skip
    expect(expandLookingFor("May")).toBeNull();
  });

  it("expands ambiguous words with an adjacent proper name", () => {
    // "Will Smith" — "Smith" starts with S → expand Will
    const result = expandLookingFor("Will Smith");
    expect(result).not.toBeNull();
    expect(result!.expanded).toContain("William");
  });

  it("expands May when next to a proper name", () => {
    const result = expandLookingFor("May Thornton");
    expect(result).not.toBeNull();
    expect(result!.expanded).toContain("Mary");
  });

  it("expands non-ambiguous capitalized tokens normally", () => {
    // "Elizabeth" is not ambiguous — expands without adjacency check
    const result = expandLookingFor("Elizabeth");
    expect(result).not.toBeNull();
    expect(result!.expanded).toContain("Betty");
  });

  it("deduplicates variant forms across multiple matches", () => {
    // Catherine and Katherine share Kate — merged family means no dups
    const result = expandLookingFor("Kate");
    expect(result).not.toBeNull();
    const parts = result!.expanded.match(/also known as (.+)\)/)?.[1] ?? "";
    const forms = parts.split(", ");
    const unique = new Set(forms);
    expect(forms.length).toBe(unique.size);
  });
});
