import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  accentKey,
  foldPlaceKey,
  listedOneWordPlace,
  oneWordPlaceNeedsCountry,
  ONE_WORD_PLACES_PATH,
  type OneWordEntry,
} from "../../src/utils/one-word-places.js";
import { countryConsistency } from "../../src/utils/place-resolver.js";

const shipped = JSON.parse(readFileSync(ONE_WORD_PLACES_PATH, "utf-8")) as {
  _meta: { entries: number; by_kind: Record<string, number>; entries_sha256: string };
  entries: Record<string, OneWordEntry>;
};

const CONDITIONS = ["record_country", "except_record_countries", "accented_spellings"];
const kindOf = (e: OneWordEntry) => (typeof e === "string" ? "always" : Object.keys(e).filter((k) => k !== "place").join());
const placeOf = (e: OneWordEntry) => (typeof e === "string" ? e : e.place);

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

describe("accentKey (the fold with the accents kept)", () => {
  it.each([
    ["Ísland", "ísland"],
    ["ÍSLAND", "ísland"],
    ["Island", "island"],
    [" Suède. ", "suède"],
  ])("folds %j to %j", (text, key) => {
    expect(accentKey(text)).toBe(key);
  });
});

describe("the bundled one-word list (the lead, 2026-10-26)", () => {
  it("holds the whole v2 list: every entry, by kind", () => {
    const counts: Record<string, number> = {};
    for (const e of Object.values(shipped.entries)) counts[kindOf(e)] = (counts[kindOf(e)] ?? 0) + 1;
    expect(counts).toEqual({ always: 1084, except_record_countries: 3, record_country: 35, accented_spellings: 2 });
    expect(shipped._meta.by_kind).toEqual(counts);
    expect(shipped._meta.entries).toBe(1124);
  });

  it("is the content dev/build-one-word-places.ts wrote: an edit by hand changes the hash", () => {
    const sha = createHash("sha256").update(JSON.stringify(shipped.entries)).digest("hex");
    expect(sha).toBe("f467c82aacbe37193a377958afdf02c7f8f661345981411452f5d9a9fddf6398");
    expect(shipped._meta.entries_sha256).toBe(sha);
  });

  it("holds folded keys, each with a full name and at most one known condition", () => {
    for (const [key, e] of Object.entries(shipped.entries)) {
      expect(foldPlaceKey(key), key).toBe(key);
      expect(placeOf(e).trim(), key).not.toBe("");
      if (typeof e === "string") continue;
      const conditions = Object.keys(e).filter((k) => k !== "place");
      expect(conditions.length === 1 && CONDITIONS.includes(conditions[0]), key).toBe(true);
      if ("accented_spellings" in e) {
        for (const s of e.accented_spellings) {
          expect(foldPlaceKey(s), s).toBe(key);
          expect(accentKey(s), s).not.toBe(key);
        }
      }
    }
  });

  it("never names a country the place text contradicts, so research_append cannot refuse a listed answer", () => {
    const contradicted = Object.entries(shipped.entries).filter(
      ([key, e]) => countryConsistency(key, placeOf(e)) === "contradiction",
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

  it("lists the Irish counties as County X, Ireland, and leaves out those an Irish parish shares", () => {
    for (const county of ["Dublin", "Kilkenny", "Mayo", "Roscommon", "Waterford", "Wexford", "Antrim", "Down"]) {
      expect(listedOneWordPlace(county), county).toBe(`County ${county}, Ireland`);
    }
    expect(listedOneWordPlace("Co. Clare")).toBe("County Clare, Ireland");
    expect(listedOneWordPlace("County Clare")).toBe("County Clare, Ireland");
    expect(listedOneWordPlace("Co. Cork")).toBe("County Cork, Ireland");
    for (const ni of ["Co. Down", "County Down", "Armagh", "Co. Armagh", "Fermanagh", "County Londonderry"]) {
      expect(listedOneWordPlace(ni), ni).toMatch(/^County \w+, Ireland$/);
    }
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

  it("lists the countries and states counties and towns no longer block, in any record", () => {
    // "Counties and towns should not block states or countries." (the lead)
    for (const [text, place] of [
      ["Costa Rica", "Costa Rica"],
      ["Ohio", "Ohio, United States"],
      ["Peru", "Peru"],
      ["Ontario", "Ontario, Canada"],
      ["Alberta", "Alberta, Canada"],
    ]) {
      expect(listedOneWordPlace(text), text).toBe(place);
      expect(listedOneWordPlace(text, "Sweden"), text).toBe(place);
    }
    expect(listedOneWordPlace("NY", "Sweden")).toBe("New York, United States");
  });

  it("applies an entry for one record country only to that country's records", () => {
    expect(listedOneWordPlace("Texas", "United States")).toBe("Texas, United States");
    expect(listedOneWordPlace("Texas", "Mexico")).toBeNull();
    expect(listedOneWordPlace("Texas")).toBeNull();
    expect(listedOneWordPlace("Luxemburg", "France")).toBe("Luxembourg");
    expect(listedOneWordPlace("Luxembourg", "Luxembourg")).toBeNull();
  });

  it("withholds an entry in the record countries it is excepted in, and when the country is unknown", () => {
    expect(listedOneWordPlace("Louth", "United States")).toBe("County Louth, Ireland");
    expect(listedOneWordPlace("Louth", "United Kingdom")).toBeNull();
    expect(listedOneWordPlace("Louth")).toBeNull();
    expect(listedOneWordPlace("Cavan", "France")).toBeNull();
    expect(listedOneWordPlace("Cavan", "Ireland")).toBe("County Cavan, Ireland");
  });

  it("answers an accent-exact entry only as written with its accents: 'Island' is not a place", () => {
    for (const text of ["Ísland", "ÍSLAND", "Îsland", "Īsland"]) expect(listedOneWordPlace(text), text).toBe("Iceland");
    for (const text of ["Island", "ISLAND", "island", "Isländ"]) {
      expect(listedOneWordPlace(text, "Iceland"), text).toBeNull();
    }
    expect(listedOneWordPlace("Suède")).toBe("Sweden");
    expect(listedOneWordPlace("Suede")).toBeNull();
  });

  it("needs the record's country only for an entry with a country condition", () => {
    expect(oneWordPlaceNeedsCountry("Texas")).toBe(true);
    expect(oneWordPlaceNeedsCountry("Louth")).toBe(true);
    expect(oneWordPlaceNeedsCountry("Kent")).toBe(false);
    expect(oneWordPlaceNeedsCountry("Ísland")).toBe(false);
    expect(oneWordPlaceNeedsCountry("Shenandoah")).toBe(false);
  });
});
