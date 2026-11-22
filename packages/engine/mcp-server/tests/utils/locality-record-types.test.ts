import { describe, it, expect } from "vitest";
import { collectionIdsByType, fillRecordTypeRows, recordTypeOfTitle } from "../../src/utils/locality-record-types.js";

const entry = (extra: Record<string, unknown> = {}): Record<string, any> => ({
  collections: [
    { id: "1", title: "Pennsylvania, Death Certificates, 1906-1968", date_range: "1906-1968", person_count: 6542331 },
    { id: "2", title: "Pennsylvania, Schuylkill County Church Records", date_range: "1830-1920", person_count: 0 },
    { id: "3", title: "Pennsylvania, Probate Records, 1683-1994", date_range: "1683-1994", person_count: 0 },
    { id: "4", title: "United States Census, 1880", date_range: "1880", person_count: 50000000 },
    { id: "5", title: "Pennsylvania, County Marriages, 1885-1950", date_range: "1885-1950", person_count: 1200 },
  ],
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
  it("gives each type's first row its collections' ids, and fills neither years nor an online access", () => {
    const e = entry({
      record_types: [
        { type: "vital_record", summary: "x" },
        { type: "church", summary: "x" },
        { type: "tax", summary: "x" },
      ],
    });
    fillRecordTypeRows(e);
    expect(e.record_types).toEqual([
      { type: "vital_record", summary: "x", collection_ids: ["1", "5"], access: "unknown" },
      { type: "church", summary: "x", collection_ids: ["2"], access: "unknown" },
      { type: "tax", summary: "x", access: "unknown" },
    ]);
  });

  it("never overwrites what the agent sent, and fills only the first row of a type", () => {
    const e = entry({
      record_types: [
        { type: "vital_record", years: "1906-", access: "physical", collection_ids: ["9"], summary: "x" },
        { type: "church", summary: "Catholic" },
        { type: "church", summary: "Lutheran", access: "lost" },
      ],
    });
    fillRecordTypeRows(e);
    expect(e.record_types[0]).toEqual({ type: "vital_record", years: "1906-", access: "physical", collection_ids: ["9"], summary: "x" });
    expect(e.record_types[1]).toEqual({ type: "church", summary: "Catholic", collection_ids: ["2"], access: "unknown" });
    expect(e.record_types[2]).toEqual({ type: "church", summary: "Lutheran", access: "lost" });
  });

  it("leaves an entry with no rows alone", () => {
    const e = entry();
    expect(fillRecordTypeRows(e)).toBe(0);
    expect(e).not.toHaveProperty("record_types");
    expect(collectionIdsByType({}).size).toBe(0);
  });
});
