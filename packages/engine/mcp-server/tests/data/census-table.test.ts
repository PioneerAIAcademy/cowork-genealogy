import { describe, expect, it } from "vitest";
import {
  CENSUS_FRAGMENTS,
  CENSUS_TABLE,
  HEAD_ONLY_US_CENSUS_YEARS,
  checkRow,
  fragmentViolations,
  isCoveredPlace,
  placeMatches,
  rowsForInterval,
  titleYears,
  type CensusRow,
} from "../../src/data/census-table.js";

const row = (over: Partial<CensusRow>): CensusRow => ({
  year: 1901,
  label: "Ireland",
  covers: ["Ireland"],
  collectionId: "1",
  headsOnly: false,
  ...over,
});

describe("the census table", () => {
  it("names no fragment census", () => {
    expect(fragmentViolations()).toEqual([]);
  });

  it("every row covers something and is unique by year and label", () => {
    const seen = new Set<string>();
    for (const r of CENSUS_TABLE) {
      expect(r.covers.length, `${r.year} ${r.label}`).toBeGreaterThan(0);
      expect(r.label.trim()).not.toBe("");
      const key = `${r.year}|${r.label}|${r.covers.join(";")}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("marks heads-only exactly the US federal 1790-1840 rows among the federal ones", () => {
    for (const r of CENSUS_TABLE.filter((x) => x.label === "United States")) {
      expect(r.headsOnly, `${r.year}`).toBe(HEAD_ONLY_US_CENSUS_YEARS.has(r.year));
    }
  });

  it("covers only North and South America, Europe and Australia", () => {
    const allowed = /(United States|Canada|British North America|Newfoundland|Mexico|Argentina|England|Wales|Scotland|Ireland|United Kingdom|Denmark|Norway|Iceland|Germany|Mecklenburg-Schwerin|Switzerland|San Marino|France)$/;
    for (const r of CENSUS_TABLE) for (const c of r.covers) expect(c, `${r.year} ${r.label}`).toMatch(allowed);
  });
});

describe("fragmentViolations", () => {
  it("catches a planted US 1890 row", () => {
    expect(fragmentViolations([row({ year: 1890, label: "United States", covers: ["United States"] })])).toHaveLength(1);
  });
  it("catches an Irish 1841 row in the other place form, and a city inside it", () => {
    expect(fragmentViolations([row({ year: 1841, covers: ["Ireland, United Kingdom"] })])).toHaveLength(1);
    expect(fragmentViolations([row({ year: 1841, covers: ["Dublin, Dublin, Ireland"] })])).toHaveLength(1);
  });
  it("catches a wider row containing a fragment", () => {
    expect(fragmentViolations([row({ year: 1841, label: "Australia", covers: ["Australia"] })])).toHaveLength(1);
  });
  it("passes Denmark 1890, England 1841 and Ireland 1901", () => {
    expect(
      fragmentViolations([
        row({ year: 1890, label: "Denmark", covers: ["Denmark"] }),
        row({ year: 1841, label: "England and Wales", covers: ["England, United Kingdom"] }),
        row({ year: 1901, label: "Ireland", covers: ["Ireland", "Ireland, United Kingdom"] }),
      ]),
    ).toEqual([]);
  });
  it("is fed the real fragment list", () => {
    expect(CENSUS_FRAGMENTS.map((f) => f.year).sort()).toEqual([1821, 1831, 1841, 1841, 1851, 1890]);
  });
});

describe("placeMatches", () => {
  it("matches whole trailing segments only", () => {
    expect(placeMatches(["Ohio, United States"], "Columbus, Franklin, Ohio, United States")).toBe(true);
    expect(placeMatches(["York, United States"], "Albany, New York, United States")).toBe(false);
    expect(placeMatches(["New York, United States"], "Albany, Albany, New York, United States")).toBe(true);
  });
  it("ignores case and spacing", () => {
    expect(placeMatches(["kent, england"], "Canterbury,Kent ,  England")).toBe(true);
  });
  it("a form longer than the place never matches", () => {
    expect(placeMatches(["Kent, England, United Kingdom"], "England, United Kingdom")).toBe(false);
  });
});

describe("rowsForInterval", () => {
  const table = [
    row({ year: 1855, label: "New York", covers: ["New York, United States"] }),
    row({ year: 1860, label: "United States", covers: ["New York, United States", "Ohio, United States"] }),
  ];
  it("needs one row covering both places", () => {
    expect(rowsForInterval("Albany, New York, United States", "Utica, Oneida, New York, United States", 1855, table)).toHaveLength(1);
    expect(rowsForInterval("Albany, New York, United States", "Columbus, Franklin, Ohio, United States", 1855, table)).toEqual([]);
    expect(rowsForInterval("Albany, New York, United States", "Columbus, Franklin, Ohio, United States", 1860, table)).toHaveLength(1);
  });
});

describe("isCoveredPlace", () => {
  it("a place no row covers is not covered", () => {
    expect(isCoveredPlace("Manila, Metro Manila, Philippines")).toBe(false);
    expect(isCoveredPlace("Philadelphia, Philadelphia, Pennsylvania, United States")).toBe(true);
  });
});

describe("titleYears and checkRow", () => {
  it("reads single and listed years, refuses a range", () => {
    expect(titleYears("United States, Census, 1850")).toEqual([1850]);
    expect(titleYears("France, Haute-Garonne, Toulouse, Censuses, 1872 and 1886")).toEqual([1872, 1886]);
    expect(titleYears("San Marino, Census, 1865, 1874, 1899, 1947")).toEqual([1865, 1874, 1899, 1947]);
    expect(titleYears("France, Charente, Census, 1837-1936")).toBeNull();
    expect(titleYears("Italy, Verona, Census, 1415-1853")).toBeNull();
  });
  const r1850 = row({ year: 1850, label: "United States", covers: ["United States"], collectionId: "9" });
  it("passes a row its catalog entry supports", () => {
    expect(checkRow(r1850, { id: "9", title: "United States, Census, 1850", recordCount: 10 })).toEqual([]);
    expect(
      checkRow(row({ year: 1874, collectionId: "5" }), { id: "5", title: "San Marino, Census, 1865, 1874, 1899, 1947", recordCount: 3 }),
    ).toEqual([]);
  });
  it("fails a missing id, no records, a range title and a wrong year", () => {
    expect(checkRow(r1850, undefined)).toHaveLength(1);
    expect(checkRow(r1850, { id: "9", title: "United States, Census, 1850", recordCount: 0 })).toHaveLength(1);
    expect(checkRow(r1850, { id: "9", title: "United States, Census, 1850-1880", recordCount: 10 })).toHaveLength(1);
    expect(checkRow(r1850, { id: "9", title: "United States, Census, 1860", recordCount: 10 })).toHaveLength(1);
  });
});

describe("US federal coverage", () => {
  const at = (place: string, year: number) => rowsForInterval(place, place, year).map((r) => r.label);
  it("lost and not-yet-enumerated areas expect no federal row", () => {
    expect(at("Lexington, Fayette, Kentucky, United States", 1800)).toEqual([]);
    expect(at("Houston, Harris, Texas, United States", 1840)).toEqual([]);
    expect(at("Honolulu, Honolulu, Hawaii, United States", 1880)).toEqual([]);
  });
  it("surviving areas do", () => {
    expect(at("Philadelphia, Philadelphia, Pennsylvania, United States", 1800)).toEqual(["United States"]);
    expect(at("Honolulu, Honolulu, Hawaii, United States", 1900)).toEqual(["United States"]);
  });
  it("Arizona and Nevada are covered from 1870, not 1860", () => {
    expect(at("Tucson, Pima, Arizona, United States", 1860)).toEqual([]);
    expect(at("Carson City, Carson City, Nevada, United States", 1860)).toEqual([]);
    expect(at("Tucson, Pima, Arizona, United States", 1870)).toEqual(["United States"]);
  });
  it("Puerto Rico is not covered by a United States row", () => {
    expect(at("Ponce, Puerto Rico", 1910)).toEqual([]);
  });
});
