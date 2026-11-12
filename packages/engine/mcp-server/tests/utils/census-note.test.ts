import { describe, expect, it } from "vitest";
import { censusNote, CENSUS_SCHEDULES_NOTE, MAX_CENSUS_SCHEDULES } from "../../src/utils/census-note.js";

const PA_1850 = {
  recordType: "census",
  residenceYearFrom: 1850,
  residenceYearTo: 1850,
  residencePlace: "Schuylkill County, Pennsylvania, United States",
};

describe("censusNote", () => {
  it("gives the 1850 US census and says it has no relationship column", () => {
    const note = censusNote(PA_1850);
    expect(note?.schedules).toEqual([
      {
        year: 1850,
        census: "United States",
        collectionId: "1401638",
        recorded: expect.stringContaining("no relationship-to-head column"),
      },
    ]);
    expect(note?.note).toBe(CENSUS_SCHEDULES_NOTE);
  });

  it("says the 1880 US census states relationships", () => {
    const note = censusNote({ ...PA_1850, residenceYearFrom: 1880, residenceYearTo: 1880 });
    expect(note?.schedules[0].recorded).toContain("states each one's relationship");
  });

  it("says a 1790-1840 US census names only heads of household", () => {
    const note = censusNote({ ...PA_1850, residenceYearFrom: 1820, residenceYearTo: 1820 });
    expect(note?.schedules[0].recorded).toContain("only the head");
  });

  it("puts the British relationship column at 1851, not 1880", () => {
    const place = "Maidstone, Kent, England, United Kingdom";
    const y1841 = censusNote({ recordType: "census", residenceYearFrom: 1841, residenceYearTo: 1841, residencePlace: place });
    // The table has no England and Wales row for 1851; 1861 is the first after the column began.
    const y1861 = censusNote({ recordType: "census", residenceYearFrom: 1861, residenceYearTo: 1861, residencePlace: place });
    expect(y1841?.schedules[0].recorded).toContain("no relationship-to-head column");
    expect(y1861?.schedules[0].recorded).toContain("states each one's relationship");
  });

  it("says nothing about what a census recorded where the table does not know", () => {
    const note = censusNote({
      recordType: "census",
      residenceYearFrom: 1865,
      residenceYearTo: 1865,
      residencePlace: "Ringsaker, Hedmark, Norway",
    });
    for (const s of note?.schedules ?? []) expect(s.recorded).toBeUndefined();
  });

  it("fires on a single residence year without recordType", () => {
    const { recordType: _dropped, ...rest } = PA_1850;
    expect(censusNote(rest)?.schedules[0].year).toBe(1850);
  });

  it("stays silent on a residence range without recordType", () => {
    expect(
      censusNote({ residenceYearFrom: 1845, residenceYearTo: 1855, residencePlace: PA_1850.residencePlace }),
    ).toBeUndefined();
  });

  it("stays silent on a single residence year no census covers, unless a census was asked for", () => {
    const q = { residenceYearFrom: 1853, residenceYearTo: 1853, residencePlace: PA_1850.residencePlace };
    expect(censusNote(q)).toBeUndefined();
    const asked = censusNote({ ...q, recordType: "census" });
    expect(asked?.schedules).toEqual([]);
    expect(asked?.indexedYears).toContain(1850);
  });

  it("lists no schedule for New York 1825-1845 and names the years it does list", () => {
    const note = censusNote({
      recordType: "census",
      recordCountry: "United States",
      recordSubdivision: "New York",
      residenceYearFrom: 1825,
      residenceYearTo: 1845,
    });
    // The federal 1830 and 1840 censuses cover New York, so the range is not empty.
    expect(note?.schedules.map((s) => s.year)).toEqual([1830, 1840]);
    const state = censusNote({
      recordType: "census",
      residencePlace: "Clinton, New York, United States",
      residenceYearFrom: 1825,
      residenceYearTo: 1825,
    });
    expect(state?.schedules).toEqual([]);
    expect(state?.indexedYears).toEqual(expect.arrayContaining([1820, 1830, 1855]));
    expect(state?.indexedYears).not.toContain(1825);
    expect(state?.note).toContain("lists no census of Clinton, New York, United States for 1825");
  });

  it("reads the any* year and place fields", () => {
    const note = censusNote({
      recordType: "census",
      anyYearFrom: 1850,
      anyYearTo: 1850,
      anyPlace: "Essex, New York, United States",
    });
    expect(note?.schedules[0].collectionId).toBe("1401638");
  });

  it("names a fragment census", () => {
    const note = censusNote({
      recordType: "census",
      residenceYearFrom: 1890,
      residenceYearTo: 1890,
      residencePlace: "Ohio, United States",
    });
    expect(note?.schedules).toEqual([]);
    expect(note?.fragmentYears).toEqual([1890]);
  });

  it("takes a bare country as every census of that year in it", () => {
    const note = censusNote({
      recordType: "census",
      recordCountry: "United States",
      residenceYearFrom: 1850,
      residenceYearTo: 1850,
    });
    expect(note?.schedules.map((s) => s.collectionId)).toContain("1401638");
  });

  it("reads a place written without its country", () => {
    const note = censusNote({
      recordType: "census",
      residenceYearFrom: 1860,
      residenceYearTo: 1860,
      residencePlace: "Dodge County, Wisconsin",
    });
    expect(note?.schedules.map((s) => s.collectionId)).toContain("1473181");
    // A state named alone is still a state, and a county is not mistaken for one.
    const bare = censusNote({ recordType: "census", residenceYearFrom: 1860, residenceYearTo: 1860, residencePlace: "Wisconsin" });
    expect(bare?.schedules.map((s) => s.collectionId)).toContain("1473181");
    expect(
      censusNote({ recordType: "census", residenceYearFrom: 1860, residenceYearTo: 1860, residencePlace: "Dodge County" }),
    ).toBeUndefined();
  });

  it("gives the census a pinned collection belongs to, with no year or place", () => {
    const note = censusNote({ collectionId: "1401638", surname: "Flynn" } as never);
    expect(note?.schedules).toEqual([expect.objectContaining({ year: 1850, census: "United States" })]);
  });

  it("stays silent for a collection that is not a census, a place the table never covers, and no years", () => {
    expect(censusNote({ collectionId: "5000012", recordCountry: "Luxembourg" })).toBeUndefined();
    expect(
      censusNote({ recordType: "census", residenceYearFrom: 1850, residenceYearTo: 1850, residencePlace: "Atlantis" }),
    ).toBeUndefined();
    expect(censusNote({ recordType: "census", residencePlace: PA_1850.residencePlace })).toBeUndefined();
    expect(censusNote({ recordType: "census", residenceYearFrom: 1850, residenceYearTo: 1850 })).toBeUndefined();
  });

  it("ignores a reversed range and non-integer years", () => {
    expect(censusNote({ ...PA_1850, residenceYearFrom: 1860, residenceYearTo: 1850 })).toBeUndefined();
    expect(censusNote({ ...PA_1850, residenceYearFrom: "1850", residenceYearTo: "1850" })).toBeUndefined();
    expect(censusNote({ ...PA_1850, residenceYearFrom: Number.NaN, residenceYearTo: 1850 })).toBeUndefined();
  });

  it("caps a wide range", () => {
    const note = censusNote({
      recordType: "census",
      residenceYearFrom: 1790,
      residenceYearTo: 1950,
      residencePlace: "Pennsylvania, United States",
    });
    expect(note?.schedules).toHaveLength(MAX_CENSUS_SCHEDULES);
    expect(note?.schedules[0].year).toBe(1790);
  });
});
