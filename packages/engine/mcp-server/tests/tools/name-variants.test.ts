import { describe, it, expect, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getNameVariants } from "../../src/tools/name-variants.js";
import {
  lookupNameVariants,
  __clearVariantCacheForTests,
} from "../../src/utils/name-variants.js";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/name-variants");
const TABLE_A = resolve(FIXTURES_DIR, "table-a.json");
const TABLE_B = resolve(FIXTURES_DIR, "table-b.json");
const NO_GROUPS = resolve(FIXTURES_DIR, "no-groups.json");
const MISSING = resolve(FIXTURES_DIR, "does-not-exist.json");
const MALFORMED_GROUP = resolve(FIXTURES_DIR, "malformed-group.json");
const INVALID_JSON = resolve(FIXTURES_DIR, "invalid.json");
const MIXED_CASE = resolve(FIXTURES_DIR, "mixed-case.json");

beforeEach(() => {
  __clearVariantCacheForTests();
});

describe("getNameVariants (against the real bundled table)", () => {
  it("returns fred's exact variants from Dallan's worked example (row co-occurrence, not transitive)", async () => {
    const result = await getNameVariants({ name: "fred" });
    expect(result.name).toBe("fred");
    expect(result.variants.sort()).toEqual(
      ["alfred", "federico", "freddy", "fredricks", "frederick", "friederich"].sort()
    );
    // Would fail if the loader fell back to the old transitive-merge algorithm,
    // which pulls in unrelated names (e.g. "albert") through the hub name "al".
    expect(result.variants).not.toContain("albert");
    expect(result.variants).not.toContain("alan");
  });

  it("returns alfred's exact variants from Dallan's worked example", async () => {
    const result = await getNameVariants({ name: "alfred" });
    expect(result.variants.sort()).toEqual(["al", "alf", "fred"].sort());
  });

  it("does not repeat a name that appears twice in its own source row", async () => {
    // The "bertha" row in the bundled table lists "birdie" twice.
    const result = await getNameVariants({ name: "birdie" });
    expect(new Set(result.variants).size).toBe(result.variants.length);
  });

  it("is case-insensitive", async () => {
    const result = await getNameVariants({ name: "FRED" });
    expect(result.name).toBe("FRED");
    expect(result.variants).toContain("alfred");
  });

  it("excludes the input's own form from its result", async () => {
    const result = await getNameVariants({ name: "fred" });
    expect(result.variants).not.toContain("fred");
  });

  it("returns an empty list, not an error, for an unrecognized name", async () => {
    const result = await getNameVariants({ name: "xyzzyplugh" });
    expect(result.variants).toEqual([]);
  });

  it("throws on an empty name", async () => {
    await expect(getNameVariants({ name: "" })).rejects.toThrow();
  });

  it("throws on a whitespace-only name", async () => {
    await expect(getNameVariants({ name: "   " })).rejects.toThrow();
  });

  it("throws on a non-string name", async () => {
    // @ts-expect-error deliberately wrong type, to check the runtime guard
    await expect(getNameVariants({ name: 42 })).rejects.toThrow();
  });

  it("trims the input before echoing it back", async () => {
    const result = await getNameVariants({ name: "  fred  " });
    expect(result.name).toBe("fred");
  });
});

describe("lookupNameVariants (loader-level, against small fixture tables)", () => {
  it("does not leak a name from table A into a lookup against table B", () => {
    expect(lookupNameVariants("onlyintablea", TABLE_A, { strict: true })).toEqual(["aformnotinb"]);
    expect(lookupNameVariants("onlyintablea", TABLE_B, { strict: true })).toEqual([]);
  });

  it("returns [] for a missing table path by default", () => {
    expect(lookupNameVariants("anything", MISSING)).toEqual([]);
  });

  it("throws for a missing table path under strict", () => {
    expect(() => lookupNameVariants("anything", MISSING, { strict: true })).toThrow();
  });

  it("throws for a table with no groups array under strict", () => {
    expect(() => lookupNameVariants("anything", NO_GROUPS, { strict: true })).toThrow();
  });

  it("throws for a table with a malformed group (empty-string entry) under strict", () => {
    expect(() => lookupNameVariants("anything", MALFORMED_GROUP, { strict: true })).toThrow();
  });

  it("throws for a table that is not valid JSON under strict", () => {
    expect(() => lookupNameVariants("anything", INVALID_JSON, { strict: true })).toThrow();
  });

  it("does not treat a case/diacritic variant within one row as a distinct variant, and still excludes the query's own form", () => {
    // Proves the BUILD-PHASE normalizeString calls, not just the query-side
    // one: the group ["Ann", "ann", "Anne", "Nan"] has two case-only forms of
    // the same name. A case-sensitive build phase would wrongly return "ann"
    // as if it were a variant of "Ann", rather than recognizing it as the
    // same name.
    const result = lookupNameVariants("Ann", MIXED_CASE, { strict: true });
    expect(result.sort()).toEqual(["Anne", "Nan"].sort());
    expect(result).not.toContain("ann");
  });
});
