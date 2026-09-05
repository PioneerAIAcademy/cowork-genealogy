import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Drift guard for config/given-name-variants.json — the bundled vocabulary that
// drives diminutive expansion in fulltext_search and image_transcribe.
// Pattern: tests/packaging/record-type-group-drift.test.ts.

const here = dirname(fileURLToPath(import.meta.url));
const tablePath = join(here, "..", "..", "config", "given-name-variants.json");

interface VariantEntry {
  form: string;
  attested: boolean;
  source?: string;
}

interface FormalEntry {
  period: string;
  region: string;
  source: string;
  variants: VariantEntry[];
}

const raw = readFileSync(tablePath, "utf-8");
const table = JSON.parse(raw) as {
  _meta: Record<string, unknown>;
  en?: Record<string, FormalEntry>;
};

const en = table.en ?? {};
const formalNames = Object.keys(en);

describe("given-name-variants.json structure", () => {
  it("parses without error and has an _meta key", () => {
    expect(table._meta).toBeDefined();
    expect(typeof table._meta).toBe("object");
  });

  it("has an en section with entries", () => {
    expect(formalNames.length).toBeGreaterThan(0);
  });

  it("contains exactly 21 formal names", () => {
    expect(
      formalNames.length,
      `expected 21 formal names, got ${formalNames.length}: [${formalNames.join(", ")}]`,
    ).toBe(21);
  });

  it("every formal name has period, region, source, and a non-empty variants array", () => {
    const bad: string[] = [];
    for (const [name, entry] of Object.entries(en)) {
      const missing: string[] = [];
      if (typeof entry.period !== "string") missing.push("period");
      if (typeof entry.region !== "string") missing.push("region");
      if (typeof entry.source !== "string") missing.push("source");
      if (!Array.isArray(entry.variants) || entry.variants.length === 0) missing.push("variants");
      if (missing.length) bad.push(`${name}: missing ${missing.join(", ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("every variant has form (string) and attested (boolean)", () => {
    const bad: string[] = [];
    for (const [name, entry] of Object.entries(en)) {
      for (const v of entry.variants) {
        const issues: string[] = [];
        if (typeof v.form !== "string" || !v.form) issues.push("form");
        if (typeof v.attested !== "boolean") issues.push("attested");
        if (issues.length) bad.push(`${name} / ${v.form ?? "?"}: missing ${issues.join(", ")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
