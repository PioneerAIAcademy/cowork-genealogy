import { describe, expect, it } from "vitest";
import {
  childrenSearchNote,
  searchAdvice,
  SEARCH_ADVICE_KEYS,
} from "../../src/utils/search-advice.js";

describe("childrenSearchNote", () => {
  const PARENTS = { surname: "Meyer", fatherGivenName: "Johann Georg", motherSurname: "Stockburger" };

  it("fires on a parent search held to a collection, a batch or a place", () => {
    expect(childrenSearchNote({ ...PARENTS, collectionId: "3015626" })?.heldBy).toEqual(["collectionId"]);
    expect(childrenSearchNote({ ...PARENTS, batchNumber: "C93716-3" })?.heldBy).toEqual(["batchNumber"]);
    expect(
      childrenSearchNote({ ...PARENTS, collectionId: "1630787", birthPlace: "Nancagua, Colchagua, Chile" })?.heldBy,
    ).toEqual(["collectionId", "birthPlace"]);
  });

  it("names what holds the search and what to send instead", () => {
    const note = childrenSearchNote({ ...PARENTS, collectionId: "3015626" })?.note ?? "";
    expect(note).toContain("`collectionId`");
    expect(note).toContain("anchored on `recordCountry`");
  });

  it("stays silent once the search is not held", () => {
    expect(childrenSearchNote({ ...PARENTS, recordCountry: "Germany" })).toBeUndefined();
    expect(childrenSearchNote({ ...PARENTS, collectionId: "  " })).toBeUndefined();
  });

  it("stays silent when the search names the child, or no parent", () => {
    expect(childrenSearchNote({ ...PARENTS, givenName: "Theresia", collectionId: "5000012" })).toBeUndefined();
    expect(childrenSearchNote({ surname: "Meyer", collectionId: "3015626" })).toBeUndefined();
    expect(childrenSearchNote({ surname: "Meyer", spouseGivenName: "Anna", collectionId: "3015626" })).toBeUndefined();
  });
});

describe("searchAdvice", () => {
  it("returns nothing for a search that names no census and no parent", () => {
    expect(searchAdvice({ surname: "Flynn", givenName: "Patrick", recordCountry: "United States" })).toEqual({});
  });

  it("carries every part that applies, under the keys the tool serializes", () => {
    const advice = searchAdvice({
      surname: "Flynn",
      fatherGivenName: "Thomas",
      recordType: "census",
      residenceYearFrom: 1850,
      residenceYearTo: 1850,
      residencePlace: "Schuylkill County, Pennsylvania, United States",
    });
    expect(Object.keys(advice).sort()).toEqual([...SEARCH_ADVICE_KEYS].sort());
    expect(advice.census?.schedules[0].year).toBe(1850);
  });
});
