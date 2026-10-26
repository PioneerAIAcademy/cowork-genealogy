import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { foldPlaceKey, listedOneWordPlace, ONE_WORD_PLACES_PATH } from "../../src/utils/one-word-places.js";
import { countryConsistency } from "../../src/utils/place-resolver.js";

const shipped = JSON.parse(readFileSync(ONE_WORD_PLACES_PATH, "utf-8")) as {
  _meta: { entries: number };
  entries: Record<string, string>;
};

describe("foldPlaceKey (the fold the list's keys were built with)", () => {
  it.each([
    ["U.S.A.", "usa"],
    ["U S A", "usa"],
    ["Prince Edward's Island", "prince edwards island"],
    ["Baden-Württemberg", "baden wurttemberg"],
    ["Østfold", "ostfold"],
    ["Preußen", "preussen"],
    ["  CO.   Clare ", "co clare"],
    ["Kent,", "kent"],
    ["Wien (Vienna)", "wien vienna"],
  ])("folds %j to %j", (text, key) => {
    expect(foldPlaceKey(text)).toBe(key);
  });

  it("joins only a run of single letters, not a single letter beside a word", () => {
    expect(foldPlaceKey("N. Y. City")).toBe("ny city");
    expect(foldPlaceKey("A Coruña")).toBe("a coruna");
  });

  it("folds a Greek final sigma as the list's casefold does", () => {
    expect(foldPlaceKey("ΚΥΘΗΡΑΣ")).toBe("κυθηρασ");
    expect(foldPlaceKey("Κύθηρας")).toBe("κυθηρασ");
  });
});

describe("the bundled one-word list (the lead, 2026-10-26)", () => {
  it("holds folded keys and full names only, as many as its _meta says", () => {
    const keys = Object.keys(shipped.entries);
    expect(keys.length).toBe(shipped._meta.entries);
    expect(keys.length).toBeGreaterThan(900);
    for (const [key, name] of Object.entries(shipped.entries)) {
      expect(foldPlaceKey(key), key).toBe(key);
      expect(typeof name === "string" && name.trim() !== "", key).toBe(true);
    }
  });

  it("never names a country the place text contradicts, so research_append cannot refuse a listed answer", () => {
    const contradicted = Object.entries(shipped.entries).filter(
      ([key, name]) => countryConsistency(key, name) === "contradiction",
    );
    expect(contradicted).toEqual([]);
  });

  it("lists the English historic counties over their foreign namesakes", () => {
    for (const county of [
      "Kent", "Essex", "Sussex", "Surrey", "Middlesex", "Norfolk", "Suffolk", "Somerset", "Devon", "Cornwall",
      "Cumberland", "Westmorland", "Northumberland", "Hampshire", "Berkshire", "Cheshire", "Lincolnshire",
      "Rutland", "Durham", "Yorkshire",
    ]) {
      expect(listedOneWordPlace(county), county).toBe(`${county}, England, United Kingdom`);
    }
    expect(listedOneWordPlace("County Durham")).toBe("Durham, England, United Kingdom");
  });

  it("lists the Irish counties over their foreign namesakes, and leaves out those an Irish parish shares", () => {
    for (const county of ["Dublin", "Kilkenny", "Mayo", "Roscommon", "Waterford", "Wexford", "Antrim", "Down"]) {
      expect(listedOneWordPlace(county), county).toBe(`County ${county}, Ireland`);
    }
    expect(listedOneWordPlace("Co. Clare")).toBe("County Clare, Ireland");
    expect(listedOneWordPlace("County Clare")).toBe("County Clare, Ireland");
    for (const parishName of ["Clare", "Kildare", "Leitrim"]) {
      expect(listedOneWordPlace(parishName), parishName).toBeNull();
    }
  });

  it("lists the curated names as the lead set them", () => {
    expect(listedOneWordPlace("Georgia")).toBe("Georgia, United States");
    expect(listedOneWordPlace("Republic of Georgia")).toBe("Republic of Georgia");
    expect(listedOneWordPlace("New York")).toBe("New York, United States");
    expect(listedOneWordPlace("Quebec")).toBe("Quebec, Canada");
    expect(listedOneWordPlace("Mexico")).toBe("Mexico");
    expect(listedOneWordPlace("Washington")).toBe("Washington, United States");
    expect(listedOneWordPlace("New Jersey")).toBe("New Jersey, United States");
    expect(listedOneWordPlace("Jersey")).toBe("Jersey");
  });

  it("leaves out an entry for one record country, or one excepted in some, until the resolver knows a record's country", () => {
    // Ohio and Costa Rica are listed for US and Costa Rican records only; NY is
    // excepted in Swedish records (the parish Ny), Louth in British ones.
    for (const text of ["Ohio", "Costa Rica", "NY", "Louth", "Groningen"]) {
      expect(listedOneWordPlace(text), text).toBeNull();
    }
  });
});
