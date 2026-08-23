import { describe, it, expect } from "vitest";
import { formatYearRange } from "../../src/utils/search-helpers.js";

/**
 * Contract: docs/specs/volume-search-tool-spec.md § "Mapping logic", which
 * requires `volume_search`'s `dateRange` fallback to match `collections_search`
 * "exactly — including when the years are equal".
 *
 * Both callers went through this shape before it was one function, and only the
 * both-years branch was asserted anywhere (`collections-search.test.ts`, one
 * `dateRange` expectation). The other three were the branches a second caller
 * was most likely to quietly redefine, so they are pinned here.
 */
describe("formatYearRange", () => {
  it("joins both years", () => {
    expect(formatYearRange(1809, 1950)).toBe("1809-1950");
  });

  it("does NOT collapse equal years", () => {
    // The one behaviour a second caller is tempted to 'improve': a coverage
    // whose own display text reads "1873" still renders as a range here, so
    // volume_search and collections_search cannot describe one span two ways.
    expect(formatYearRange(1873, 1873)).toBe("1873-1873");
  });

  it("returns the bare start year when only startYear is present", () => {
    expect(formatYearRange(1809, undefined)).toBe("1809");
  });

  it("returns empty for a lone endYear — only startYear is special-cased", () => {
    // Asymmetric on purpose: this is the pre-existing collections_search
    // behaviour, preserved byte-for-byte. Callers with an optional field read
    // "" as "omit". Measured as never occurring upstream (0 of 5,950 pairs).
    expect(formatYearRange(undefined, 1950)).toBe("");
  });

  it("returns empty when neither year is present", () => {
    expect(formatYearRange(undefined, undefined)).toBe("");
  });
});
