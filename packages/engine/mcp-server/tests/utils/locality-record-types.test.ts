import { describe, it, expect } from "vitest";
import { deriveRowFields, fillRecordTypeRows, recordTypeOfTitle } from "../../src/utils/locality-record-types.js";

const entry = (extra: Record<string, unknown> = {}) => ({
  collections: [
    { id: "1", title: "Pennsylvania, Death Certificates, 1906-1968", date_range: "1906-1968", person_count: 6542331 },
    { id: "2", title: "Pennsylvania, Schuylkill County Church Records", date_range: "1830-1920", person_count: 0 },
    { id: "3", title: "Pennsylvania, Probate Records, 1683-1994", date_range: "1683-1994", person_count: 0 },
    { id: "4", title: "United States Census, 1880", date_range: "1880", person_count: 50000000 },
    { id: "5", title: "Pennsylvania, County Marriages, 1885-1950", date_range: "1885-1950", person_count: 1200 },
  ],
  volume_summary: {
    total_volumes: 20,
    complete: true,
    by_record_type: [
      { group: "Probate", volumes: 6, browse_only: 4, fulltext_only: 2 },
      { group: "Land", volumes: 3, browse_only: 0, fulltext_only: 3 },
      { group: "Military", volumes: 2, browse_only: null, fulltext_only: null },
    ],
    untyped: { volumes: 0, browse_only: 0, fulltext_only: 0 },
  },
  ...extra,
});

describe("recordTypeOfTitle", () => {
  it.each([
    ["England, Births and Christenings, 1538-1975", "church"],
    ["Pennsylvania, Death Certificates, 1906-1968", "vital_record"],
    ["United States Census, 1880", "census"],
    ["Find a Grave Index", "cemetery"],
    ["New York, Passenger Lists, 1820-1957", "immigration"],
    ["Pennsylvania, Probate Records, 1683-1994", "probate"],
    ["Ohio, County Court Records", "court"],
    ["Massachusetts, Land Records, 1620-1986", "land"],
    ["United States, Civil War Soldiers Index", "military"],
    ["England, Tithe Apportionments", "tax"],
    ["United States, GenealogyBank Obituaries", "newspaper"],
    ["England and Wales, School Admission Registers", null],
  ])("%s → %s", (title, type) => {
    expect(recordTypeOfTitle(title)).toBe(type);
  });
});

describe("fillRecordTypeRows", () => {
  it("fills collections, years and access from the entry's collections and volume counts", () => {
    const e = entry({
      record_types: [
        { type: "vital_record", summary: "x" },
        { type: "church", summary: "x" },
        { type: "probate", summary: "x" },
        { type: "land", summary: "x" },
        { type: "military", summary: "x" },
        { type: "tax", summary: "x" },
      ],
    });
    fillRecordTypeRows(e);
    const byType = Object.fromEntries(e.record_types.map((r: any) => [r.type, r]));
    expect(byType.vital_record).toMatchObject({ collection_ids: ["1", "5"], years: "1885-1968", access: "indexed" });
    expect(byType.church).toMatchObject({ collection_ids: ["2"], years: "1830-1920", access: "browse" });
    expect(byType.probate).toMatchObject({ collection_ids: ["3"], years: "1683-1994", access: "fulltext" });
    expect(byType.land).toMatchObject({ access: "fulltext" });
    expect(byType.land.collection_ids).toBeUndefined();
    expect(byType.military.access).toBe("unknown");
    expect(byType.tax).toEqual({ type: "tax", summary: "x", access: "unknown" });
  });

  it("never overwrites what the agent sent, and fills only the first row of a type", () => {
    const e = entry({
      record_types: [
        { type: "vital_record", years: "1906-", access: "physical", collection_ids: ["9"], summary: "x" },
        { type: "church", summary: "Catholic" },
        { type: "church", summary: "Lutheran", access: "lost" },
        { type: "census", access: "unknown", summary: "x" },
      ],
    });
    fillRecordTypeRows(e);
    expect(e.record_types[0]).toEqual({ type: "vital_record", years: "1906-", access: "physical", collection_ids: ["9"], summary: "x" });
    expect(e.record_types[1]).toMatchObject({ collection_ids: ["2"], access: "browse" });
    expect(e.record_types[2]).toEqual({ type: "church", summary: "Lutheran", access: "lost" });
    expect(e.record_types[3]).toMatchObject({ access: "indexed", collection_ids: ["4"] });
  });

  it("leaves an entry with no rows alone", () => {
    const e = entry();
    expect(fillRecordTypeRows(e)).toBe(0);
    expect(e).not.toHaveProperty("record_types");
    expect(deriveRowFields({}).size).toBe(0);
  });
});
