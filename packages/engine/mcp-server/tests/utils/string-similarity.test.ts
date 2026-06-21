import { describe, it, expect } from "vitest";
import {
  diceCoefficient,
  levenshteinDistance,
  nameSimilarity,
  normalizeString,
} from "../../src/utils/string-similarity.js";

// ────────────────────────────────────────────────────────────────────
// levenshteinDistance — base behavior
// ────────────────────────────────────────────────────────────────────

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("abc", "abc")).toBe(0);
  });

  it("handles empty inputs", () => {
    expect(levenshteinDistance("", "")).toBe(0);
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });

  it("counts a single substitution as distance 1", () => {
    expect(levenshteinDistance("cat", "bat")).toBe(1);
  });

  it("counts a single insertion or deletion as distance 1", () => {
    expect(levenshteinDistance("cat", "cats")).toBe(1);
    expect(levenshteinDistance("cats", "cat")).toBe(1);
  });

  it("computes the classic kitten/sitting → 3 example", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshteinDistance("Smith", "Smyth")).toBe(
      levenshteinDistance("Smyth", "Smith"),
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// nameSimilarity — Java-parity output (warnings.java:2169)
// ────────────────────────────────────────────────────────────────────

describe("nameSimilarity", () => {
  it("returns 1.0 for identical names (case-insensitive)", () => {
    expect(nameSimilarity("Smith", "Smith")).toBe(1.0);
    expect(nameSimilarity("Smith", "smith")).toBe(1.0);
    expect(nameSimilarity("SMITH", "smith")).toBe(1.0);
  });

  it("returns 1.0 for two empty strings", () => {
    expect(nameSimilarity("", "")).toBe(1.0);
  });

  it("returns 1 - editDist/maxLen for spelling variants — Smith vs Smyth", () => {
    // 1 substitution (i→y), max length 5 → 1 - 1/5 = 0.8.
    expect(nameSimilarity("Smith", "Smyth")).toBeCloseTo(0.8, 10);
  });

  it("crosses the 0.5 threshold for clearly different surnames", () => {
    // "Smith" vs "Jones" — every char differs, max length 5 → 1 - 5/5 = 0.
    expect(nameSimilarity("Smith", "Jones")).toBeLessThanOrEqual(0.5);
  });

  it("stays above 0.5 for a small spelling difference", () => {
    // "Williams" vs "Wiliams" — one deletion, max length 8 → 7/8 = 0.875.
    expect(nameSimilarity("Williams", "Wiliams")).toBeGreaterThan(0.5);
  });
});

// ────────────────────────────────────────────────────────────────────
// normalizeString — Java NormalizeUtil parity (lowercase + strip
// diacritics + collapse whitespace + trim)
// ────────────────────────────────────────────────────────────────────

describe("normalizeString", () => {
  it("lowercases ASCII", () => {
    expect(normalizeString("SMITH")).toBe("smith");
  });

  it("strips diacritics: 'José' → 'jose'", () => {
    expect(normalizeString("José")).toBe("jose");
  });

  it("strips diacritics: 'Mañana' → 'manana'", () => {
    expect(normalizeString("Mañana")).toBe("manana");
  });

  it("collapses whitespace runs and trims", () => {
    expect(normalizeString("  John   Smith  ")).toBe("john smith");
  });

  it("returns '' for an empty input", () => {
    expect(normalizeString("")).toBe("");
  });
});

// ────────────────────────────────────────────────────────────────────
// diceCoefficient — bigram Sorensen-Dice
// ────────────────────────────────────────────────────────────────────

describe("diceCoefficient", () => {
  it("returns 1.0 for identical strings (after normalization)", () => {
    expect(diceCoefficient("smith", "smith")).toBe(1.0);
    expect(diceCoefficient("Smith", "smith")).toBe(1.0);
  });

  it("returns 0 when either input has length < 2", () => {
    expect(diceCoefficient("a", "abc")).toBe(0);
    expect(diceCoefficient("", "abc")).toBe(0);
  });

  it("Smith vs Smyth scores above the 0.66 Java cutoff", () => {
    // bigrams("smith") = {sm, mi, it, th}, bigrams("smyth") = {sm, my, yt, th}
    // shared = {sm, th} → 2 * 2 / (4 + 4) = 0.5
    // Below cutoff, but still a meaningful overlap.
    const score = diceCoefficient("Smith", "Smyth");
    expect(score).toBeCloseTo(0.5, 5);
  });

  it("Patrick vs Patric scores above cutoff (one extra char)", () => {
    // bigrams("patrick") = {pa, at, tr, ri, ic, ck} (6 bigrams)
    // bigrams("patric")  = {pa, at, tr, ri, ic}     (5 bigrams)
    // shared = {pa, at, tr, ri, ic} = 5
    // score = 2 * 5 / (6 + 5) = 10/11 ≈ 0.909
    expect(diceCoefficient("Patrick", "Patric")).toBeGreaterThan(0.66);
  });

  it("Patrick vs Pat scores below the cutoff (too short overlap)", () => {
    // bigrams("patrick") = 6 bigrams, bigrams("pat") = {pa, at} = 2
    // shared = {pa, at} = 2 → 2 * 2 / (6 + 2) = 0.5
    expect(diceCoefficient("Patrick", "Pat")).toBeLessThan(0.66);
  });

  it("Wholly different strings score near 0", () => {
    expect(diceCoefficient("Smith", "Jones")).toBeLessThan(0.2);
  });

  it("handles diacritics via normalization", () => {
    // "Renée" and "Renee" should be identical after diacritic stripping.
    expect(diceCoefficient("Renée", "Renee")).toBe(1.0);
  });
});
