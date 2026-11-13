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

  it("does not read a country-less place against a census of another country the search names", () => {
    const tbilisi = {
      recordType: "census",
      residenceYearFrom: 1850,
      residenceYearTo: 1850,
      residencePlace: "Tbilisi, Georgia",
    };
    expect(censusNote({ ...tbilisi, recordCountry: "Georgia" })).toBeUndefined();
    // With the country that matches, or none named, the state reading stands.
    expect(censusNote({ ...tbilisi, residencePlace: "Savannah, Georgia", recordCountry: "United States" })?.schedules[0].year).toBe(1850);
    expect(censusNote({ ...tbilisi, residencePlace: "Savannah, Georgia" })?.schedules[0].year).toBe(1850);
  });

  describe("reads the place a genealogist would, from the one-word list and the census table", () => {
    const census = (residencePlace: string, y: number, extra: Record<string, unknown> = {}) =>
      censusNote({ recordType: "census", residencePlace, residenceYearFrom: y, residenceYearTo: y, ...extra });
    const first = (residencePlace: string, y: number, extra: Record<string, unknown> = {}) => {
      const n = census(residencePlace, y, extra);
      return n?.schedules[0] ? `${n.schedules[0].census} ${n.schedules[0].year}` : null;
    };

    it("finds the country of a US place written without it, in every census year", () => {
      // 1900 on, the table covers the whole United States, so a state alone matched nothing before.
      expect(first("Milwaukee, Wisconsin", 1900)).toBe("United States 1900");
      expect(first("Brooklyn, Kings, New York", 1910)).toBe("United States 1910");
      expect(first("Chicago, Illinois", 1940)).toBe("United States 1940");
      expect(first("Dodge County, Wisconsin", 1860)).toBe("United States 1860");
      expect(first("Texas", 1910)).toBe("United States 1910");
      expect(first("Indian Territory", 1900)).toBe("United States 1900");
    });

    it("finds a state the list leaves out or lists for US records only", () => {
      expect(first("Androscoggin, Maine", 1900)).toBe("United States 1900");
      expect(first("Hill, Texas", 1900)).toBe("United States 1900");
    });

    it("reads Georgia as the lead ruled: the US state alone, the country with Tbilisi or Republic", () => {
      expect(first("Georgia", 1920)).toBe("United States 1920");
      expect(first("Savannah, Georgia", 1900)).toBe("United States 1900");
      expect(first("Georgia, Vermont", 1850)).toBe("United States 1850");
      expect(census("Tbilisi, Georgia", 1850)).toBeUndefined();
      expect(census("Tbilisi, Georgia", 1850, { recordCountry: "Georgia" })).toBeUndefined();
      expect(census("Republic of Georgia", 1850)).toBeUndefined();
      expect(census("Georgia Republic", 1850)).toBeUndefined();
    });

    it("does not let an English county name pull a US place to England", () => {
      expect(first("Essex, New York", 1850)).toBe("United States 1850");
      expect(first("Essex, New York", 1900)).toBe("United States 1900");
      expect(first("Kent, Delaware", 1850)).toBe("United States 1850");
      expect(first("Middlesex, Massachusetts", 1910)).toBe("United States 1910");
      expect(first("Durham, North Carolina", 1900)).toBe("United States 1900");
      expect(first("Cumberland, Maine", 1850)).toBe("United States 1850");
      expect(first("Victoria, Texas", 1880)).toBe("United States 1880");
      expect(first("Washington, Pennsylvania", 1850)).toBe("United States 1850");
      expect(first("Ontario, New York", 1900)).toBe("United States 1900");
    });

    it("reads an English or Welsh county written without the country", () => {
      expect(first("Maidstone, Kent", 1881)).toBe("England and Wales 1881");
      expect(first("London, Middlesex", 1881)).toBe("England and Wales 1881");
      expect(first("Lancaster, Lancashire", 1881)).toBe("England and Wales 1881");
      expect(first("Birmingham, Warwickshire", 1901)).toBe("England and Wales 1901");
      expect(first("Montgomeryshire", 1881)).toBe("England and Wales 1881");
    });

    it("reads a first-level division of another country", () => {
      expect(first("London, Ontario", 1881)).toBe("Canada 1881");
      expect(first("Parácuaro, Michoacán", 1930)).toBe("Mexico 1930");
      expect(first("Hordaland", 1801)).toBe("Norway 1801");
    });

    it("takes the search's country as part of a place that does not name it", () => {
      expect(first("Kent", 1900, { recordCountry: "United States" })).toBe("United States 1900");
      expect(first("Kent", 1881)).toBe("England and Wales 1881");
      expect(first("Kent, England", 1881, { recordCountry: "England" })).toBe("England and Wales 1881");
    });

    it("leaves a bare town alone: it could be anywhere", () => {
      expect(census("Birmingham", 1901)).toBeUndefined();
    });

    it("lists the years the table holds for a country searched in a year it lacks", () => {
      const canada = censusNote({ recordType: "census", recordCountry: "Canada", residenceYearFrom: 1931, residenceYearTo: 1931 });
      expect(canada?.schedules).toEqual([]);
      expect(canada?.indexedYears).toContain(1881);
      const ohio = census("Ohio", 1890);
      expect(ohio?.schedules).toEqual([]);
      expect(ohio?.fragmentYears).toEqual([1890]);
    });
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
