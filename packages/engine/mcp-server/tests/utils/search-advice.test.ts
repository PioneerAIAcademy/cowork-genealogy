import { describe, expect, it } from "vitest";
import {
  childrenSearchNote,
  patronymicSearchNote,
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

describe("patronymicSearchNote", () => {
  const NIL = { totalMatches: 0 };
  const MOEN = { surname: "Moen", givenName: "Anders", recordCountry: "Norway" };

  it("fires on a surname search in Norway or Sweden that found nobody", () => {
    expect(patronymicSearchNote(MOEN, NIL)?.searched).toBe("Moen");
    expect(patronymicSearchNote({ ...MOEN, recordCountry: "Sweden" }, NIL)).toBeDefined();
    expect(patronymicSearchNote(MOEN, { totalMatches: 12, ranked: { subjectResolvable: false } })).toBeDefined();
  });

  it("reads the country from a place when recordCountry is absent, whatever the case", () => {
    expect(patronymicSearchNote({ surname: "Moen", birthPlace: "Ringsaker, Hedmark, Norway" }, NIL)).toBeDefined();
    expect(patronymicSearchNote({ surname: "Moen", anyPlace: "norway" }, NIL)).toBeDefined();
    expect(patronymicSearchNote({ surname: "Moen", recordCountry: " NORWAY " }, NIL)).toBeDefined();
  });

  it("tells the caller to drop the surname and anchor on given names and the country", () => {
    const note = patronymicSearchNote(MOEN, NIL)?.note ?? "";
    expect(note).toContain("no `surname`");
    expect(note).toContain("`fatherGivenName`");
    expect(note).toContain("`recordCountry`");
  });

  it("tells the caller to keep the given name, the place and the years", () => {
    expect(patronymicSearchNote(MOEN, NIL)?.note).toContain("keep `givenName`, the place and the years");
  });

  it("stays silent when the search found someone", () => {
    expect(patronymicSearchNote(MOEN, { totalMatches: 1 })).toBeUndefined();
    expect(patronymicSearchNote(MOEN, { totalMatches: 3, ranked: { subjectResolvable: true } })).toBeUndefined();
    expect(patronymicSearchNote(MOEN, {})).toBeUndefined();
  });

  it("stays silent with no surname, or a blank one", () => {
    expect(patronymicSearchNote({ givenName: "Anders", recordCountry: "Norway" }, NIL)).toBeUndefined();
    expect(patronymicSearchNote({ surname: "  ", recordCountry: "Norway" }, NIL)).toBeUndefined();
  });

  it("stays silent outside the listed countries, and for a place that only contains the name", () => {
    expect(patronymicSearchNote({ surname: "Flynn", recordCountry: "United States" }, NIL)).toBeUndefined();
    expect(patronymicSearchNote({ surname: "Olson", residencePlace: "Norway, Maine, United States" }, NIL)).toBeUndefined();
    expect(patronymicSearchNote({ surname: "Moen" }, NIL)).toBeUndefined();
  });

  it("leaves a -datter or -dotter surname to surnameVariantHints", () => {
    expect(patronymicSearchNote({ surname: "Halsteinsdatter", recordCountry: "Norway" }, NIL)).toBeUndefined();
    expect(patronymicSearchNote({ surname: "Persdotter", recordCountry: "Sweden" }, NIL)).toBeUndefined();
  });
});

describe("searchAdvice", () => {
  it("returns nothing for a search that names no census and no parent", () => {
    expect(searchAdvice({ surname: "Flynn", givenName: "Patrick", recordCountry: "United States" })).toEqual({});
  });

  it("carries every part that applies, under the keys the tool serializes", () => {
    const advice = searchAdvice(
      {
        surname: "Moen",
        fatherGivenName: "Hans",
        recordType: "census",
        residenceYearFrom: 1865,
        residenceYearTo: 1865,
        residencePlace: "Ringsaker, Hedmark, Norway",
      },
      { totalMatches: 0 },
    );
    expect(Object.keys(advice).sort()).toEqual([...SEARCH_ADVICE_KEYS].sort());
    expect(advice.census?.schedules[0].year).toBe(1865);
  });

  it("gives no patronymic note without the counts", () => {
    expect(searchAdvice({ surname: "Moen", recordCountry: "Norway" }).patronymicSearch).toBeUndefined();
  });
});
