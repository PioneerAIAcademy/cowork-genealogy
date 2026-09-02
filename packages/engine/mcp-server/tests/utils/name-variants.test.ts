import { describe, it, expect, beforeEach } from "vitest";

import {
  lookupNameFamily,
  expandNameForFulltext,
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

describe("expandNameForFulltext", () => {
  it("builds a Lucene OR group for a recognized given name", () => {
    const result = expandNameForFulltext("Elizabeth Martin");
    expect(result).not.toBeNull();
    // The expanded string should have an OR group for Elizabeth and keep Martin
    expect(result!.expanded).toMatch(/^\(Elizabeth OR .+\) Martin$/);
    expect(result!.expanded).toContain("Betty");
    expect(result!.expanded).toContain("Bess");
    expect(result!.expansions).toHaveProperty("Elizabeth");
  });

  it("preserves non-matching tokens as-is", () => {
    const result = expandNameForFulltext("Elizabeth Martin");
    expect(result).not.toBeNull();
    expect(result!.expanded).toMatch(/Martin$/);
    // Martin should not be in an OR group
    expect(result!.expanded).not.toMatch(/Martin OR/);
  });

  it("returns null when no expansion applies", () => {
    expect(expandNameForFulltext("Patrick Flynn")).toBeNull();
    expect(expandNameForFulltext("")).toBeNull();
  });

  it("skips tokens with + operator", () => {
    const result = expandNameForFulltext("+Elizabeth +Martin");
    expect(result).toBeNull();
  });

  it("skips tokens with - operator", () => {
    const result = expandNameForFulltext("-Elizabeth Martin");
    expect(result).toBeNull();
  });

  it("skips tokens containing *", () => {
    const result = expandNameForFulltext("Eliz* Martin");
    expect(result).toBeNull();
  });

  it("skips tokens containing quotes", () => {
    const result = expandNameForFulltext('"Elizabeth Martin"');
    expect(result).toBeNull();
  });

  it("handles single-word names", () => {
    const result = expandNameForFulltext("Elizabeth");
    expect(result).not.toBeNull();
    expect(result!.expanded).toMatch(/^\(Elizabeth OR .+\)$/);
  });

  it("expands from a variant form too (bidirectional)", () => {
    const result = expandNameForFulltext("Betty Martin");
    expect(result).not.toBeNull();
    // Betty should be expanded to include Elizabeth and other variants
    expect(result!.expanded).toContain("Elizabeth");
    expect(result!.expanded).toMatch(/^\(Betty OR .+\) Martin$/);
  });

  it("excludes period-containing forms from the OR group", () => {
    const result = expandNameForFulltext("Elizabeth Martin");
    expect(result).not.toBeNull();
    // Eliz. and Elizth. should not appear in the fulltext expansion
    expect(result!.expanded).not.toContain("Eliz.");
    expect(result!.expanded).not.toContain("Elizth.");
    // But Eliz (without period) should be present
    expect(result!.expanded).toContain(" Eliz)") ;
  });

  it("puts the original token first in the OR group", () => {
    const result = expandNameForFulltext("Elizabeth Martin");
    expect(result).not.toBeNull();
    expect(result!.expanded).toMatch(/^\(Elizabeth OR /);
  });

  it("expands multiple given names in a single string", () => {
    const result = expandNameForFulltext("Elizabeth Mary");
    expect(result).not.toBeNull();
    // Both should be expanded
    expect(result!.expanded).toMatch(/^\(.+\) \(.+\)$/);
    expect(result!.expansions).toHaveProperty("Elizabeth");
    expect(result!.expansions).toHaveProperty("Mary");
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

  it("expands capitalized tokens that match", () => {
    const result = expandLookingFor("Will Smith");
    expect(result).not.toBeNull();
    expect(result!.expanded).toContain("William");
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
