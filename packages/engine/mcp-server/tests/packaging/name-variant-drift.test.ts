import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Drift guard for config/given-name-variants.json — the bundled vocabulary that
// drives diminutive expansion in fulltext_search and image_transcribe.
// Pattern: tests/packaging/record-type-group-drift.test.ts.
//
// The JSON was hand-seeded from two markdown tables. This test parses both
// tables and checks that the JSON reflects their content — forward (every seed
// form is in the JSON) and backward (every JSON form traces to a seed). Without
// this, planting "Bessie" for "Bess" passes the structural checks.

const here = dirname(fileURLToPath(import.meta.url));
const tablePath = join(here, "..", "..", "config", "given-name-variants.json");
const strategiesPath = join(
  here, "..", "..", "..", "plugin", "skills",
  "search-full-text", "references", "search-strategies.md",
);
const mechanicsPath = join(
  here, "..", "..", "..", "plugin", "skills",
  "search-records", "references", "name-search-mechanics.md",
);

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

// --- Seed table parsing ---

const strategies = readFileSync(strategiesPath, "utf-8");
const mechanics = readFileSync(mechanicsPath, "utf-8");

/** Parse a pipe-delimited markdown table into formal -> Set<form>. */
function parseSeedTable(
  content: string,
  header: string,
): Map<string, Set<string>> {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.startsWith(header));
  if (start === -1) return new Map();
  const result = new Map<string, Set<string>>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    const formalCell = cells[0];
    const formsRaw = cells[1]
      .split(",")
      .map((f) => f.replace(/\s*\([^)]*\)$/, "").trim())
      .filter(Boolean);
    // "Catherine/Katherine" -> two entries sharing the same forms.
    for (const fn of formalCell.split("/").map((f) => f.trim())) {
      const existing = result.get(fn) ?? new Set<string>();
      for (const f of formsRaw) existing.add(f);
      result.set(fn, existing);
    }
  }
  return result;
}

const abbrSeed = parseSeedTable(
  strategies,
  "| Formal | Abbreviations to search separately |",
);
const nickSeed = parseSeedTable(
  mechanics,
  "| Formal | Nicknames seen in records |",
);

/** Union of both seed tables: formal -> Set<all forms>. */
const allSeedForms = new Map<string, Set<string>>();
for (const [formal, forms] of [...abbrSeed, ...nickSeed]) {
  const existing = allSeedForms.get(formal) ?? new Set<string>();
  for (const f of forms) existing.add(f);
  allSeedForms.set(formal, existing);
}

// Forms deliberately excluded from the JSON — cross-language cognates tagged
// as foreign in the seed tables or classified as such in _meta.out_of_scope.
const OUT_OF_SCOPE = new Set(["Hans", "Honza", "Diego", "Paco", "Pepe"]);

/** All variant .form values for one JSON formal name. */
function jsonForms(formal: string): Set<string> {
  const entry = en[formal];
  if (!entry) return new Set();
  return new Set(entry.variants.map((v) => v.form));
}

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

describe("given-name-variants.json agrees with its seed tables", () => {
  it("parses both seed tables", () => {
    expect(
      abbrSeed.size,
      "abbreviation table: expected 14 formal names — if the header changed, " +
        "fix this parser rather than deleting the test",
    ).toBe(14);
    // 16 rows but Catherine/Katherine splits to two map keys.
    expect(
      nickSeed.size,
      "nicknames table: expected 17 formal-name keys " +
        "(Catherine/Katherine splits to two)",
    ).toBe(17);
  });

  it("covers the same set of formal names as the seeds", () => {
    const seedFormals = [...allSeedForms.keys()].sort();
    const jsonFormals = [...formalNames].sort();
    expect(jsonFormals).toEqual(seedFormals);
  });

  it("every seed form (minus out_of_scope) is present in the JSON", () => {
    const missing: string[] = [];
    for (const [formal, seedForms] of allSeedForms) {
      const jf = jsonForms(formal);
      for (const form of seedForms) {
        if (OUT_OF_SCOPE.has(form)) continue;
        if (!jf.has(form)) {
          missing.push(`${formal}: seed has "${form}" but JSON does not`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every JSON variant form traces to a seed table", () => {
    const extra: string[] = [];
    for (const [formal, entry] of Object.entries(en)) {
      const seedForms = allSeedForms.get(formal);
      for (const v of entry.variants) {
        if (!seedForms || !seedForms.has(v.form)) {
          extra.push(`${formal}: JSON has "${v.form}" but no seed does`);
        }
      }
    }
    expect(extra).toEqual([]);
  });

  it("out_of_scope forms are absent from the JSON", () => {
    const leaked: string[] = [];
    for (const [formal, entry] of Object.entries(en)) {
      for (const v of entry.variants) {
        if (OUT_OF_SCOPE.has(v.form)) {
          leaked.push(`${formal}: "${v.form}" is out_of_scope but present`);
        }
      }
    }
    expect(leaked).toEqual([]);
  });
});
