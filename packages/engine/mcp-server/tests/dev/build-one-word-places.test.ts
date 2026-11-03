import { describe, it, expect } from "vitest";
import { buildOneWordPlaces, type SourceEntry } from "../../dev/build-one-word-places.js";

const entry = (key: string, text: string, full_name: string, condition_struct: Record<string, unknown>): SourceEntry => ({
  key,
  text,
  spellings: [text],
  full_name,
  condition_struct,
});

describe("buildOneWordPlaces (dev/build-one-word-places.ts)", () => {
  it("carries every kind of entry, sorted by key", () => {
    const built = buildOneWordPlaces({
      entries: [
        entry("texas", "Texas", "Texas, United States", { type: "record_country", country: "United States" }),
        entry("kent", "Kent", "Kent, England, United Kingdom", { type: "always" }),
        entry("louth", "Louth", "County Louth, Ireland", { type: "always", except_record_countries: ["United Kingdom"] }),
        entry("island", "Ísland", "Iceland", { type: "always_accented_only", accented_spellings_required: ["Ísland"] }),
      ],
    });
    expect(built.problems).toEqual([]);
    expect(built.entries).toEqual({
      island: { place: "Iceland", accented_spellings: ["Ísland"] },
      kent: "Kent, England, United Kingdom",
      louth: { place: "County Louth, Ireland", except_record_countries: ["United Kingdom"] },
      texas: { place: "Texas, United States", record_country: "United States" },
    });
    expect(Object.keys(built.entries)).toEqual(["island", "kent", "louth", "texas"]);
    expect(built.counts).toEqual({ always: 1, except_record_countries: 1, record_country: 1, accented_spellings: 1 });
  });

  it.each([
    [{ type: "sometimes" }],
    [{ type: "always", note: "a key the engine would ignore" }],
    [{ type: "always", except_record_countries: [] }],
    [{ type: "record_country" }],
    [{ type: "record_country", country: "United States", except_record_countries: ["Mexico"] }],
    [{ type: "always_accented_only", accented_spellings_excluded: ["Island"] }],
  ])("refuses the condition %j", (condition) => {
    const built = buildOneWordPlaces({ entries: [entry("kent", "Kent", "Kent, England, United Kingdom", condition)] });
    expect(built.problems.join("\n")).toMatch(/"kent": unknown condition/);
  });

  it("refuses an accent-only spelling written without its accent", () => {
    const built = buildOneWordPlaces({
      entries: [entry("island", "Ísland", "Iceland", { type: "always_accented_only", accented_spellings_required: ["Island"] })],
    });
    expect(built.problems.join("\n")).toMatch(/"Island" of "island" carries no accent/);
  });

  it("refuses a spelling that does not fold to its key, and a key listed twice", () => {
    const built = buildOneWordPlaces({
      entries: [
        { ...entry("kent", "Kent", "Kent, England, United Kingdom", { type: "always" }), spellings: ["Kent", "Kentucky"] },
        entry("kent", "Kent", "Kent, England, United Kingdom", { type: "always" }),
      ],
    });
    expect(built.problems.join("\n")).toMatch(/"Kentucky" folds to "kentucky", not its key "kent"/);
    expect(built.problems.join("\n")).toMatch(/two entries for the key "kent"/);
  });
});
