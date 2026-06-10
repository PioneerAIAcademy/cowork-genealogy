import { describe, it, expect } from "vitest";
import {
  levenshteinDistance,
  nameSimilarity,
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
