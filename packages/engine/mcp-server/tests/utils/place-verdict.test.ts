import { describe, it, expect, vi, beforeEach } from "vitest";

// The rule runs as written; only the Places API fetchers are replaced, by the
// answers FamilySearch gave on 2026-10-29 (Accept-Language: en).
vi.mock("../../src/utils/place-api.js", () => ({
  searchPlace: vi.fn(),
  getPlaceById: vi.fn(),
  getPlaceReps: vi.fn(),
  getPlaceCandidateNames: vi.fn(),
}));

import { judgeSupplied, keptSupplied, placeAnswer, unconfirmedByText } from "../../src/utils/place-verdict.js";
import { searchPlace, getPlaceReps } from "../../src/utils/place-api.js";
import { __clearPlaceResolverCachesForTests } from "../../src/utils/place-resolver.js";

/** Each standard place's search entry (its place id and type) and its place's
 *  names, every representation's, as recorded. */
const RECORDED: Record<string, { placeId: string; type: string; names: string[] }> = {
  "Santo António, Funchal, Madeira, Portugal": { placeId: "3668064", type: "Parish", names: ["Santo António"] },
  "Hawaii, United States": { placeId: "12", type: "State", names: ["Hawaii", "Havaí", "Kingdom of Hawaii"] },
  "Springfield, Sangamon, Illinois, United States": { placeId: "380949", type: "City", names: ["Springfield"] },
  "Kentucky, United States": { placeId: "36", type: "State", names: ["Kentucky", "Kentaki"] },
  "Laakirchen, Gmunden, Upper Austria, Austria": { placeId: "6353624", type: "Town", names: ["Laakirchen"] },
  "Funchal, Madeira, Portugal": { placeId: "6283660", type: "City", names: ["Funchal"] },
};
const search = vi.mocked(searchPlace);
const listing = vi.mocked(getPlaceReps);
beforeEach(() => {
  __clearPlaceResolverCachesForTests();
  search.mockReset();
  listing.mockReset();
  search.mockImplementation(async (name: string) => {
    const key = Object.keys(RECORDED).find((k) => k.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "") ===
      name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""));
    return key === undefined ? [] : [{ placeRepId: "r", placeId: RECORDED[key].placeId, name: key.split(",")[0], fullName: key, type: RECORDED[key].type }];
  });
  listing.mockImplementation(async (placeId: string) => {
    const place = Object.values(RECORDED).find((p) => p.placeId === placeId);
    return place ? [{ placeRepId: "r", names: place.names }] : [];
  });
});

describe("unconfirmedByText: the place text confirms a standard place", () => {
  it.each([
    // The country check judges the pair, so the text need not name it.
    ["Boston, Massachusetts, United States", "Springfield, Sangamon, Illinois, United States"],
    // One word: the resolver's one-word rule judges it, here its top hit for a
    // word neither on the list nor spelled in the answer.
    ["Porto", "Porto Moniz, Madeira, Portugal"],
    ["Ky", "Kentucky, United States"],
    ["Birmingham", "Birmingham, Transvaal, South Africa"],
    // The one-word list's own entry for the text, case and accents aside.
    ["W. Va.", "West Virginia, United States"],
    ["W. Va.", "west virginia, united states"],
    ["State of Ohio", "Ohio, United States"],
    ["'s Gravenhage", "The Hague, South Holland, Netherlands"],
    // The standard place's own name is one of the text's comma parts.
    ["412 Vine St, Cincinnati", "Cincinnati, Hamilton, Ohio, United States"],
    ["Schuylkill County, Pennsylvania", "Schuylkill, Pennsylvania, United States"],
    ["Lidečko, Moravia", "Lidečko, Ungarisch Brod, Moravia"],
  ])("%j confirms %j", (place, standardPlace) => {
    expect(unconfirmedByText(place, standardPlace)).toBeNull();
  });

  it.each([
    ["with his daughter", "Hawaii, United States"],
    ["at the home of her daughter", "Of, Trabzon, Türkiye"],
    ["at the home of her daughter, Mrs. John Smith", "Of, Trabzon, Türkiye"],
    ["Paxcroft, Wiltshire", "Trowbridge, Wiltshire, England, United Kingdom"],
    // A list text whose answer is not the list's entry is judged by name.
    ["W. Va.", "Virginia, United States"],
  ])("%j does not confirm %j", (place, standardPlace) => {
    expect(unconfirmedByText(place, standardPlace)).toBe(
      "could not be confirmed, as the text names neither a country nor that place",
    );
  });

  it("refuses a standard place naming no known country when the text's last part names one", () => {
    expect(unconfirmedByText("March, Cambridgeshire, England", "March, Transvaal, South Africa")).toBe(
      "does not name the country the text names",
    );
    expect(unconfirmedByText("Austria", "Bohemia")).toBe("does not name the country the text names");
  });
});

describe("keptSupplied: what a writer keeps of a supplied standard_place", () => {
  it("keeps it in FamilySearch's spelling, not as typed, when a part of the text names it", async () => {
    expect(await keptSupplied("Santo Antonio, Funchal", "santo antonio, funchal, madeira, portugal")).toEqual({
      kept: "Santo António, Funchal, Madeira, Portugal",
    });
    expect(search).toHaveBeenCalledWith("santo antonio, funchal, madeira, portugal");
    expect(listing).toHaveBeenCalledWith("3668064");
  });

  it("keeps it as written when FamilySearch's search, or the place's listing, failed", async () => {
    search.mockRejectedValueOnce(new Error("FamilySearch API error: 503"));
    expect(await keptSupplied("Funchal, Madeira", "Funchal, Madeira, Portugal")).toEqual({ kept: "Funchal, Madeira, Portugal" });
    listing.mockRejectedValueOnce(new Error("FamilySearch API error: 503"));
    expect(await keptSupplied("Boston, Suffolk, Massachusetts", "Springfield, Sangamon, Illinois, United States")).toEqual({
      kept: "Springfield, Sangamon, Illinois, United States",
    });
  });

  it("keeps none FamilySearch has no place of", async () => {
    expect(await keptSupplied("Funchal, Madeira", "Funchal, Madeira, Portugal, Europe")).toEqual({
      why: "FamilySearch's place standard has no place of that name",
    });
  });

  // Lead, 2026-10-29: the place must also fit the fact's own text, "yes, definitely".
  it("keeps none that no part of the place text names, though it is a FamilySearch place", async () => {
    const notNamed = { why: "no part of the place text names that place" };
    expect(await keptSupplied("Boston, Suffolk, Massachusetts", "Springfield, Sangamon, Illinois, United States")).toEqual(notNamed);
    expect(await keptSupplied("with his daughter", "Hawaii, United States")).toEqual(notNamed);
    // A town is named by the text's first part only.
    expect(await keptSupplied("Stötten (Nötten), Laakirchen, Gmunden", "Laakirchen, Gmunden, Upper Austria, Austria")).toEqual(notNamed);
    expect(await keptSupplied("Laakirchen, Gmunden", "Laakirchen, Gmunden, Upper Austria, Austria")).toEqual({
      kept: "Laakirchen, Gmunden, Upper Austria, Austria",
    });
    expect(await keptSupplied("Havaí", "Hawaii, United States")).toEqual({ kept: "Hawaii, United States" });
  });

  it("keeps the one-word list's entry for the text, which need not spell it, reading no listing", async () => {
    expect(await keptSupplied("Ky", "Kentucky, United States")).toEqual({ kept: "Kentucky, United States" });
    expect(listing).not.toHaveBeenCalled();
    expect(await keptSupplied("Kty", "Kentucky, United States")).toEqual({ why: "no part of the place text names that place" });
  });

  it("keeps none on a fact with no place, or one that names none, asking FamilySearch nothing", async () => {
    expect(await keptSupplied(undefined, "Hawaii, United States")).toEqual({ why: "the fact has no place" });
    expect(await keptSupplied("  ", "Hawaii, United States")).toEqual({ why: "the fact has no place" });
    expect(await keptSupplied("Same House,", "Same, Manufahi, Timor-Leste")).toEqual({ why: "'Same House,' names no place" });
    expect(await keptSupplied("Funchal, England", "Funchal, Madeira, Portugal")).toEqual({
      why: "it names a different country than the place",
    });
    expect(search).not.toHaveBeenCalled();
  });
});

describe("placeAnswer: the engine's own answer", () => {
  it("drops a lookup the text does not confirm, naming it", async () => {
    expect(await placeAnswer("with his daughter", [], async () => "Hawaii, United States")).toEqual({
      standardPlace: null,
      why: "unconfirmed",
      dropped: "Hawaii, United States",
      reason:
        "the engine's place lookup answer 'Hawaii, United States' could not be confirmed, as the text names neither a " +
        "country nor that place",
    });
  });

  it("keeps a lookup the text confirms, and FamilySearch's own value for the text on the cited record unjudged", async () => {
    expect(await placeAnswer("W. Va.", [], async () => "West Virginia, United States")).toEqual({
      standardPlace: "West Virginia, United States",
      from: "lookup",
    });
    expect(await placeAnswer("with his daughter", ["Hawaii, United States"], async () => null)).toEqual({
      standardPlace: "Hawaii, United States",
      from: "record",
    });
  });
});

describe("judgeSupplied", () => {
  it("stores FamilySearch's spelling of a kept value with no warning, asking for no answer", async () => {
    const answer = vi.fn();
    expect(await judgeSupplied("Santo Antonio, Funchal", "Santo Antonio, Funchal, Madeira, Portugal", answer)).toEqual({
      standardPlace: "Santo António, Funchal, Madeira, Portugal",
    });
    expect(answer).not.toHaveBeenCalled();
  });

  it("stores the engine's answer for a value it does not keep, with a warning, unless the answer is that value", async () => {
    const lookup = (standardPlace: string) => async () => ({ standardPlace, from: "lookup" as const });
    const text = "Stötten (Nötten), Laakirchen, Gmunden, Upper Austria, Austria";
    const LAAKIRCHEN = "Laakirchen, Gmunden, Upper Austria, Austria";
    expect(await judgeSupplied(text, LAAKIRCHEN, lookup("laakirchen, gmunden, upper austria, austria"))).toEqual({
      standardPlace: "laakirchen, gmunden, upper austria, austria",
    });
    expect(await judgeSupplied(text, LAAKIRCHEN, lookup("Gmunden, Upper Austria, Austria"))).toEqual({
      standardPlace: "Gmunden, Upper Austria, Austria",
      warning:
        `standard_place '${LAAKIRCHEN}' for '${text}' was replaced by 'Gmunden, Upper Austria, Austria', the engine's lookup: ` +
        "no part of the place text names that place. A supplied standard_place is kept when it is a FamilySearch standard " +
        "place (a place_search result) for the fact's own place.",
    });
  });
});
