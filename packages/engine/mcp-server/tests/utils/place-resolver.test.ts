import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The resolver builds on the low-level FamilySearch places fetchers in
// utils/place-api.ts. Mock just those four so no network is touched.
vi.mock("../../src/utils/place-api.js", () => ({
  searchPlace: vi.fn(),
  getPlaceById: vi.fn(),
  getPlaceReps: vi.fn(),
  getPlaceCandidateNames: vi.fn(),
}));

import {
  searchPlace,
  getPlaceById,
  getPlaceReps,
  getPlaceCandidateNames,
} from "../../src/utils/place-api.js";
import {
  resolveStandardPlace,
  standardPlaceToRepId,
  standardPlaceToPlaceId,
  resolveStandardPlaceToPlaceId,
  repIdToStandardPlace,
  repIdToStandardPlaceAt,
  gedcomxDateYears,
  standardPlaceToCoords,
  placeIdToRepIds,
  withRetry,
  mapWithConcurrency,
  countryConsistency,
  standardPlaceNamedInText,
  divisionContradiction,
  endsWithItsJurisdiction,
  countryOfPlace,
  deriveContextName,
  __clearPlaceResolverCachesForTests,
  __usePlaceTableForTests,
  isNonPlacePhrase,
  checkFirstPlace,
  familySearchPlace,
  textNamesPlace,
  samePlace,
} from "../../src/utils/place-resolver.js";

const mockSearchPlace = vi.mocked(searchPlace);
const mockGetPlaceById = vi.mocked(getPlaceById);
const mockGetPlaceReps = vi.mocked(getPlaceReps);
const mockGetPlaceCandidateNames = vi.mocked(getPlaceCandidateNames);

type Entry = Awaited<ReturnType<typeof searchPlace>>[number];

function entry(over: Partial<Entry> & { placeRepId: string; fullName: string }): Entry {
  return {
    name: over.fullName.split(",")[0]!.trim(),
    type: "City",
    ...over,
  } as Entry;
}

beforeEach(() => {
  mockSearchPlace.mockReset();
  mockGetPlaceById.mockReset();
  mockGetPlaceReps.mockReset();
  mockGetPlaceCandidateNames.mockReset();
  __clearPlaceResolverCachesForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveStandardPlace", () => {
  it("returns the best-scored candidate's fullName for free text with a parent", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "p1", fullName: "Lexington, Fayette, Kentucky, United States", score: 0.4 }),
      entry({ placeRepId: "2", placeId: "p2", fullName: "Lexington, Fayette, Kentucky, United States", score: 0.9 }),
    ]);
    expect(await resolveStandardPlace("Lexington, Ky")).toBe("Lexington, Fayette, Kentucky, United States");
  });

  it("caches a resolved value (second call does not re-search)", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", fullName: "Columbus, Franklin, Ohio, United States", score: 1 }),
    ]);
    expect(await resolveStandardPlace("Columbus, Ohio")).toBe("Columbus, Franklin, Ohio, United States");
    expect(await resolveStandardPlace("columbus,  ohio")).toBe("Columbus, Franklin, Ohio, United States"); // normalized key
    expect(mockSearchPlace).toHaveBeenCalledTimes(1);
  });

  it("negative-caches a definitive 0-candidate result", async () => {
    mockSearchPlace.mockResolvedValue([]);
    expect(await resolveStandardPlace("Mrs. John's farm, Ohio")).toBeNull();
    expect(await resolveStandardPlace("Mrs. John's farm, Ohio")).toBeNull();
    expect(mockSearchPlace).toHaveBeenCalledTimes(1);
  });

  it("never opts into the fuzzy query, even on zero results", async () => {
    // place_search's fuzzy fallback is flagged to the model as a sounds-alike
    // correction to confirm; the resolver persists standard_place silently, so
    // it must never start accepting fuzzy matches (a misspelling resolving to
    // a sounds-alike place with nothing flagging it).
    mockSearchPlace.mockResolvedValue([]);
    expect(await resolveStandardPlace("Sierkopas, Lithuania")).toBeNull();
    expect(mockSearchPlace.mock.calls.length).toBeGreaterThan(0);
    for (const [, opts] of mockSearchPlace.mock.calls) {
      expect(opts?.fuzzy).toBeUndefined();
    }
  });

  // ── Same-name disambiguation via a context derived from the input text ──
  // Regression guard for the silent same-name corruption bug: an 1870 marriage
  // at "Church of the Annunciation, Shenandoah, Schuylkill County, Pennsylvania"
  // was persisted as "Church, Clarion, Pennsylvania" — a place literally named
  // "Church" in the wrong county, because it was the top-scored name-search hit.
  it("narrows a same-name top hit using the parent locality derived from the input", async () => {
    mockSearchPlace.mockResolvedValue([
      // The wrong top-scored hit: a place NAMED "Church" in a different county.
      entry({ placeRepId: "wrong", placeId: "pc", fullName: "Church, Clarion, Pennsylvania, United States", score: 0.95 }),
      // The right locality — lower-scored, but the only one under Shenandoah.
      entry({ placeRepId: "right", placeId: "ps", fullName: "Shenandoah, Schuylkill, Pennsylvania, United States", score: 0.4 }),
    ]);
    expect(
      await resolveStandardPlace(
        "Church of the Annunciation, Shenandoah, Schuylkill County, Pennsylvania",
      ),
    ).toBe("Shenandoah, Schuylkill, Pennsylvania, United States");
  });

  it("falls back to the unfiltered top hit when nothing matches the derived context (never worse than today)", async () => {
    // No candidate contains the derived parent locality — the fallback must
    // keep the full set so resolution is no worse than the pre-fix behavior.
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "a", fullName: "Springfield, Illinois, United States", score: 0.2 }),
      entry({ placeRepId: "b", fullName: "Springfield, Missouri, United States", score: 0.8 }),
    ]);
    expect(
      await resolveStandardPlace("Nowheresville, Nonexistent County, Missouri"),
    ).toBe("Springfield, Missouri, United States");
  });

  // ── KNOWN LIMITATION (documented, not desired) ──────────────────────────────
  // The derived-context filter is NOT strictly "never worse" on this free-text
  // path: resolveStandardPlace selects with bare pickBest (no exact retention),
  // so when the correct top-scored hit lacks the derived token while a wrong hit
  // contains it, filtering demotes the correct one. The trade is inherent — a
  // filter that demotes a wrong top hit can demote a correct one — and it is
  // unguarded by countryConsistency here (trailing token "District of Columbia"
  // is not a recognized country). This test PINS that current behavior so a
  // future change to the guarantee is a deliberate, visible edit, not a silent
  // one. See deriveContextName's doc comment. (contrast: the standardPlace-input
  // fns retain the exact match and ARE strictly safe.)
  it("KNOWN LIMITATION: derived context can demote a correct top hit (Georgetown, Washington, DC)", async () => {
    mockSearchPlace.mockResolvedValue([
      // Correct: Georgetown in DC, higher score. fullName lacks "Washington".
      entry({ placeRepId: "dc", placeId: "pdc", fullName: "Georgetown, District of Columbia, United States", score: 0.9 }),
      // Wrong: Georgetown in Washington State, lower score, contains "Washington".
      entry({ placeRepId: "wa", placeId: "pwa", fullName: "Georgetown, King, Washington, United States", score: 0.5 }),
    ]);
    // Derived context is segment index 1 = "Washington", which the DC place does
    // not contain — so it is filtered out and the lower-scored WA place wins.
    // A bare name search (pre-fix) would have returned the DC place.
    expect(
      await resolveStandardPlace("Georgetown, Washington, District of Columbia"),
    ).toBe("Georgetown, King, Washington, United States");
  });

  it("does NOT cache a transient failure (retries on the next call)", async () => {
    vi.useFakeTimers();
    mockSearchPlace.mockRejectedValue(new Error("network"));

    const first = resolveStandardPlace("Paris, France");
    await vi.runAllTimersAsync();
    expect(await first).toBeNull();

    // Now the API recovers — because the failure wasn't cached, it re-searches.
    mockSearchPlace.mockResolvedValueOnce([
      entry({ placeRepId: "9", fullName: "Paris, France", score: 1 }),
    ]);
    const second = resolveStandardPlace("Paris, France");
    await vi.runAllTimersAsync();
    expect(await second).toBe("Paris, France");
  });
});

describe("deriveContextName", () => {
  it.each([
    ["Church of the Annunciation, Shenandoah, Schuylkill County, Pennsylvania", "Shenandoah"],
    ["Bristol, England", "England"],
    ["Paris, Bear Lake, Idaho, United States", "Bear Lake"],
  ])("%s -> %s", (text, expected) => {
    expect(deriveContextName(text as string)).toBe(expected);
  });

  it("returns undefined for a single-token input (nothing to disambiguate by)", () => {
    expect(deriveContextName("Springfield")).toBeUndefined();
    expect(deriveContextName("  Ky  ")).toBeUndefined();
    expect(deriveContextName("")).toBeUndefined();
  });
});

describe("countryConsistency", () => {
  // Full case coverage lives in tests/tools/research-append.test.ts (the
  // original owner); this is a light direct-import smoke test confirming the
  // check is importable straight from its new shared home, since tree-edit.ts
  // (and any future tool) should import it from here, not from research-append.
  it.each([
    ["West Bromwich, England", "West Bromwich, Staffordshire, England, United Kingdom", "ok"],
    ["West Bromwich, England", "Bamenda, Mezam, Northwest Region, Cameroon", "contradiction"],
    ["Schuylkill County, Pennsylvania", "Schuylkill, Pennsylvania, United States", "unverifiable"],
  ])("%s vs %s → %s", (place, standard, expected) => {
    expect(countryConsistency(place as string, standard as string)).toBe(expected);
  });
});

describe("standardPlaceNamedInText", () => {
  it.each([
    ["412 Vine St, Cincinnati", "Cincinnati, Hamilton, Ohio, United States", true],
    ["Borough of Shenandoah, County of Schuylkill", "Shenandoah, Schuylkill, Pennsylvania, United States", true],
    ["Hilperton, Wiltshire", "Hilperton, Wiltshire, England, United Kingdom", true],
    // Only the answer's own name counts: a containing place the text also names does not.
    ["Paxcroft, Wiltshire", "Trowbridge, Wiltshire, England, United Kingdom", false],
    ["412 Vine St, Cincinnati", "Hamilton, Ohio, United States", false],
    ["with his daughter", "Hawaii, United States", false],
    ["Hilperton, Wiltshire", "", false],
  ])("%s names %s: %s", (place, standard, expected) => {
    expect(standardPlaceNamedInText(place as string, standard as string)).toBe(expected);
  });
});

describe("divisionContradiction — a US state, Puerto Rico or Canadian province other than the text's", () => {
  // The four corpus shapes it refuses (matcher corpus, 2026-10-29), each with
  // the name FamilySearch gave it.
  it.each([
    ["St Leonard, St Leonard, Quebec", "Saint Leonard, St. Leonard, Madawaska, New Brunswick, Canada"],
    ["Hormigueros, 1, Hormigueros, Puerto Rico", "Puerto Rico, Hidalgo, Texas, United States"],
    ["6906 W. Lloyd St., Wisconsin", "Wisconsin Township, Jackson, Minnesota, United States"],
    ["Springfield, Massachusetts", "Springfield, Penobscot, Maine, United States"],
  ])("refuses %s named %s", (place, standard) => {
    expect(divisionContradiction(place, standard)).toBe(true);
  });

  it.each([
    ["by postal code", "Springfield, MA", "Springfield, Penobscot, Maine, United States"],
    ["after a trailing country", "Springfield, Massachusetts, United States", "Springfield, Penobscot, Maine, United States"],
    ["after British North America", "Saint-Roch, Canada East, British North America", "Saint-Roch, Toronto, Ontario, Canada"],
    ["with its accent", "Saint-Roch, Québec", "Saint-Roch, Toronto, Ontario, Canada"],
    ["in French", "Edmundston, Nouveau-Brunswick", "Edmundston, Quebec, Canada"],
    ["as a territory", "Ogden, Utah Territory", "Ogden, Boise, Idaho, United States"],
    ["by its 1840s name", "Montreal, Lower Canada", "Montreal, York, Canada West, British North America"],
  ])("reads the text's state or province %s", (_label, place, standard) => {
    expect(divisionContradiction(place, standard)).toBe(true);
  });

  it("reads a standard place that names no state among its jurisdictions by its own name: a state itself", () => {
    expect(divisionContradiction("Washington, Washington, Pennsylvania", "Washington, United States")).toBe(true);
    expect(divisionContradiction("Seattle, King, Washington", "Washington, United States")).toBe(false);
    expect(divisionContradiction("Ky", "Kentucky, United States")).toBe(false);
  });

  it.each([
    ["the same state", "Salem, Essex, Massachusetts", "Salem, Essex, Massachusetts, United States"],
    ["the same province by another name", "Montreal, Canada East", "Montreal, Montreal, Quebec, Canada"],
    ["a county of that name", "Marietta, Washington", "Marietta, Washington, Ohio, United States"],
    ["no state or province in the name", "Paris, Texas", "Paris, Île-de-France, France"],
    ["no state or province in the text", "Kenmore, Killin, Perthshire, Scotland", "Killin, Perthshire, Scotland, United Kingdom"],
    ["a state only in the text's earlier parts", "Texas, Hormigueros", "Puerto Rico, Hidalgo, Texas, United States"],
    ["an empty text", "", "Springfield, Penobscot, Maine, United States"],
  ])("does not refuse %s", (_label, place, standard) => {
    expect(divisionContradiction(place, standard)).toBe(false);
  });
});

describe("endsWithItsJurisdiction: the text ends with the state or province a standard place lies in, or with its country and names a part of it", () => {
  it.each([
    ["Balto., Md.", "Baltimore, Maryland, United States"],
    ["Cincinatti, Hamilton, Ohio, USA", "Cincinnati, Hamilton, Ohio, United States"],
    ["Seattle, Washington", "Washington, United States"],
    ["La Unión, Guerrero, Mexico", "La Unión de Isidoro Montes de Oca, Guerrero, Mexico"],
    ["near Nueva Italia, Michoacán, Mexico", "Nueva Italia de Ruiz, Múgica, Michoacan, Mexico"],
    ["St. Bartholomew, Wednesbury, Staffordshire, England", "Wednesbury, Staffordshire, England, United Kingdom"],
  ])("%j holds %j", (place, standard) => {
    expect(endsWithItsJurisdiction(place, standard)).toBe(true);
  });

  it.each([
    ["at the home of her daughter", "Of, Trabzon, Türkiye"],
    ["Boght Reformed, Church", "Church, Hillsdale, Michigan, United States"],
    ["Houston, Ohio", "Houston, Harris, Texas, United States"],
    ["Paris, France", "Paris, Lamar, Texas, United States"],
    // In the text's country, but in no jurisdiction the text names.
    ["Laibach, Krain, Austria", "Krainberg, Villach Land, Carinthia, Austria"],
    ["St Mary'S, Forfarshire (Angus), Scotland", "Forfar, Angus, Scotland, United Kingdom"],
    // A jurisdiction the text names, in a country the text does not name.
    ["Perth, Perthshire", "Perth, Perth, Ontario, Canada"],
  ])("%j does not hold %j", (place, standard) => {
    expect(endsWithItsJurisdiction(place, standard)).toBe(false);
  });
});

describe("countryOfPlace (a record's country from its own place)", () => {
  it("is the last segment of the place", () => {
    expect(countryOfPlace("Bullock, Alabama, United States")).toBe("United States");
    expect(countryOfPlace("Tilarán, Guanacaste, Costa Rica")).toBe("Costa Rica");
    expect(countryOfPlace(" Becker, Minnesota, United States ")).toBe("United States");
  });

  it("names a country it knows in another spelling by its English name", () => {
    expect(countryOfPlace("Guadalajara, Jalisco, México")).toBe("Mexico");
    expect(countryOfPlace("Albany, New York, U.S.A.")).toBe("United States");
    expect(countryOfPlace("Fürth, Bayern, Deutschland")).toBe("Germany");
    expect(countryOfPlace("Wellington, new zealand")).toBe("New Zealand");
  });

  it("reads Brasil as Brazil", () => {
    expect(countryOfPlace("Cascadura, Rio de Janeiro, Brasil")).toBe("Brazil");
    expect(countryOfPlace("Cascadura, Rio de Janeiro, BRASIL")).toBe("Brazil");
    expect(countryOfPlace("Cascadura, Rio de Janeiro, Brazil")).toBe("Brazil");
  });

  it("counts a historical state as the one country it lies in today", () => {
    expect(countryOfPlace("Lidečko, Ungarisch Brod, Moravia")).toBe("Czechia");
    expect(countryOfPlace("Sindlingen, Frankfurt, Duchy of Nassau")).toBe("Germany");
    expect(countryOfPlace("Schwerin, Mecklenburg-Schwerin")).toBe("Germany");
    expect(countryOfPlace("Stuttgart, Württemberg")).toBe("Germany");
    expect(countryOfPlace("Wallaceburg, Kent, Upper Canada, British North America")).toBe("Canada");
    expect(countryOfPlace("Honolulu, Oahu, Kingdom of Hawaii")).toBe("United States");
    expect(countryOfPlace("Dili, Portuguese Timor")).toBe("Timor-Leste");
    expect(countryOfPlace("Placentia, Stann Creek, British Honduras")).toBe("Belize");
  });

  it("keeps the name of a historical state in several countries today, and reads only the last segment", () => {
    expect(countryOfPlace("Tarashcha, Kiev Governorate, Russian Empire")).toBe("Russian Empire");
    expect(countryOfPlace("Lidečko, Uherský Brod, Moravia, Czechoslovakia")).toBe("Czechoslovakia");
    expect(countryOfPlace("Königsberg, East Prussia, Prussia")).toBe("Prussia");
    expect(countryOfPlace("Rangoon, Burma")).toBe("Burma");
    expect(countryOfPlace("Zwittau, Mährisch Trübau, Moravia, Austria")).toBe("Austria");
  });

  it.each(["England", "Scotland", "Wales", "Northern Ireland", "scotland"])(
    "reads %s as the United Kingdom, as a FamilySearch standard place names it",
    (constituent) => {
      expect(countryOfPlace(`Somewhere, ${constituent}`)).toBe("United Kingdom");
    },
  );

  it.each([
    "World", "world", "Africa", "Antarctica", "Asia", "Europe", "North America", "South America",
    "At Sea", "Atlantic Ocean", "Pacific Ocean", "Indian Ocean", "arctic ocean",
    "Mediterranean Sea", "Adriatic Sea, Mediterranean Sea", "north sea", "Sea of Japan", "Hawaiian Seas",
    "Gulf of Mexico",
  ])("gives none for %s, which is no country", (top) => {
    expect(countryOfPlace(top)).toBeNull();
    expect(countryOfPlace(`Somewhere, ${top}`)).toBeNull();
  });

  it("reads a sea only in the last segment", () => {
    expect(countryOfPlace("Port Sudan, Red Sea, Sudan")).toBe("Sudan");
  });

  it("gives none for a place with no segment", () => {
    expect(countryOfPlace("")).toBeNull();
    expect(countryOfPlace(" , ")).toBeNull();
  });
});

describe("standardPlaceToRepId", () => {
  it("prefers an exact fullName match over a higher-scored other", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "exact", fullName: "Paris, Bear Lake, Idaho, United States", score: 0.3 }),
      entry({ placeRepId: "other", fullName: "Paris, France", score: 0.99 }),
    ]);
    expect(
      await standardPlaceToRepId("Paris, Bear Lake, Idaho, United States"),
    ).toBe("exact");
  });

  it("falls back to best-scored when no exact match", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "a", fullName: "Springfield, Illinois, United States", score: 0.2 }),
      entry({ placeRepId: "b", fullName: "Springfield, Missouri, United States", score: 0.8 }),
    ]);
    expect(await standardPlaceToRepId("Springfield")).toBe("b");
  });
});

describe("standardPlaceToPlaceId", () => {
  it("returns the placeId when exact matches agree", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P", fullName: "Berlin, Germany", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P", fullName: "Berlin, Germany", score: 0.5 }),
    ]);
    expect(await standardPlaceToPlaceId("Berlin, Germany")).toBe("P");
  });

  it("returns null when candidates disagree on placeId (guards fan-out)", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Berlin, Germany", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Berlin, Germany", score: 0.9 }),
    ]);
    expect(await standardPlaceToPlaceId("Berlin, Germany")).toBeNull();
  });
});

describe("resolveStandardPlaceToPlaceId", () => {
  it("resolves to a placeId when exact matches agree", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P", fullName: "Berlin, Germany", score: 0.9 }),
    ]);
    expect(await resolveStandardPlaceToPlaceId("Berlin, Germany")).toEqual({
      kind: "resolved",
      placeId: "P",
    });
  });

  // The whole point of the discriminated form: the wrapper collapses this and
  // the case below to the same `null`.
  it("reports ambiguous with one candidate per distinct placeId", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Franklin, Virginia, United States", type: "County", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Franklin, Virginia, United States", type: "Independent City", score: 0.9 }),
    ]);
    expect(await resolveStandardPlaceToPlaceId("Franklin, Virginia, United States")).toEqual({
      kind: "ambiguous",
      candidates: [
        "Franklin, Virginia, United States (County)",
        "Franklin, Virginia, United States (Independent City)",
      ],
    });
  });

  it("reports unresolved when nothing carries a placeId", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", fullName: "Nowhere", score: 0.9 }),
    ]);
    expect(await resolveStandardPlaceToPlaceId("Nowhere")).toEqual({ kind: "unresolved" });
  });

  // One line per distinct placeId, not per rep: two reps of one spot are not a
  // choice the caller has to make.
  it("collapses several reps of one placeId to a single candidate", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Berlin, Germany", type: "City", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P1", fullName: "Berlin, Germany", type: "City", score: 0.8 }),
      entry({ placeRepId: "3", placeId: "P2", fullName: "Berlin, Germany", type: "State", score: 0.7 }),
    ]);
    const r = await resolveStandardPlaceToPlaceId("Berlin, Germany");
    expect(r).toEqual({
      kind: "ambiguous",
      candidates: ["Berlin, Germany (City)", "Berlin, Germany (State)"],
    });
  });

  it("caps the candidate list at 8", async () => {
    mockSearchPlace.mockResolvedValue(
      Array.from({ length: 12 }, (_unused, i) =>
        entry({ placeRepId: `r${i}`, placeId: `P${i}`, fullName: "Springfield", type: "City", score: 0.9 })
      )
    );
    const r = await resolveStandardPlaceToPlaceId("Springfield");
    expect(r.kind).toBe("ambiguous");
    expect(r.kind === "ambiguous" && r.candidates).toHaveLength(8);
  });

  // No exact fullName match, so the fallback pool (everything with a placeId)
  // is what gets described -- and a blank `type` must not leave a dangling
  // " ()" on the end of the line.
  it("omits the type qualifier when the entry has none", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Alpha, X", type: "", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Beta, Y", type: "", score: 0.9 }),
    ]);
    const r = await resolveStandardPlaceToPlaceId("Gamma");
    expect(r).toEqual({ kind: "ambiguous", candidates: ["Alpha, X", "Beta, Y"] });
  });

  // ── (Type) suffix disambiguation (issue #2886) ──────────────────────────

  it("resolves when the input carries a (Type) suffix matching one candidate", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Franklin, Virginia, United States", type: "County", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Franklin, Virginia, United States", type: "Independent City", score: 0.9 }),
    ]);
    expect(
      await resolveStandardPlaceToPlaceId("Franklin, Virginia, United States (County)")
    ).toEqual({ kind: "resolved", placeId: "P1" });
  });

  it("resolves each member of a same-fullName pair to its own placeId", async () => {
    const entries = [
      entry({ placeRepId: "1", placeId: "P1", fullName: "Franklin, Virginia, United States", type: "County", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Franklin, Virginia, United States", type: "Independent City", score: 0.9 }),
    ];
    mockSearchPlace.mockResolvedValue(entries);
    expect(
      await resolveStandardPlaceToPlaceId("Franklin, Virginia, United States (County)")
    ).toEqual({ kind: "resolved", placeId: "P1" });

    __clearPlaceResolverCachesForTests();
    mockSearchPlace.mockResolvedValue(entries);
    expect(
      await resolveStandardPlaceToPlaceId("Franklin, Virginia, United States (Independent City)")
    ).toEqual({ kind: "resolved", placeId: "P2" });
  });

  it("parses a (Type) suffix whose type itself carries parentheses", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Channel Islands", type: "Island(s)", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Channel Islands", type: "Region", score: 0.9 }),
    ]);
    expect(
      await resolveStandardPlaceToPlaceId("Channel Islands (Island(s))")
    ).toEqual({ kind: "resolved", placeId: "P1" });
  });

  it("returns unresolved when the (Type) suffix matches no candidate", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Franklin, Virginia, United States", type: "County", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Franklin, Virginia, United States", type: "Independent City", score: 0.9 }),
    ]);
    expect(
      await resolveStandardPlaceToPlaceId("Franklin, Virginia, United States (Township)")
    ).toEqual({ kind: "unresolved" });
  });

  it("matches the (Type) suffix case-insensitively", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Rattvik, Kopparberg, Sweden", type: "Lutheran Parish", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Rattvik, Kopparberg, Sweden", type: "District", score: 0.9 }),
      entry({ placeRepId: "3", placeId: "P3", fullName: "Rattvik, Kopparberg, Sweden", type: "Municipality", score: 0.9 }),
    ]);
    expect(
      await resolveStandardPlaceToPlaceId("Rattvik, Kopparberg, Sweden (lutheran parish)")
    ).toEqual({ kind: "resolved", placeId: "P1" });
  });

  it("strips the (Type) suffix before calling the search API", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Franklin, Virginia, United States", type: "County", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Franklin, Virginia, United States", type: "Independent City", score: 0.9 }),
    ]);
    await resolveStandardPlaceToPlaceId("Franklin, Virginia, United States (County)");
    expect(mockSearchPlace).toHaveBeenCalledWith(
      "Franklin, Virginia, United States",
      expect.anything(),
    );
  });

  it("returns unresolved when the suffixed input has no exact-fullName matches", async () => {
    // No entry's fullName matches "Gamma, Z", so exact is empty. The fallback
    // pool must not be type-filtered — it can hold unrelated places of that type.
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Alpha, X", type: "County", score: 0.9 }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Beta, Y", type: "County", score: 0.8 }),
    ]);
    expect(
      await resolveStandardPlaceToPlaceId("Gamma, Z (County)")
    ).toEqual({ kind: "unresolved" });
  });

  it("returns unresolved when a single-candidate pool has a non-matching (Type) suffix", async () => {
    // Mora has one jurisdiction (Municipality). An agent sending
    // "(Lutheran Parish)" must not silently resolve to the Municipality.
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Mora, Kopparberg, Sweden", type: "Municipality", score: 0.9 }),
    ]);
    expect(
      await resolveStandardPlaceToPlaceId("Mora, Kopparberg, Sweden (Lutheran Parish)")
    ).toEqual({ kind: "unresolved" });
  });

  it("returns unresolved when a real fullName ends in a parenthetical that parseTypeSuffix misreads", async () => {
    // "Forfarshire (Angus)" is a real fullName (renamed county). The regex
    // parses it as bareName="Forfarshire", type="Angus". The search for
    // "Forfarshire" returns one entry whose fullName is "Forfarshire (Angus)",
    // which does not match "Forfarshire" exactly, so exact is empty and the
    // type filter returns unresolved rather than silently resolving the bare name.
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "PBARE", fullName: "Forfarshire (Angus)", type: "County", score: 0.9 }),
    ]);
    expect(
      await resolveStandardPlaceToPlaceId("Forfarshire (Angus)")
    ).toEqual({ kind: "unresolved" });
  });
});

describe("empty / whitespace input short-circuits without a network search", () => {
  it("standardPlaceToPlaceId returns null and never searches", async () => {
    expect(await standardPlaceToPlaceId("   ")).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("standardPlaceToCoords returns null and never searches", async () => {
    expect(await standardPlaceToCoords("")).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("resolveStandardPlace returns null and never searches", async () => {
    expect(await resolveStandardPlace("  ")).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });
});

describe("non-place phrases are never standardized (#1962)", () => {
  it("recognizes the whole-text phrase, ignoring case, spacing and periods", () => {
    for (const p of ["Same House", "  same   PLACE ", "R.F.D.", "Do.", "Ditto", "N/A"]) {
      expect(isNonPlacePhrase(p), p).toBe(true);
    }
  });

  it("ignores trailing punctuation, never leading or inner punctuation", () => {
    for (const p of ["Same House,", "Same House ;", "Unknown:", "Do,,", "Same House -", "Same House)"]) {
      expect(isNonPlacePhrase(p), p).toBe(true);
    }
    for (const p of ["(Same House)", "Same, House", "Same House, Wayne,", "-Same House"]) {
      expect(isNonPlacePhrase(p), p).toBe(false);
    }
  });

  it("accepts a real place, including one that contains a phrase word", () => {
    for (const p of ["Same Place, Wayne, Ohio", "Same, Manufahi, Timor-Leste", "Homer", "Rural Retreat", "Dover", "Home, Clermont, Ohio", "Farmington,"]) {
      expect(isNonPlacePhrase(p), p).toBe(false);
    }
  });

  it("resolveStandardPlace returns null without searching, with or without record context", async () => {
    mockSearchPlace.mockResolvedValue([entry({ placeRepId: "1", fullName: "Same, Manufahi, Timor-Leste", type: "Town" })]);
    expect(await resolveStandardPlace("Same House")).toBeNull();
    expect(await resolveStandardPlace("Do", { contextPlaces: ["Wayne, Ohio, United States"] })).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });
});

describe("repIdToStandardPlace", () => {
  it("returns the fullName from the description endpoint", async () => {
    mockGetPlaceById.mockResolvedValue({
      placeRepId: "42",
      placeId: "p",
      name: "Cork",
      fullName: "Cork, Munster, Ireland",
      type: "County",
    } as Awaited<ReturnType<typeof getPlaceById>>);
    expect(await repIdToStandardPlace("42")).toBe("Cork, Munster, Ireland");
  });

  it("returns null when the rep is not found (404)", async () => {
    mockGetPlaceById.mockResolvedValue(null);
    expect(await repIdToStandardPlace("nope")).toBeNull();
  });
});

describe("gedcomxDateYears — the years a GEDCOM X date spans", () => {
  it("reads FamilySearch's formal date whatever the original says (WS89-MGMM's date in other languages)", () => {
    expect(gedcomxDateYears({ original: "4 Aug 1794", formal: "+1794-08-04" })).toEqual({ from: 1794, to: 1794 });
    expect(gedcomxDateYears({ original: "4 sierpnia 1794", formal: "+1794-08-04" })).toEqual({ from: 1794, to: 1794 });
    expect(gedcomxDateYears({ original: "1794年8月4日", formal: "+1794-08-04" })).toEqual({ from: 1794, to: 1794 });
    expect(gedcomxDateYears({ original: "4 Aug 1794", formal: "+1801" })).toEqual({ from: 1801, to: 1801 });
  });

  it("reads formal ranges, open ends and approximate dates", () => {
    expect(gedcomxDateYears({ formal: "+1910/+1920" })).toEqual({ from: 1910, to: 1920 });
    expect(gedcomxDateYears({ formal: "/+1795" })).toEqual({ from: -Infinity, to: 1795 });
    expect(gedcomxDateYears({ formal: "+1830/" })).toEqual({ from: 1830, to: Infinity });
    expect(gedcomxDateYears({ formal: "A+1874" })).toEqual({ from: 1873, to: 1875 });
    expect(gedcomxDateYears({ formal: "+1980-09" })).toEqual({ from: 1980, to: 1980 });
    expect(gedcomxDateYears({ formal: "-0044-03-15" })).toEqual({ from: -44, to: -44 });
  });

  it("reads a before or after date as open on that side, as its formal date is", () => {
    expect(gedcomxDateYears({ original: "Bef 1900" })).toEqual({ from: -Infinity, to: 1900 });
    expect(gedcomxDateYears({ original: "antes de 1900" })).toEqual({ from: -Infinity, to: 1900 });
    expect(gedcomxDateYears({ original: "Aft 1850" })).toEqual({ from: 1850, to: Infinity });
    expect(gedcomxDateYears({ original: "Bet 1850 and Aft 1860" })).toEqual({ from: 1850, to: Infinity });
    expect(gedcomxDateYears({ original: "Abt 1850" })).toEqual({ from: 1849, to: 1851 });
  });

  it("reads the original as stdDate does when there is no formal date it can read (QK9S-KLJK)", () => {
    expect(gedcomxDateYears({ original: "20 Aug 1922" })).toEqual({ from: 1922, to: 1922 });
    expect(gedcomxDateYears({ original: "1850", formal: "+1850/P10Y" })).toEqual({ from: 1850, to: 1850 });
    expect(gedcomxDateYears({ original: "1850", formal: "R/+1850/P1Y" })).toEqual({ from: 1850, to: 1850 });
    // A time, or a year with no sign, is not a fact's formal date.
    expect(gedcomxDateYears({ original: "1902", formal: "+1899-01-01T00:00:00Z" })).toEqual({ from: 1902, to: 1902 });
    expect(gedcomxDateYears({ original: "1902", formal: "1899" })).toEqual({ from: 1902, to: 1902 });
  });

  it("is null when neither can be read (65TF-GJMJ's death \"ayer\")", () => {
    expect(gedcomxDateYears({ original: "ayer" })).toBeNull();
    expect(gedcomxDateYears({ original: "4 sierpnia 1794" })).toBeNull();
    expect(gedcomxDateYears({ original: "", formal: "" })).toBeNull();
    expect(gedcomxDateYears({ formal: "/" })).toBeNull();
    expect(gedcomxDateYears({ formal: "A" })).toBeNull();
    expect(gedcomxDateYears({})).toBeNull();
    expect(gedcomxDateYears(undefined)).toBeNull();
  });
});

describe("repIdToStandardPlaceAt — the one name a place's representations valid at a date share", () => {
  // Live Places API data, fetched 2026-10-26 (Accept-Language: en; types
  // 2026-10-29). The place's listing gives every representation's name, range
  // and own names in every language; the chosen representation's description
  // gives its place and type. A representation's names are its own name unless
  // listed.
  type Rep = { type?: string; fullName: string; placeId: string; dateRange?: string; placeRepId?: string; names?: string[] };
  const reps: Record<string, Rep> = {
    // Olne, place 1959431 (6J8F-6678 chose 418460 for an 1874 death).
    "418460": { type: "Municipality", fullName: "Olne, Prince-Bishopric of Liège, Holy Roman Empire", placeId: "1959431", dateRange: "/+1795" },
    "12441859": { type: "Municipality", fullName: "Olne, L'Ourthe, France", placeId: "1959431", dateRange: "+1795/+1815" },
    "12441860": { type: "Municipality", fullName: "Olne, Liège, Netherlands", placeId: "1959431", dateRange: "+1815/+1830" },
    "12441861": { type: "Municipality", fullName: "Olne, Liège, Belgium", placeId: "1959431", dateRange: "+1830/" },
    // Caracas, place 5061582 (WS89-MGMM chose 2241910 for a 1794 baptism).
    "2241910": { type: "City", fullName: "Caracas, Libertador, Distrito Capital, Venezuela", placeId: "5061582", dateRange: "+1999/" },
    "13598205": { type: "City", fullName: "Caracas, Distrito Federal, Venezuela", placeId: "5061582", dateRange: "+1567/+1999" },
    // Braunau, place 6268992: a range with a three-digit year.
    "11861494": { type: "Municipality", fullName: "Braunau, Thurgau, Switzerland", placeId: "6268992", dateRange: "+1999/" },
    "11912912": { type: "Village", fullName: "Braunau, Tobel, Thurgau, Switzerland", placeId: "6268992", dateRange: "+1803/+1998" },
    "3057466": { type: "Municipality", fullName: "Braunau, Thurgau, Switzerland", placeId: "6268992", dateRange: "+762/+1803" },
    // Bolívar, place 1929942: one representation, from 1886 (6589-3NS5, born 1856).
    "5775": { type: "Department", fullName: "Bolívar, Colombia", placeId: "1929942", dateRange: "+1886/" },
    // Bela Vista, place 6283855 (6B9K-FXBZ chose 10979131 for a 1980 death
    // written "Bela Vista"): renamed Echaporã in 1944.
    "11261236": { type: "District", fullName: "Catequese, Campos Novos, São Paulo, Brazil", placeId: "6283855", dateRange: "+1928/+1937" },
    "11818622": { type: "Civil Registration District", fullName: "Bela Vista, Campos Novos, São Paulo, Brazil", placeId: "6283855", dateRange: "+1937/+1938" },
    "10979131": { type: "Municipality", fullName: "Bela Vista, São Paulo, Brazil", placeId: "6283855", dateRange: "+1938/+1944" },
    "3052592": { type: "Municipality", fullName: "Echaporã, São Paulo, Brazil", placeId: "6283855", dateRange: "+1944/" },
    // Kuopio (QLVZ-74MS, census "from 1854 to 1863", written "Kuopio, Kuopio")
    // and Boda (no range at all).
    "422411": { type: "City", fullName: "Kuopion kaupunki, Kuopio, Finland", placeId: "1962838", dateRange: "+1775/+1998" },
    "10909387": { type: "City", fullName: "Kuopio, Pohjois-Savo, Finland", placeId: "1962838", dateRange: "+1998/" },
    "3461825": { type: "Parish", fullName: "Boda, Kopparberg, Sweden", placeId: "6373646" },
    // Christ Church, Middlesex, place 1357800 (4M3P-3SZM chose 5407392 for a
    // 1732 marriage): two representations, neither with a range.
    "5407391": { type: "Place of Worship", fullName: "Christ Church, Middlesex, Virginia, United States", placeId: "1357800" },
    "5407392": { type: "Place of Worship", fullName: "Christ Church, Middlesex, Virginia, British Colonial America", placeId: "1357800" },
    // Kälbertshausen, place 3901588: one representation with no range beside dated ones.
    "9724551": { type: "Populated Place", fullName: "Kälbertshausen, Hüffenhardt, Mosbach, Baden-Württemberg, Germany", placeId: "3901588", dateRange: "+1945/+1973" },
    "8933333": { type: "Populated Place", fullName: "Kälbertshausen, Mosbach, Baden-Württemberg, Germany", placeId: "3901588", dateRange: "+1945/+1973" },
    "6721274": { type: "Populated Place", fullName: "Kälbertshausen, Mosbach, Baden, Germany", placeId: "3901588", dateRange: "+1871/+1945" },
    "8933334": { type: "Populated Place", fullName: "Kälbertshausen, Hüffenhardt, Mosbach, Baden, Germany", placeId: "3901588", dateRange: "+1871/+1945" },
    "13833387": { type: "Village", fullName: "Kälbertshausen, Mosbach, Baden", placeId: "3901588", dateRange: "+1806/+1871" },
    "8933335": { type: "Populated Place", fullName: "Kälbertshausen, Hüffenhardt, Neckar-Odenwald-Kreis, Baden-Württemberg, Germany", placeId: "3901588" },
    // Simmern, place 6162326: names with type words.
    "11973621": { type: "District", fullName: "Kreis Simmern, Rhineland, Prussia, Germany", placeId: "6162326", dateRange: "+1871/+1969" },
    "7806009": { type: "District", fullName: "Kreis Simmern, Rhineland, Prussia", placeId: "6162326", dateRange: "+1814/+1871" },
    "13838056": { type: "District", fullName: "Arrondissement Simmern, Rhin-et-Moselle, France", placeId: "6162326", dateRange: "+1794/+1814" },
    "13838055": { type: "District", fullName: "Oberamt Simmern, Palatinate, Holy Roman Empire", placeId: "6162326", dateRange: "+1673/+1794" },
    // Aberayron, place 6256682: Q2W9-1GVF's 1881 census, written
    // "Llanbadarn-Tref-Eglwys, Cardiganshire, Wales", was given the town.
    "10579232": { type: "Town", fullName: "Aberayron, Cardiganshire, Wales, United Kingdom", placeId: "6256682", dateRange: "+1801/" },
    "3040252": { type: "Poor Law Union", fullName: "Aberayron, Cardiganshire, Wales", placeId: "6256682", dateRange: "/+1801" },
    // Carmarthen, place 5059906: SGZQ-Y3L's 1851 census, written "Saint Peter,
    // Carmarthenshire, Wales", was given the town. Named in Welsh and English.
    "2242535": { type: "Town", fullName: "Carmarthen, Carmarthenshire, Wales, United Kingdom", placeId: "5059906", dateRange: "+1996/", names: ["Caerfyrddin", "Carmarthen"] },
    "2242536": { type: "Town", fullName: "Carmarthen, Dyfed, Wales, United Kingdom", placeId: "5059906", dateRange: "+1974/+1996", names: ["Caerfyrddin", "Carmarthen"] },
    "10579589": { type: "Town", fullName: "Carmarthen, Carmarthenshire, Wales, United Kingdom", placeId: "5059906", dateRange: "+1801/+1974", names: ["Caerfyrddin", "Carmarthen"] },
    "10278967": { type: "Town", fullName: "Carmarthen, Carmarthenshire, Wales", placeId: "5059906", dateRange: "/+1801", names: ["Caerfyrddin", "Carmarthen"] },
    // Florence, place 5061195 (X7S5-8J2Z's 1813 baptism, written "Firenze,
    // Firenze, Toscana, Italia"): named in German, English and Italian.
    "7344713": { type: "Municipality", fullName: "Florence, Florence, Tuscany, Italy", placeId: "5061195", dateRange: "+1861/", names: ["Florenz", "Florence", "Firenze"] },
    "12114895": { type: "Municipality", fullName: "Florence, Florence, Tuscany", placeId: "5061195", dateRange: "+1569/+1860", names: ["Florenz", "Florence", "Firenze"] },
    // Piauí, place 1929896 (6B9K-FXBZ's 1905 birth, written "Liro, Piaui").
    "5736": { type: "State", fullName: "Piauí, Brazil", placeId: "1929896", dateRange: "+1889/", names: ["Piauí", "Piauí"] },
    // La Matriz, place 9544725 (ZMX8-MHT2's 1896 baptism, written `Ecuador,
    // Chimborazo, Guano, La Matriz "El Carmen" de Guano`).
    "11016701": { type: "Parish", fullName: "La Matriz, Guano, Chimborazo, Ecuador", placeId: "9544725", dateRange: "+1845/" },
    // Nitra, place 1939489 (6N9M-7NKV's 1870 baptism, written "Nitra, Slovensko").
    "444190": { type: "District", fullName: "Nitra, Slovakia", placeId: "1939489", dateRange: "+1993/", names: ["Nitra"] },
    "444191": { type: "District", fullName: "Nitra, Czechoslovakia", placeId: "1939489", dateRange: "+1920/+1992", names: ["Nitra"] },
    "12200061": { type: "County (Top level)", fullName: "Nyitra, Hungary", placeId: "1939489", dateRange: "/+1920", names: ["Neutra", "Nitra", "Nyitra"] },
    // The Kiev Voivodeship, place 1929438 (6293-8K43's 1866 census, written
    // "Киевское воеводство, Польша", was given 11574124).
    "11574124": { type: "Province", fullName: "Kyiv, Poland", placeId: "1929438", dateRange: "+1569/+1793", names: ["Woiwodschaft Kiew", "Киевское воеводство", "Київське воєводство", "Kyiv", "kijowskie"] },
    "10907979": { type: "Governorate", fullName: "Kiev Governorate, Russian Empire", placeId: "1929438", dateRange: "+1721/+1917", names: ["Kiev Guberniia", "Киевская губерния", "Київська губернія", "Kiev Governorate"] },
    "13564868": { type: "Governorate", fullName: "Kiev, Ukraine, Soviet Union", placeId: "1929438", dateRange: "+1917/+1925", names: ["Киевская губерния", "Kiev"] },
    "5344": { type: "Region", fullName: "Kyiv, Ukraine", placeId: "1929438", dateRange: "+1991/", names: ["Киевская область", "Київська область", "Kyiv"] },
  };
  const placeReps: Record<string, string[]> = {
    "1959431": ["12441861", "12441860", "12441859", "418460"],
    "5061582": ["2241910", "13598205"],
    "6268992": ["11861494", "11912912", "3057466"],
    "1929942": ["5775"],
    "6283855": ["3052592", "10979131", "11818622", "11261236"],
    "1962838": ["10909387", "422411"],
    "6373646": ["3461825"],
    "1357800": ["5407391", "5407392"],
    "3901588": ["9724551", "8933333", "6721274", "8933334", "13833387", "8933335"],
    "6162326": ["11973621", "7806009", "13838056", "13838055"],
    "6256682": ["10579232", "3040252"],
    "5059906": ["2242535", "2242536", "10579589", "10278967"],
    "5061195": ["7344713", "12114895"],
    "1929896": ["5736"],
    "9544725": ["11016701"],
    "1939489": ["444190", "444191", "12200061"],
    "1929438": ["5344", "13564868", "10907979", "11574124"],
  };
  const description = (table: Record<string, Partial<Rep> & { fullName: string }>) => async (id: string) => {
    const rep = table[id];
    if (!rep) return null;
    return { placeRepId: id, name: rep.fullName.split(",")[0], type: "City", ...rep } as Awaited<
      ReturnType<typeof getPlaceById>
    >;
  };
  const listing = (table: Record<string, Rep>, places: Record<string, string[]>) => async (pid: string) =>
    (places[pid] ?? []).map((id) => ({
      placeRepId: id,
      fullName: table[id].fullName,
      dateRange: table[id].dateRange,
      names: table[id].names ?? [table[id].fullName.split(",")[0]],
    }));
  const year = (from: number, to = from) => ({ from, to });

  beforeEach(() => {
    mockGetPlaceById.mockImplementation(description(reps));
    mockGetPlaceReps.mockImplementation(listing(reps, placeReps));
  });

  it("names the one name every representation valid at the date shares (Olne, Caracas, Braunau, Kuopio, Boda)", async () => {
    expect(await repIdToStandardPlaceAt("418460", year(1790), "Olne")).toBe("Olne, Prince-Bishopric of Liège, Holy Roman Empire");
    expect(await repIdToStandardPlaceAt("418460", year(1820), "Olne")).toBe("Olne, Liège, Netherlands");
    expect(await repIdToStandardPlaceAt("418460", year(1874), "Olne")).toBe("Olne, Liège, Belgium");
    expect(await repIdToStandardPlaceAt("12441861", year(1874), "Olne")).toBe("Olne, Liège, Belgium");
    expect(await repIdToStandardPlaceAt("2241910", year(1794), "Caracas")).toBe("Caracas, Distrito Federal, Venezuela");
    expect(await repIdToStandardPlaceAt("11861494", year(1793), "Braunau")).toBe("Braunau, Thurgau, Switzerland");
    expect(await repIdToStandardPlaceAt("422411", year(1854, 1863), "Kuopion kaupunki")).toBe("Kuopion kaupunki, Kuopio, Finland");
    expect(await repIdToStandardPlaceAt("3461825", year(1845), "Boda")).toBe("Boda, Kopparberg, Sweden");
  });

  it("looks up the chosen representation's description and its place's listing once each, and no other description", async () => {
    expect(await repIdToStandardPlaceAt("418460", year(1874), "Olne")).toBe("Olne, Liège, Belgium");
    expect(await repIdToStandardPlaceAt("418460", year(1820), "Olne")).toBe("Olne, Liège, Netherlands");
    expect(mockGetPlaceById.mock.calls).toEqual([["418460"]]);
    expect(mockGetPlaceReps.mock.calls).toEqual([["1959431"]]);
  });

  it("names nothing when no part of the record's own text is one of the place's names (Q2W9-1GVF's Aberayron, SGZQ-Y3L's Carmarthen)", async () => {
    expect(await repIdToStandardPlaceAt("10579232", year(1881), "Llanbadarn-Tref-Eglwys, Cardiganshire, Wales")).toBeNull();
    expect(await repIdToStandardPlaceAt("10579589", year(1851), "Saint Peter, Carmarthenshire, Wales")).toBeNull();
    expect(await repIdToStandardPlaceAt("10579589", year(1851), "")).toBeNull();
    expect(await repIdToStandardPlaceAt("10579232", year(1881), "Aberayron, Cardiganshire, Wales")).toBe(
      "Aberayron, Cardiganshire, Wales, United Kingdom",
    );
    expect(await repIdToStandardPlaceAt("10579589", year(1851), "Carmarthen")).toBe("Carmarthen, Carmarthenshire, Wales, United Kingdom");
  });

  it("reads every part of the text against every representation's names in every language, as checkFirstPlace compares names", async () => {
    // A name in another language (X7S5-8J2Z's Firenze; Caerfyrddin is Carmarthen in Welsh).
    expect(await repIdToStandardPlaceAt("7344713", year(1813), "Firenze, Firenze, Toscana, Italia")).toBe("Florence, Florence, Tuscany");
    expect(await repIdToStandardPlaceAt("10579589", year(1851), "Caerfyrddin")).toBe("Carmarthen, Carmarthenshire, Wales, United Kingdom");
    // The name in a later part, without its accent (6B9K-FXBZ's "Liro, Piaui").
    expect(await repIdToStandardPlaceAt("5736", year(1905), "Liro, Piaui")).toBe("Piauí, Brazil");
    // Another representation's name (QLVZ-74MS: 422411 is "Kuopion kaupunki", the place is also "Kuopio").
    expect(await repIdToStandardPlaceAt("422411", year(1854, 1863), "Kuopio, Kuopio")).toBe("Kuopion kaupunki, Kuopio, Finland");
    // Type words ignored: "Simmern" is "Kreis Simmern".
    expect(await repIdToStandardPlaceAt("11973621", year(1850), "Simmern")).toBe("Kreis Simmern, Rhineland, Prussia");
  });

  it("reads each part only up to its first parenthesis or quotation mark (ZMX8-MHT2's dedication, QLNH-QVQB's municipality)", async () => {
    const matriz = 'Ecuador, Chimborazo, Guano, La Matriz "El Carmen" de Guano';
    expect(await repIdToStandardPlaceAt("11016701", year(1896), matriz)).toBe("La Matriz, Guano, Chimborazo, Ecuador");
    expect(await repIdToStandardPlaceAt("11016701", year(1896), 'La Matriz" de Guano')).toBe(
      "La Matriz, Guano, Chimborazo, Ecuador",
    );
    expect(await repIdToStandardPlaceAt("11016701", year(1896), "La Matriz de Guano")).toBeNull();
    expect(await repIdToStandardPlaceAt("5736", year(1905), "Piaui (Liro)")).toBe("Piauí, Brazil");
    expect(await repIdToStandardPlaceAt("5736", year(1905), "Liro (Piaui)")).toBeNull();
  });

  it("reads only the first part for a settlement, where a later part names a jurisdiction (KF9R-VTB's Krymki, 68ZW-7WGQ's Hankamäki)", async () => {
    // Live 2026-10-29: FamilySearch gave the 1847 death in the village of
    // Krymki the city of Kyiv, and the 1915 census written largest first
    // the village of Hankamäki.
    const settlements: Record<string, Rep> = {
      "5345": { type: "City", fullName: "Kyiv, Ukraine", placeId: "1929439", dateRange: "+1991/", names: ["Киев", "Київ", "Kyiv"] },
      "11853155": { type: "City", fullName: "Kiev, Kiev, Kiev Governorate, Russian Empire", placeId: "1929439", dateRange: "+1796/+1922", names: ["Kiev", "Киев", "Київ"] },
      "10944403": { type: "Village", fullName: "Hankamäki, Hankasalmi, Kuopio, Finland", placeId: "9497521" },
    };
    mockGetPlaceById.mockImplementation(description({ ...reps, ...settlements }));
    mockGetPlaceReps.mockImplementation(
      listing({ ...reps, ...settlements }, { ...placeReps, "1929439": ["5345", "11853155"], "9497521": ["10944403"] }),
    );
    expect(await repIdToStandardPlaceAt("5345", year(1847), "Троицкая церковь, Крымки, Чигирин, Киев, Украина")).toBeNull();
    expect(await repIdToStandardPlaceAt("5345", year(1847), "Киев, Киев, Украина")).toBe("Kiev, Kiev, Kiev Governorate, Russian Empire");
    expect(await repIdToStandardPlaceAt("10944403", year(1915), "Kuopion, Hankamäki")).toBeNull();
    expect(await repIdToStandardPlaceAt("10944403", year(1915), "Hankamäki, Kuopion")).toBe("Hankamäki, Hankasalmi, Kuopio, Finland");
    // A jurisdiction (a state, a district) is named by any part.
    expect(await repIdToStandardPlaceAt("5736", year(1905), "Liro, Piaui")).toBe("Piauí, Brazil");
    expect(await repIdToStandardPlaceAt("11973621", year(1850), "Mittelstrimmig, Simmern")).toBe("Kreis Simmern, Rhineland, Prussia");
  });

  it("reads the rename rule against a settlement's first part only (6T22-VN4N's 1906 Maceió, Alagoas)", async () => {
    // Live 2026-10-29: FamilySearch gave the marriage 10956281, the town of
    // "Alagoas, Alagoas, Brazil" (1815-1819), whose place is Maceió from 1819.
    // The text's "Alagoas" is the state.
    const maceio: Record<string, Rep> = {
      "3055303": { type: "Town", fullName: "Maceió, Alagoas, Brazil", placeId: "6288778", dateRange: "+1819/" },
      "10956281": { type: "Town", fullName: "Alagoas, Alagoas, Brazil", placeId: "6288778", dateRange: "+1815/+1819" },
    };
    mockGetPlaceById.mockImplementation(description(maceio));
    mockGetPlaceReps.mockImplementation(listing(maceio, { "6288778": ["3055303", "10956281"] }));
    expect(await repIdToStandardPlaceAt("10956281", year(1906), "Maceió, Alagoas, Brasil")).toBe("Maceió, Alagoas, Brazil");
    expect(await repIdToStandardPlaceAt("10956281", year(1906), "Alagoas, Alagoas, Brasil")).toBeNull();
  });

  it("names nothing when no representation is valid at the date (6589-3NS5 Bolívar, born 1856)", async () => {
    expect(await repIdToStandardPlaceAt("5775", year(1856), "Bolívar, Colombia")).toBeNull();
    expect(await repIdToStandardPlaceAt("5775", year(1880, 1890), "Bolívar, Colombia")).toBeNull();
    expect(await repIdToStandardPlaceAt("5775", { from: -Infinity, to: 1900 }, "Bolívar, Colombia")).toBeNull();
    expect(await repIdToStandardPlaceAt("5775", year(1900), "Bolívar, Colombia")).toBe("Bolívar, Colombia");
  });

  it("names nothing when two names are valid at the date, the chosen one's among them (Olne 1830, Braunau 1803, 4M3P-3SZM's Christ Church, Kälbertshausen)", async () => {
    expect(await repIdToStandardPlaceAt("418460", year(1830), "Olne")).toBeNull();
    expect(await repIdToStandardPlaceAt("12441861", year(1830), "Olne")).toBeNull();
    expect(await repIdToStandardPlaceAt("12441860", year(1830), "Olne")).toBeNull();
    expect(await repIdToStandardPlaceAt("11861494", year(1803), "Braunau")).toBeNull();
    expect(await repIdToStandardPlaceAt("5407392", year(1732), "Christ Church, Middlesex, Virginia")).toBeNull();
    expect(await repIdToStandardPlaceAt("5407391", year(1732), "Christ Church, Middlesex, Virginia")).toBeNull();
    expect(await repIdToStandardPlaceAt("8933335", year(1845), "Kälbertshausen")).toBeNull();
    expect(await repIdToStandardPlaceAt("8933335", year(1960), "Kälbertshausen")).toBeNull();
    expect(await repIdToStandardPlaceAt("8933335", year(1990), "Kälbertshausen")).toBe(
      "Kälbertshausen, Hüffenhardt, Neckar-Odenwald-Kreis, Baden-Württemberg, Germany",
    );
  });

  it("needs the date to fall wholly inside a range, so a before or after date that crosses one names nothing", async () => {
    expect(await repIdToStandardPlaceAt("422411", year(1990, 2000), "Kuopio")).toBeNull();
    expect(await repIdToStandardPlaceAt("418460", year(1829, 1831), "Olne")).toBeNull();
    expect(await repIdToStandardPlaceAt("418460", year(1873, 1875), "Olne")).toBe("Olne, Liège, Belgium");
    expect(await repIdToStandardPlaceAt("418460", { from: -Infinity, to: 1800 }, "Olne")).toBeNull();
    expect(await repIdToStandardPlaceAt("418460", { from: -Infinity, to: 1790 }, "Olne")).toBe(
      "Olne, Prince-Bishopric of Liège, Holy Roman Empire",
    );
    expect(await repIdToStandardPlaceAt("418460", { from: 1820, to: Infinity }, "Olne")).toBeNull();
    expect(await repIdToStandardPlaceAt("418460", { from: 1850, to: Infinity }, "Olne")).toBe("Olne, Liège, Belgium");
  });

  it("names nothing when the place was renamed and the record's text names the chosen representation (6B9K-FXBZ Bela Vista 1980)", async () => {
    expect(await repIdToStandardPlaceAt("10979131", year(1980), "Bela Vista")).toBeNull();
    expect(await repIdToStandardPlaceAt("10979131", year(1980), "Bela Vista, São Paulo, Brasil")).toBeNull();
    expect(await repIdToStandardPlaceAt("10979131", year(1980), "Brasil, São Paulo, BELA VISTA")).toBeNull();
    expect(await repIdToStandardPlaceAt("10979131", year(1980), "Bela Vista, Echaporã")).toBeNull();
    // The record's text names the place as it was named in 1980, or by an older name.
    expect(await repIdToStandardPlaceAt("10979131", year(1980), "Echaporã")).toBe("Echaporã, São Paulo, Brazil");
    expect(await repIdToStandardPlaceAt("10979131", year(1980), "Catequese")).toBe("Echaporã, São Paulo, Brazil");
    expect(await repIdToStandardPlaceAt("10979131", year(1940), "Bela Vista")).toBe("Bela Vista, São Paulo, Brazil");
  });

  it("names a renamed place when the record's text gives a name from another era than the chosen one's (6293-8K43's 1866 Kiev Voivodeship)", async () => {
    expect(await repIdToStandardPlaceAt("11574124", year(1866), "Киевское воеводство, Польша")).toBe("Kiev Governorate, Russian Empire");
    expect(await repIdToStandardPlaceAt("11574124", year(1866), "Kyiv, Polska")).toBeNull();
  });

  it("reads the rename rule against the chosen representation's own name, even where the text also gives the name at the date (6N9M-7NKV's 1870 Nitra)", async () => {
    // 444190 is "Nitra, Slovakia" from 1993; in 1870 the place is "Nyitra, Hungary", also named "Nitra" and "Neutra".
    expect(await repIdToStandardPlaceAt("444190", year(1870), "Nitra, Slovensko")).toBeNull();
    expect(await repIdToStandardPlaceAt("444190", year(1870), "Neutra")).toBe("Nyitra, Hungary");
    expect(await repIdToStandardPlaceAt("444190", year(1950), "Nitra")).toBe("Nitra, Czechoslovakia");
  });

  it("counts a retired id the description answers with another representation as renamed (Bela Vista 1980 under a retired id)", async () => {
    // Constructed: a 1980 "Bela Vista" record citing a retired id the description
    // answers with Echaporã's representation, 3052592. The cited id's own name
    // is unknown, so the record's text must give the place's name in 1980.
    mockGetPlaceById.mockImplementation(async (id: string) =>
      id === "99999999" ? description(reps)("3052592") : description(reps)(id),
    );
    expect(await repIdToStandardPlaceAt("99999999", year(1980), "Bela Vista")).toBeNull();
    expect(await repIdToStandardPlaceAt("99999999", year(1980), "Catequese, São Paulo")).toBeNull();
    expect(await repIdToStandardPlaceAt("99999999", year(1980), "Echaporã, São Paulo")).toBe("Echaporã, São Paulo, Brazil");
  });

  it("does not count a new jurisdiction under the same name as a rename (Olne 1874, Bela Vista 1940)", async () => {
    expect(await repIdToStandardPlaceAt("418460", year(1874), "Olne, Liège, Belgique")).toBe("Olne, Liège, Belgium");
    expect(await repIdToStandardPlaceAt("11818622", year(1940), "Bela Vista")).toBe("Bela Vista, São Paulo, Brazil");
    expect(await repIdToStandardPlaceAt("2241910", year(1794), "Caracas, Distrito Federal, Venezuela")).toBe(
      "Caracas, Distrito Federal, Venezuela",
    );
  });

  it("compares names as checkFirstPlace does, type words ignored on both sides (Simmern)", async () => {
    // "Simmern" is the chosen "Kreis Simmern", which in 1800 was "Arrondissement Simmern".
    expect(await repIdToStandardPlaceAt("11973621", year(1800), "Simmern")).toBeNull();
    expect(await repIdToStandardPlaceAt("11973621", year(1800), "Kreis Simmern")).toBeNull();
    expect(await repIdToStandardPlaceAt("11973621", year(1800), "Arrondissement Simmern")).toBe(
      "Arrondissement Simmern, Rhin-et-Moselle, France",
    );
    expect(await repIdToStandardPlaceAt("11973621", year(1850), "Simmern")).toBe("Kreis Simmern, Rhineland, Prussia");

    // Constructed: own names that differ only by a type word are one name.
    __clearPlaceResolverCachesForTests();
    const parish: Record<string, Rep> = {
      "1": { fullName: "Stagstrup Sogn, Thisted, Denmark", placeId: "9", dateRange: "/+1970" },
      "2": { fullName: "Stagstrup, Thisted, Denmark", placeId: "9", dateRange: "+1970/" },
    };
    mockGetPlaceById.mockImplementation(description(parish));
    mockGetPlaceReps.mockImplementation(listing(parish, { "9": ["1", "2"] }));
    expect(await repIdToStandardPlaceAt("1", year(1980), "Stagstrup Sogn")).toBe("Stagstrup, Thisted, Denmark");
    expect(await repIdToStandardPlaceAt("2", year(1960), "Stagstrup")).toBe("Stagstrup Sogn, Thisted, Denmark");
  });

  it("names nothing when a lookup fails", async () => {
    mockGetPlaceById.mockRejectedValueOnce(new Error("boom"));
    expect(await repIdToStandardPlaceAt("418460", year(1790), "Olne")).toBeNull();

    __clearPlaceResolverCachesForTests();
    mockGetPlaceReps.mockRejectedValueOnce(new Error("boom"));
    expect(await repIdToStandardPlaceAt("418460", year(1790), "Olne")).toBeNull();

    __clearPlaceResolverCachesForTests();
    mockGetPlaceReps.mockResolvedValueOnce([]);
    expect(await repIdToStandardPlaceAt("418460", year(1790), "Olne")).toBeNull();
  });

  it("names a retired representation id from its place's listing, which does not hold it (QLNH-QVQB's 1829107)", async () => {
    // The description answers 1829107 with representation 439844, valid to 2004.
    const vorden: Record<string, Rep> = {
      "1829107": { type: "Municipality", fullName: "Vorden, Gelderland, Netherlands", placeId: "1935460", dateRange: "/+2004", placeRepId: "439844" },
      "11132478": { type: "Village", fullName: "Vorden, Bronckhorst, Gelderland, Netherlands", placeId: "1935460", dateRange: "+2005/" },
      "439844": { type: "Municipality", fullName: "Vorden, Gelderland, Netherlands", placeId: "1935460", dateRange: "/+2004" },
    };
    mockGetPlaceById.mockImplementation(description(vorden));
    mockGetPlaceReps.mockImplementation(listing(vorden, { "1935460": ["11132478", "439844"] }));
    expect(await repIdToStandardPlaceAt("1829107", year(1893), "Vorden, Gelderland, Nederland")).toBe("Vorden, Gelderland, Netherlands");
    expect(await repIdToStandardPlaceAt("1829107", year(1893), "Vorden (Bronckhorst)")).toBe("Vorden, Gelderland, Netherlands");
    expect(await repIdToStandardPlaceAt("1829107", year(2010), "Vorden")).toBe("Vorden, Bronckhorst, Gelderland, Netherlands");
  });

  it("looks up no listing for a representation that names no place", async () => {
    mockGetPlaceById.mockImplementation(description({ "902": { fullName: "Unplaced, Somewhere" } }));
    expect(await repIdToStandardPlaceAt("902", year(1850), "Unplaced")).toBeNull();
    expect(mockGetPlaceReps).not.toHaveBeenCalled();
  });

  it("reads month and day bounds, and names nothing beside a range it cannot read or a representation with no name", async () => {
    // Constructed: every live range in the sample is whole years.
    const dated: Record<string, Rep> = {
      "900": { fullName: "Dated, Somewhere", placeId: "9", dateRange: "+1795-10-01/+1815-06-09" },
      "901": { fullName: "Unreadable, Somewhere", placeId: "8", dateRange: "1795 to 1815" },
      "902": { fullName: "Dated, Elsewhere", placeId: "8", dateRange: "+1700/+1750" },
      "903": { fullName: "Unreadable, Alone", placeId: "7", dateRange: "1795 to 1815" },
    };
    mockGetPlaceById.mockImplementation(description(dated));
    mockGetPlaceReps.mockImplementation(listing(dated, { "9": ["900"], "8": ["901", "902"], "7": ["903"] }));
    expect(await repIdToStandardPlaceAt("900", year(1800), "Dated")).toBe("Dated, Somewhere");
    expect(await repIdToStandardPlaceAt("900", year(1820), "Dated")).toBeNull();
    expect(await repIdToStandardPlaceAt("902", year(1720), "Dated")).toBeNull();
    expect(await repIdToStandardPlaceAt("903", year(1800), "Unreadable")).toBeNull();

    __clearPlaceResolverCachesForTests();
    mockGetPlaceReps.mockResolvedValueOnce([{ placeRepId: "900", dateRange: "+1795/+1815", names: ["Dated"] }]);
    expect(await repIdToStandardPlaceAt("900", year(1800), "Dated")).toBeNull();

    __clearPlaceResolverCachesForTests();
    mockGetPlaceReps.mockResolvedValueOnce([
      { placeRepId: "900", fullName: "Dated, Somewhere", dateRange: "+1795/+1815", names: ["Dated"] },
      { placeRepId: "905", dateRange: "+1790/+1810", names: [] },
    ]);
    expect(await repIdToStandardPlaceAt("900", year(1800), "Dated")).toBeNull();
  });
});

describe("standardPlaceToCoords", () => {
  it("returns coords straight from the search entry (no description fetch)", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", fullName: "Rome, Italy", latitude: 41.9, longitude: 12.5, score: 1 }),
    ]);
    expect(await standardPlaceToCoords("Rome, Italy")).toEqual({
      latitude: 41.9,
      longitude: 12.5,
      type: "City",
    });
    expect(mockGetPlaceById).not.toHaveBeenCalled();
  });

  it("falls back to the description endpoint when the entry lacks coords", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "7", fullName: "Atlantis", type: "Town", score: 1 }),
    ]);
    mockGetPlaceById.mockResolvedValue({
      placeRepId: "7",
      name: "Atlantis",
      fullName: "Atlantis",
      type: "City",
      latitude: 1.1,
      longitude: 2.2,
    } as Awaited<ReturnType<typeof getPlaceById>>);
    // The type is the matched search entry's, not the description's.
    expect(await standardPlaceToCoords("Atlantis")).toEqual({
      latitude: 1.1,
      longitude: 2.2,
      type: "Town",
    });
  });
});

describe("placeIdToRepIds", () => {
  it("returns and caches the rep ids for a placeId", async () => {
    mockGetPlaceReps.mockResolvedValue([
      { placeRepId: "10", names: [] },
      { placeRepId: "20", fullName: "B", names: ["B"] },
      { placeRepId: "30", names: [] },
    ]);
    expect(await placeIdToRepIds("P")).toEqual(["10", "20", "30"]);
    expect(await placeIdToRepIds("P")).toEqual(["10", "20", "30"]);
    expect(mockGetPlaceReps).toHaveBeenCalledTimes(1);
  });

  it("returns [] on failure without caching", async () => {
    vi.useFakeTimers();
    mockGetPlaceReps.mockRejectedValue(new Error("boom"));
    const p = placeIdToRepIds("P");
    await vi.runAllTimersAsync();
    expect(await p).toEqual([]);

    mockGetPlaceReps.mockResolvedValueOnce([{ placeRepId: "1", names: [] }]);
    const p2 = placeIdToRepIds("P");
    await vi.runAllTimersAsync();
    expect(await p2).toEqual(["1"]);
  });
});

describe("withRetry", () => {
  it("succeeds after transient failures, backing off between attempts", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("a"))
      .mockRejectedValueOnce(new Error("b"))
      .mockResolvedValueOnce("ok");
    const p = withRetry(fn, { attempts: 3, baseMs: 10 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows after exhausting all attempts", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    const p = withRetry(fn, { attempts: 3, baseMs: 10 });
    const assertion = expect(p).rejects.toThrow("nope");
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves order and caps in-flight work at the limit", async () => {
    let active = 0;
    let maxActive = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (x) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return x * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBe(2);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 8, async (x) => x)).toEqual([]);
  });
});

// The three guards around the `+date:` qualifier. Each fails on main, and each
// fails if its own guard is removed while the rest of the change stays — the
// suite was previously green with place-resolver.ts reverted wholesale.
describe("resolveStandardPlace date qualifier and its guards", () => {
  const rochdale = (score: number, fullName: string) =>
    entry({ placeRepId: "r", fullName, score });

  it("passes the fact's year to searchPlace as a date option", async () => {
    mockSearchPlace.mockResolvedValue([
      rochdale(95, "Rochdale, Lancashire, England, United Kingdom"),
    ]);
    await resolveStandardPlace("Rochdale, England", { date: "12 May 1880" });
    expect(mockSearchPlace).toHaveBeenCalledWith("Rochdale, England", { date: 1880 });
  });

  it("sends no date when the caller supplies none", async () => {
    mockSearchPlace.mockResolvedValue([rochdale(95, "Rochdale, Greater Manchester, England, United Kingdom")]);
    await resolveStandardPlace("Rochdale, England");
    expect(mockSearchPlace).toHaveBeenCalledWith("Rochdale, England", { date: undefined });
  });

  it("sends no dated search for a single-segment input", async () => {
    // "Germany" at 1827 resolves to a village in the Russian Empire when the
    // year is applied: with no parent segment there is nothing to anchor it.
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "v", fullName: "Germany, Pruzhany, Grodno, Russian Empire", score: 99 }),
    ]);
    expect(await resolveStandardPlace("Germany", { date: "about 1827" })).toBe("Germany");
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("ignores a date it cannot parse instead of guessing", async () => {
    mockSearchPlace.mockResolvedValue([rochdale(95, "Rochdale, Lancashire, England, United Kingdom")]);
    await resolveStandardPlace("Rochdale, England", { date: "sometime in the war" });
    expect(mockSearchPlace).toHaveBeenCalledWith("Rochdale, England", { date: undefined });
  });

  it("falls back to an undated query when the dated one returns nothing", async () => {
    // `+date:` is a hard filter: where no representation records coverage for
    // the year FamilySearch returns nothing at all, and a measured share of
    // corpus places went blank before this guard existed. The rate is quoted
    // once, in `getSearchEntries` (src/utils/place-resolver.ts) beside the
    // probe that emits it — restating it here is how the two drifted apart,
    // and nothing checks either copy.
    mockSearchPlace
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([entry({ placeRepId: "m", fullName: "Manger, Hordaland, Norway", score: 90 })]);
    expect(await resolveStandardPlace("Manger, Hordaland, Norge", { date: "1801" }))
      .toBe("Manger, Hordaland, Norway");
    expect(mockSearchPlace).toHaveBeenNthCalledWith(1, "Manger, Hordaland, Norge", { date: 1801 });
    expect(mockSearchPlace).toHaveBeenNthCalledWith(2, "Manger, Hordaland, Norge");
  });

  it("falls back to the undated answer when the guard cannot confirm the dated one", async () => {
    // "Bavaria" names no country the alias table reads, so the verdict here is
    // `unverifiable`, NOT `contradiction` — which is exactly why the trigger is
    // `!== "ok"`. Keying it on `contradiction` alone would persist the dated
    // rendering with the guard having confirmed nothing, so this case is the
    // rail on that trigger: revert it and this test fails.
    mockSearchPlace
      .mockResolvedValueOnce([entry({ placeRepId: "b1", fullName: "Bavaria", score: 99 })])
      .mockResolvedValueOnce([entry({ placeRepId: "b2", fullName: "Bavaria, Germany", score: 95 })]);
    expect(await resolveStandardPlace("Bavaria, Germany", { date: "1843" }))
      .toBe("Bavaria, Germany");
    expect(mockSearchPlace).toHaveBeenCalledTimes(2);
  });

  it("keeps a dated answer the guard does not object to", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "f", fullName: "Forfarshire, Scotland, United Kingdom", score: 97 }),
    ]);
    expect(await resolveStandardPlace("Forfarshire, Scotland", { date: "1865" }))
      .toBe("Forfarshire, Scotland, United Kingdom");
    expect(mockSearchPlace).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by year, so two dates on one place do not collide", async () => {
    mockSearchPlace
      .mockResolvedValueOnce([entry({ placeRepId: "1", fullName: "Rochdale, Lancashire, England, United Kingdom", score: 95 })])
      .mockResolvedValueOnce([entry({ placeRepId: "2", fullName: "Rochdale, Greater Manchester, England, United Kingdom", score: 95 })]);
    expect(await resolveStandardPlace("Rochdale, England", { date: "1880" }))
      .toBe("Rochdale, Lancashire, England, United Kingdom");
    expect(await resolveStandardPlace("Rochdale, England", { date: "1990" }))
      .toBe("Rochdale, Greater Manchester, England, United Kingdom");
    expect(mockSearchPlace).toHaveBeenCalledTimes(2);
  });
});

describe("countryConsistency — diacritics and endonyms", () => {
  it("folds diacritics so an accented country name is still recognised", () => {
    // Before folding, "Guerrero, México" returned "unverifiable" while the
    // unaccented "Guerrero, Mexico" returned "ok" — the same place, the same
    // correct answer, and the guard silently switching itself off on an accent.
    expect(countryConsistency("Guerrero, México", "Guerrero, Mexico")).toBe("ok");
    expect(countryConsistency("Peñas de San Pedro, Albacete, España", "Peñas de San Pedro, Albacete, Spain")).toBe("ok");
    expect(countryConsistency("Wien, Österreich", "Vienna, Austria")).toBe("ok");
  });

  it("reads endonyms on the recorded side against English on the standard side", () => {
    expect(countryConsistency("Manger, Hordaland, Norge", "Manger, Hordaland, Norway")).toBe("ok");
    expect(countryConsistency("Bayern, Deutschland", "Bavaria, Germany")).toBe("ok");
    expect(countryConsistency("Hurup, Refs, Thisted, Danmark", "Hurup, Refs, Thisted, Denmark")).toBe("ok");
    expect(countryConsistency("Paks, Tolna, Magyarország", "Paks, Tolna, Hungary")).toBe("ok");
    expect(countryConsistency("Wanroij, Noord-Brabant, Nederland", "Wanroij, North Brabant, Netherlands")).toBe("ok");
    expect(countryConsistency("Faenza, Ravenna, Italia", "Faenza, Ravenna, Emilia-Romagna, Italy")).toBe("ok");
  });

  it("now CATCHES a wrong resolution under an endonym that used to pass", () => {
    // These are the cases the English-only map waved through: the recorded place
    // names a country, the standard place is on another continent, and the
    // verdict was "unverifiable" purely because the country was not in English.
    expect(countryConsistency("Bayern, Deutschland", "Bavaria, Minnesota, United States")).toBe("contradiction");
    expect(countryConsistency("Manger, Hordaland, Norge", "Manger, Bavaria, Germany")).toBe("contradiction");
  });

  it("still declines to judge a place that names no country at all", () => {
    // The bulk of "unverifiable" is this, not language: a trailing US state or
    // English county names no country, so there is nothing to compare.
    expect(countryConsistency("Schuylkill County, Pennsylvania", "Schuylkill, Pennsylvania, United States")).toBe("unverifiable");
    expect(countryConsistency("Sheffield, Staffordshire", "Sheffield, Staffordshire, England")).toBe("unverifiable");
  });

  it("declines to judge when the STANDARD place names no country it recognises", () => {
    // The endonyms lit up the recorded side and exposed an asymmetry on the
    // standard side: "…, Rakousko" (Czech for Austria) is now readable, and a
    // Bohemian or Moravian place standardises to "…, Bohemia" / "…, Moravia",
    // which the alias table does not carry. Falling through to "contradiction"
    // reported "plainly lacks" when it meant "cannot read", and research_append
    // rejects the ENTIRE append on a contradiction. These four resolutions are
    // correct — "Křičeň, Bezirk Pardubitz, Bohemia" scores 100 live.
    expect(countryConsistency("Křičeň, Pardubice, Čechy, Rakousko", "Křičeň, Bezirk Pardubitz, Bohemia")).toBe("unverifiable");
    expect(countryConsistency("Bystré 30, Polička, Čechy, Rakousko", "Bistrau, Polička, Bohemia")).toBe("unverifiable");
    expect(countryConsistency("Stašov, Polička, Čechy, Rakousko", "Dittersbach, Polička, Bohemia")).toBe("unverifiable");
    expect(countryConsistency("Svitavy, Moravská Třebová, Morava, Rakousko", "Svitavy, Moravská Třebová, Moravia, Czechoslovakia")).toBe("unverifiable");
  });

  it("keeps catching garbage that hides BEHIND a historical polity", () => {
    // The rail on the fix above. An earlier attempt returned early whenever any
    // standard segment named a polity, which reads these as unjudgeable too —
    // and they are exactly what the guard exists for. Both strings are real, in
    // eval/tests/e2e/anna-findejsova-daughter/starting-tree.gedcomx.json: the
    // polity is genuine and the garbage is appended AFTER it.
    expect(countryConsistency(
      "Svitavy, Moravská Třebová, Morava, Rakousko",
      "Zwittau, Mährisch Trübau, Moravia, Changgŭm-ni, SHIN-WON-GUN, South Hwanghae, North Korea",
    )).toBe("contradiction");
    expect(countryConsistency(
      "Křičeň, Pardubice, Čechy, Rakousko",
      "Křičeň, Bezirk Pardubitz, Bohemia, Manchester, Lancashire, England, United Kingdom",
    )).toBe("contradiction");
  });

  it("keeps the ok verdicts a polity-blind fix would have inverted", () => {
    // Six corpus pairs the guard already gets right, because the standard side
    // names BOTH the polity and a country the table carries. Nothing else
    // covers them, so a regression here would ship green.
    expect(countryConsistency("Bystré 41, Polička, Čechy, Rakousko", "Bistrau, Polička, Bohemia, Austria")).toBe("ok");
    expect(countryConsistency("Svitavy, Moravská Třebová, Morava, Rakousko", "Zwittau, Mährisch Trübau, Moravia, Austria")).toBe("ok");
    expect(countryConsistency(", Pommerania, Preussen, Germany", "Pomerania, Prussia, Germany")).toBe("ok");
    expect(countryConsistency("Höchst, Hessen-Nassau, Preußen, Deutschland", "Höchst, Hesse-Nassau, Prussia, Germany")).toBe("ok");
    expect(countryConsistency("Sindlingen, Kreis Höchst, Hessen-Nassau, Preußen, Deutschland", "Sindlingen, Höchst, Hesse-Nassau, Prussia, Germany")).toBe("ok");
    expect(countryConsistency("Prussia, Germany", "Prussia, Germany")).toBe("ok");
  });

  it("reads both spellings of Preußen, since ß survives the diacritic fold", () => {
    // NFD decomposes "ö" into "o" + combining diaeresis, so the fold strips it;
    // it does NOT decompose "ß", so "Preußen" folds to "preußen" and misses an
    // ASCII-only key. Both spellings are in the corpus. The pair below is
    // synthetic on purpose: in every corpus string the Prussian segment is
    // followed by "Deutschland"/"Germany", and the guard reads only the
    // trailing segment, so no corpus case reaches this key at all.
    expect(countryConsistency("Posen, Preußen", "Poznan, Bavaria, Germany")).toBe("ok");
    expect(countryConsistency("Posen, Preussen", "Poznan, Bavaria, Germany")).toBe("ok");
  });

  it("declares a contradiction against a country carried only for that purpose", () => {
    // cameroon / north korea are in COUNTRY_ALIASES for no other reason than
    // this: the guard cannot contradict a country it cannot read, and these are
    // where the corpus's mis-resolutions actually land. Deleting either
    // silently disarms the catch, which is why both are asserted here.
    expect(countryConsistency("West Bromwich, England", "Bamenda, Mezam, Northwest Region, Cameroon")).toBe("contradiction");
    expect(countryConsistency("Bayern, Deutschland", "Changgŭm-ni, South Hwanghae, North Korea")).toBe("contradiction");
  });
});

describe("resolveStandardPlace — FamilySearch year bounds", () => {
  // FamilySearch accepts +date: 1000..9999 and 400s outside it. A 400 throws
  // inside searchPlace, burns all three withRetry attempts, and returns null
  // UNCACHED, so every later call for that place burns them again. The
  // empty-result fallback does not catch a throw, so the year is dropped before
  // it is ever sent. Reachable through earliestYear's own fudge offsets.
  it.each([
    ["abt 1000", "a year below the floor (1000 - 1 for `abt`)"],
    ["44 BC", "a negative year"],
    ["est 1005", "an estimate that lands below the floor (-10)"],
  ])("drops %s — %s", async (date) => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "x", fullName: "Rome, Lazio, Italy", score: 90 }),
    ]);
    await resolveStandardPlace("Rome, Italy", { date });
    expect(mockSearchPlace).toHaveBeenCalledWith("Rome, Italy", { date: undefined });
  });

  it("still sends a year inside the accepted range", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "x", fullName: "Rome, Lazio, Italy", score: 90 }),
    ]);
    await resolveStandardPlace("Rome, Italy", { date: "1010" });
    expect(mockSearchPlace).toHaveBeenCalledWith("Rome, Italy", { date: 1010 });
  });
});


// ── A bare single-segment place (the lead, 2026-10-26 and 2026-10-29) ──
// The bundled one-word list answers, else a sibling place that spells the name
// out, else FamilySearch's best hit only when no other place ties it and it lies
// in the record's country, else nothing. "Shenandoah" beside "Borough of
// Shenandoah, County of Schuylkill" in one will resolved to New Zealand on PR
// #3007's trials, "Logan LDS Temple" to France.
describe("resolveStandardPlace — a bare single-segment name", () => {
  const byName = (table: Record<string, Entry[]>) =>
    mockSearchPlace.mockImplementation(async (name: string) => table[name] ?? []);

  it("answers a listed name from the bundled list without searching", async () => {
    byName({
      Kent: [entry({ placeRepId: "ct", fullName: "Kent, Litchfield, Connecticut, United States", type: "Town", score: 1 })],
      Gloucestershire: [entry({ placeRepId: "gl", fullName: "Gloucestershire, England, United Kingdom", type: "County", score: 1 })],
    });
    expect(await resolveStandardPlace("Kent")).toBe("Kent, England, United Kingdom");
    expect(await resolveStandardPlace("Gloucestershire")).toBe("Gloucestershire, England, United Kingdom");
    expect(await resolveStandardPlace("Ky")).toBe("Kentucky, United States");
    expect(await resolveStandardPlace("Ireland")).toBe("Ireland");
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("looks the name up as the list folds it: case, accents, periods, spacing and a stray comma", async () => {
    expect(await resolveStandardPlace("CO. CLARE")).toBe("County Clare, Ireland");
    expect(await resolveStandardPlace("  republic   of georgia ")).toBe("Republic of Georgia");
    expect(await resolveStandardPlace("Québec")).toBe("Quebec, Canada");
    expect(await resolveStandardPlace("Wexford,")).toBe("County Wexford, Ireland");
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("leaves an unlisted name unresolved without searching when the record's country is unknown", async () => {
    // The 2026-10-06 rule kept a best hit FamilySearch typed a jurisdiction: the
    // county for "Clare", which the list leaves out because parishes of that name
    // lie in other Irish counties, and the country Albania for "Alb", where the
    // records meant Alberta.
    byName({
      Clare: [entry({ placeRepId: "c", placeId: "c", fullName: "County Clare, Ireland", type: "County", score: 1 })],
      Alb: [entry({ placeRepId: "al", placeId: "al", fullName: "Albania", type: "Country", score: 1 })],
      Shenandoah: [entry({ placeRepId: "nz", placeId: "nz", fullName: "Shenandoah, Westland, New Zealand", score: 0.95 })],
    });
    expect(await resolveStandardPlace("Clare")).toBeNull();
    expect(await resolveStandardPlace("Alb")).toBeNull();
    expect(await resolveStandardPlace("Shenandoah")).toBeNull();
    expect(await resolveStandardPlace("Clare", { recordCountry: async () => null })).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("applies an entry for one record country only with that record country, and asks for it only then", async () => {
    // "Texas" is listed for US records only. In a Mexican record the top hit,
    // the US state, lies outside the record's country.
    byName({ Texas: [entry({ placeRepId: "tx", placeId: "tx", fullName: "Texas, United States", type: "State", score: 1 })] });
    const us = vi.fn(async () => "United States");
    expect(await resolveStandardPlace("Texas", { recordCountry: us })).toBe("Texas, United States");
    expect(await resolveStandardPlace("Kent", { recordCountry: us })).toBe("Kent, England, United Kingdom");
    expect(us).toHaveBeenCalledTimes(1);
    expect(mockSearchPlace).not.toHaveBeenCalled();
    expect(await resolveStandardPlace("Texas", { recordCountry: async () => null })).toBeNull();
    expect(await resolveStandardPlace("Texas")).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
    expect(await resolveStandardPlace("Texas", { recordCountry: async () => "Mexico" })).toBeNull();
  });

  it("withholds an entry in a record country it is excepted in, and when the record's country is unknown", async () => {
    // Bare "Louth" in a British record is the Lincolnshire town, which the top
    // hit gives when no other place ties it.
    byName({
      Louth: [
        entry({ placeRepId: "li", placeId: "li", fullName: "Louth, Lincolnshire, England, United Kingdom", score: 1 }),
        entry({ placeRepId: "ie", placeId: "ie", fullName: "County Louth, Ireland", type: "County", score: 0.9 }),
      ],
    });
    expect(await resolveStandardPlace("Louth", { recordCountry: async () => "United States" })).toBe(
      "County Louth, Ireland",
    );
    expect(await resolveStandardPlace("Louth")).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
    expect(await resolveStandardPlace("Louth", { recordCountry: async () => "United Kingdom" })).toBe(
      "Louth, Lincolnshire, England, United Kingdom",
    );
  });

  it("takes FamilySearch's best hit when no other place ties it and it lies in the record's country", async () => {
    // Two representations of one place at the top score are one place.
    byName({
      Shenandoah: [
        entry({ placeRepId: "va1", placeId: "va", fullName: "Shenandoah, Page, Virginia, United States", score: 0.9 }),
        entry({ placeRepId: "va2", placeId: "va", fullName: "Shenandoah, Virginia, United States", score: 0.9 }),
        entry({ placeRepId: "nz", placeId: "nz", fullName: "Shenandoah, Westland, New Zealand", score: 0.8 }),
      ],
    });
    expect(await resolveStandardPlace("Shenandoah", { recordCountry: async () => "United States" })).toBe(
      "Shenandoah, Page, Virginia, United States",
    );
    expect(mockSearchPlace).toHaveBeenCalledWith("Shenandoah", { date: undefined });
  });

  it("leaves the name unresolved when another place ties FamilySearch's best hit", async () => {
    byName({
      Shenandoah: [
        entry({ placeRepId: "va", placeId: "va", fullName: "Shenandoah, Page, Virginia, United States", score: 0.9 }),
        entry({ placeRepId: "ia", placeId: "ia", fullName: "Shenandoah, Page, Iowa, United States", score: 0.9 }),
      ],
    });
    expect(await resolveStandardPlace("Shenandoah", { recordCountry: async () => "United States" })).toBeNull();
  });

  it("leaves the name unresolved when the best hit's last segment is not the record's country", async () => {
    byName({
      Shenandoah: [
        entry({ placeRepId: "nz", placeId: "nz", fullName: "Shenandoah, Westland, New Zealand", score: 0.95 }),
        entry({ placeRepId: "va", placeId: "va", fullName: "Shenandoah, Page, Virginia, United States", score: 0.9 }),
      ],
      Ballymena: [
        entry({ placeRepId: "bm", placeId: "bm", fullName: "Ballymena, Antrim, Northern Ireland, United Kingdom", score: 1 }),
      ],
    });
    expect(await resolveStandardPlace("Shenandoah", { recordCountry: async () => "United States" })).toBeNull();
    expect(await resolveStandardPlace("Ballymena", { recordCountry: async () => "Ireland" })).toBeNull();
    expect(await resolveStandardPlace("Ballymena", { recordCountry: async () => "United Kingdom" })).toBe(
      "Ballymena, Antrim, Northern Ireland, United Kingdom",
    );
  });

  it("does not take a Luxembourg record's top hit in Belgium's province of Luxembourg", async () => {
    byName({ Arlon: [entry({ placeRepId: "ar", placeId: "ar", fullName: "Arlon, Luxembourg, Belgium", score: 1 })] });
    expect(await resolveStandardPlace("Arlon", { recordCountry: async () => "Luxembourg" })).toBeNull();
    expect(await resolveStandardPlace("Arlon", { recordCountry: async () => "Belgium" })).toBe("Arlon, Luxembourg, Belgium");
  });

  it("does not take a record from the country Georgia's top hit in the US state", async () => {
    // FamilySearch names the country Republic of Georgia.
    byName({ Macon: [entry({ placeRepId: "ma", placeId: "ma", fullName: "Macon, Bibb, Georgia, United States", score: 1 })] });
    expect(await resolveStandardPlace("Macon", { recordCountry: async () => "Republic of Georgia" })).toBeNull();
    expect(await resolveStandardPlace("Macon", { recordCountry: async () => "United States" })).toBe(
      "Macon, Bibb, Georgia, United States",
    );
  });

  it("counts a top-scored hit with no place id as a place of its own", async () => {
    byName({
      Shenandoah: [
        entry({ placeRepId: "va", fullName: "Shenandoah, Page, Virginia, United States", score: 0.9 }),
        entry({ placeRepId: "ia", fullName: "Shenandoah, Page, Iowa, United States", score: 0.9 }),
      ],
      Ballymena: [entry({ placeRepId: "bm", fullName: "Ballymena, Antrim, Northern Ireland, United Kingdom", score: 1 })],
    });
    expect(await resolveStandardPlace("Shenandoah", { recordCountry: async () => "United States" })).toBeNull();
    expect(await resolveStandardPlace("Ballymena", { recordCountry: async () => "United Kingdom" })).toBe(
      "Ballymena, Antrim, Northern Ireland, United Kingdom",
    );
  });

  it("answers from a sibling that spells the name out before the top hit", async () => {
    byName({
      Shenandoah: [entry({ placeRepId: "va", placeId: "va", fullName: "Shenandoah, Page, Virginia, United States", score: 1 })],
      "Borough of Shenandoah, County of Schuylkill": [
        entry({ placeRepId: "pa", placeId: "pa", fullName: "Shenandoah, Schuylkill, Pennsylvania, United States", score: 0.9 }),
      ],
    });
    expect(
      await resolveStandardPlace("Shenandoah", {
        contextPlaces: ["Borough of Shenandoah, County of Schuylkill"],
        recordCountry: async () => "United States",
      }),
    ).toBe("Shenandoah, Schuylkill, Pennsylvania, United States");
  });

  it("takes the top hit when a sibling spells the name out but resolves to nothing, and searches the bare name", async () => {
    byName({
      Shenandoah: [entry({ placeRepId: "pa", placeId: "pa", fullName: "Shenandoah, Schuylkill, Pennsylvania, United States", score: 1 })],
    });
    const us = vi.fn(async () => "United States");
    expect(
      await resolveStandardPlace("Shenandoah,", { contextPlaces: ["Borough of Shenandoah, County of Schuylkill"], recordCountry: us }),
    ).toBe("Shenandoah, Schuylkill, Pennsylvania, United States");
    expect(mockSearchPlace).toHaveBeenCalledWith("Borough of Shenandoah, County of Schuylkill", { date: undefined });
    expect(mockSearchPlace).toHaveBeenCalledWith("Shenandoah", { date: undefined });
    expect(us).toHaveBeenCalledTimes(1);
  });

  it("asks for the record's country once when the list and the top hit both need it", async () => {
    byName({ Texas: [entry({ placeRepId: "mx", placeId: "mx", fullName: "Texas, Hidalgo, Mexico", score: 1 })] });
    const mexico = vi.fn(async () => "Mexico");
    expect(await resolveStandardPlace("Texas", { recordCountry: mexico })).toBe("Texas, Hidalgo, Mexico");
    expect(mexico).toHaveBeenCalledTimes(1);
  });

  it("tries the sibling route when the record's country rules a listed entry out", async () => {
    byName({ "Texas, Hidalgo": [entry({ placeRepId: "mx", fullName: "Texas, Hidalgo, Mexico", score: 1 })] });
    expect(
      await resolveStandardPlace("Texas", { contextPlaces: ["Texas, Hidalgo"], recordCountry: async () => "Mexico" }),
    ).toBe("Texas, Hidalgo, Mexico");
  });

  it("answers an accent-exact entry only as written: 'Ísland' is Iceland, 'Island' is not a place", async () => {
    // Not by the top hit, and not by a sibling either: the English word is never standardized.
    byName({
      Island: [entry({ placeRepId: "is", placeId: "is", fullName: "Iceland", type: "Country", score: 1 })],
      Suede: [entry({ placeRepId: "se", placeId: "se", fullName: "Sweden", type: "Country", score: 1 })],
      "Island, McLean, Kentucky": [
        entry({ placeRepId: "ky", placeId: "ky", fullName: "Island, McLean, Kentucky, United States", score: 1 }),
      ],
    });
    expect(await resolveStandardPlace("Ísland")).toBe("Iceland");
    expect(await resolveStandardPlace("Island", { recordCountry: async () => "Iceland" })).toBeNull();
    expect(await resolveStandardPlace("Suede", { recordCountry: async () => "Sweden" })).toBeNull();
    expect(
      await resolveStandardPlace("Island", {
        contextPlaces: ["Island, McLean, Kentucky"],
        recordCountry: async () => "United States",
      }),
    ).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("answers from the list before a sibling that starts with the name", async () => {
    // A census writes its place largest-first: the sibling names a county inside
    // the state, not the state.
    byName({ "New Jersey, Hudson": [entry({ placeRepId: "h", fullName: "Hudson, New Jersey, United States", score: 1 })] });
    expect(await resolveStandardPlace("New Jersey", { contextPlaces: ["New Jersey, Hudson"] }))
      .toBe("New Jersey, United States");
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("resolves the sibling place that spells it out instead", async () => {
    byName({
      Shenandoah: [entry({ placeRepId: "nz", fullName: "Shenandoah, Westland, New Zealand", score: 0.95 })],
      "Borough of Shenandoah, County of Schuylkill": [
        entry({ placeRepId: "pa", fullName: "Shenandoah, Schuylkill, Pennsylvania, United States", score: 0.9 }),
      ],
    });
    expect(
      await resolveStandardPlace("Shenandoah", {
        contextPlaces: ["Borough of Shenandoah, County of Schuylkill", "Mahanoy City, Schuylkill"],
      }),
    ).toBe("Shenandoah, Schuylkill, Pennsylvania, United States");
  });

  it("finds the sibling for a name written with a stray comma", async () => {
    byName({
      "Borough of Shenandoah, County of Schuylkill": [
        entry({ placeRepId: "pa", fullName: "Shenandoah, Schuylkill, Pennsylvania, United States", score: 0.9 }),
      ],
    });
    for (const text of ["Shenandoah,", ", Shenandoah", "Shenandoah ,"]) {
      expect(
        await resolveStandardPlace(text, { contextPlaces: ["Borough of Shenandoah, County of Schuylkill"] }),
        text,
      ).toBe("Shenandoah, Schuylkill, Pennsylvania, United States");
    }
  });

  it("does not take a sibling whose first segment merely contains the name", async () => {
    byName({ "Loganville, Walton, Georgia": [
      entry({ placeRepId: "x", fullName: "Loganville, Walton, Georgia, United States", score: 0.9 }),
    ] });
    expect(await resolveStandardPlace("Logan", { contextPlaces: ["Loganville, Walton, Georgia"] })).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("does not take 'New York' as the fuller form of 'York'", async () => {
    byName({
      "New York, New York, United States": [
        entry({ placeRepId: "ny", fullName: "New York, New York, United States", score: 1 }),
      ],
    });
    expect(
      await resolveStandardPlace("York", { contextPlaces: ["New York, New York, United States"] }),
    ).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("keeps a listed country as itself beside a same-named place in the record's area", async () => {
    byName({ Germany: [
      entry({ placeRepId: "gt", fullName: "Germany Township, Adams, Pennsylvania, United States", score: 1 }),
    ] });
    expect(await resolveStandardPlace("Germany", { contextPlaces: ["Gettysburg, Adams, Pennsylvania"] })).toBe("Germany");
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("no longer searches inside the jurisdiction the siblings share", async () => {
    byName({ "Logan LDS Temple": [
      entry({ placeRepId: "ut", fullName: "Logan Utah Temple, Logan, Cache, Utah, United States", type: "Temple", score: 1 }),
    ] });
    expect(
      await resolveStandardPlace("Logan LDS Temple", {
        contextPlaces: ["Logan, Cache, Utah", "Providence, Cache, Utah"],
      }),
    ).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("leaves a multi-segment place on the existing path", async () => {
    byName({ "Shenandoah, Westland": [
      entry({ placeRepId: "nz", fullName: "Shenandoah, Westland, New Zealand", score: 0.9 }),
    ] });
    expect(await resolveStandardPlace("Shenandoah, Westland")).toBe("Shenandoah, Westland, New Zealand");
  });
});

describe("__usePlaceTableForTests (the eval harness's offline resolver)", () => {
  afterEach(() => {
    __usePlaceTableForTests(null);
    __clearPlaceResolverCachesForTests();
  });

  it("answers from the table, normalized, and never searches", async () => {
    mockSearchPlace.mockClear();
    __usePlaceTableForTests({ "Boston, Massachusetts": "Boston, Suffolk, Massachusetts, United States" });
    expect(await resolveStandardPlace("  boston,   MASSACHUSETTS ")).toBe("Boston, Suffolk, Massachusetts, United States");
    expect(await resolveStandardPlace("Ballyowen")).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("searches again once the table is removed", async () => {
    __usePlaceTableForTests({});
    __usePlaceTableForTests(null);
    mockSearchPlace.mockClear();
    mockSearchPlace.mockResolvedValue([]);
    await resolveStandardPlace("Boston, Massachusetts");
    expect(mockSearchPlace).toHaveBeenCalled();
  });
});

describe("familySearchPlace: a supplied standard_place as FamilySearch's own", () => {
  it("is the entry's full name when it is the value, case and accents aside, with its place, and searches once", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Parácuaro, Michoacán, Mexico", type: "Municipality" }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Parácuaro, Guanajuato, Mexico" }),
    ]);
    const parácuaro = {
      fullName: "Parácuaro, Michoacán, Mexico",
      places: [{ placeId: "P1", placeRepId: "1", type: "Municipality" }],
    };
    expect(await familySearchPlace("paracuaro, michoacan, MEXICO")).toEqual(parácuaro);
    expect(await familySearchPlace("Parácuaro, Michoacán, Mexico")).toEqual(parácuaro);
    expect(mockSearchPlace).toHaveBeenCalledTimes(1);
    expect(mockSearchPlace).toHaveBeenCalledWith("paracuaro, michoacan, MEXICO");
  });

  it("is the value as written when FamilySearch spells it so, though another entry folds to it too", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "P1", fullName: "Santo Antonio, Funchal, Madeira, Portugal" }),
      entry({ placeRepId: "2", placeId: "P2", fullName: "Santo António, Funchal, Madeira, Portugal" }),
    ]);
    expect(await familySearchPlace("Santo António, Funchal, Madeira, Portugal")).toMatchObject({
      fullName: "Santo António, Funchal, Madeira, Portugal",
      places: [{ placeId: "P2" }],
    });
    expect(await familySearchPlace("santo antónio, funchal, madeira, portugal")).toMatchObject({
      fullName: "Santo Antonio, Funchal, Madeira, Portugal",
      places: [{ placeId: "P1" }],
    });
  });

  it("is false when no entry's full name is the value, though the search finds its places", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", fullName: "Union Station, Licking, Ohio, United States" }),
      entry({ placeRepId: "2", fullName: "Union Township, Licking, Ohio, United States" }),
    ]);
    expect(await familySearchPlace("Union Station, Union Township, Licking, Ohio, United States")).toBe(false);
  });

  it("is null when the search fails, and a failure is not remembered", async () => {
    mockSearchPlace.mockRejectedValueOnce(new Error("FamilySearch API error: 503"));
    expect(await familySearchPlace("Kent, England, United Kingdom")).toBeNull();
    mockSearchPlace.mockResolvedValueOnce([entry({ placeRepId: "1", placeId: "P1", fullName: "Kent, England, United Kingdom" })]);
    expect(await familySearchPlace("Kent, England, United Kingdom")).toMatchObject({ fullName: "Kent, England, United Kingdom" });
  });
});

// The places' own answers, as the Places API gave them on 2026-10-29
// (Accept-Language: en): each search entry whose full name is the value, and
// each place's listing, every representation with its names.
describe("textNamesPlace: some part of the fact's place text names a supplied standard place", () => {
  const ANSWERS: Record<string, { entries: Entry[]; listings: Record<string, string[][]> }> = {
    "Santo António, Funchal, Madeira, Portugal": {
      entries: [entry({ placeRepId: "1542672", placeId: "3668064", fullName: "Santo António, Funchal, Madeira, Portugal", type: "Parish" })],
      listings: { "3668064": [["Santo António"]] },
    },
    "Hawaii, United States": {
      entries: [entry({ placeRepId: "328", placeId: "12", fullName: "Hawaii, United States", type: "State" })],
      listings: { "12": [["Hawaii", "Havaí", "Hawái", "Hawaï", "Гавайи"], ["Kingdom of Hawaii", "Aupuni Mōʻī o Hawaiʻi"]] },
    },
    "Springfield, Sangamon, Illinois, United States": {
      entries: [entry({ placeRepId: "4033952", placeId: "380949", fullName: "Springfield, Sangamon, Illinois, United States", type: "City" })],
      listings: { "380949": [["Springfield"]] },
    },
    "District Township, Berks, Pennsylvania, United States": {
      entries: [entry({ placeRepId: "4839935", placeId: "1121325", fullName: "District Township, Berks, Pennsylvania, United States", type: "Township" })],
      listings: { "1121325": [["District Township"], ["District Township"]] },
    },
    "Laakirchen, Gmunden, Upper Austria, Austria": {
      entries: [entry({ placeRepId: "8090930", placeId: "6353624", fullName: "Laakirchen, Gmunden, Upper Austria, Austria", type: "Town" })],
      listings: { "6353624": [["Laakirchen"]] },
    },
    // One full name, three places: a registration district, a town and a poor law union.
    "West Bromwich, Staffordshire, England, United Kingdom": {
      entries: [
        entry({ placeRepId: "3041526", placeId: "6256198", fullName: "West Bromwich, Staffordshire, England, United Kingdom", type: "Civil Registration District" }),
        entry({ placeRepId: "2965476", placeId: "6145561", fullName: "West Bromwich, Staffordshire, England, United Kingdom", type: "Town" }),
        entry({ placeRepId: "3040286", placeId: "6257130", fullName: "West Bromwich, Staffordshire, England, United Kingdom", type: "Poor Law Union" }),
      ],
      listings: { "6256198": [["West Bromwich"]], "6145561": [["West Bromwich"], ["West Bromwich"], ["West Bromwich"]], "6257130": [["West Bromwich"]] },
    },
  };
  beforeEach(() => {
    mockSearchPlace.mockImplementation(async (name: string) => ANSWERS[name]?.entries ?? []);
    mockGetPlaceReps.mockImplementation(async (placeId: string) => {
      const listing = Object.values(ANSWERS).find((a) => a.listings[placeId])?.listings[placeId] ?? [];
      return listing.map((names, i) => ({ placeRepId: `${placeId}-${i}`, names }));
    });
  });
  const names = async (standard: string, text: string) => textNamesPlace((await familySearchPlace(standard)) as never, text);

  it.each([
    ["Santo Antonio, Funchal", "Santo António, Funchal, Madeira, Portugal"],
    ["Honolulu, Hawaii", "Hawaii, United States"],
    ["Havaí", "Hawaii, United States"],
    ["Springfield, Sangamon County, Illinois", "Springfield, Sangamon, Illinois, United States"],
    ["District Township, Berks County, Pennsylvania", "District Township, Berks, Pennsylvania, United States"],
    // A town is named by the text's first part only: a later part names a jurisdiction.
    ["Laakirchen, Gmunden, Oberösterreich", "Laakirchen, Gmunden, Upper Austria, Austria"],
    // The town is not named by a later part, but the registration district of that name is.
    ["St John's Church, West Bromwich, Staffordshire, England", "West Bromwich, Staffordshire, England, United Kingdom"],
  ])("%j names %j", async (text, standard) => {
    expect(await names(standard, text)).toBe(true);
  });

  it.each([
    ["with his daughter", "Hawaii, United States"],
    ["Boston, Suffolk, Massachusetts, United States", "Springfield, Sangamon, Illinois, United States"],
    ["District 1065, Spalding, Georgia", "District Township, Berks, Pennsylvania, United States"],
    ["Stötten (Nötten), Laakirchen, Gmunden, Upper Austria, Austria", "Laakirchen, Gmunden, Upper Austria, Austria"],
  ])("%j does not name %j", async (text, standard) => {
    expect(await names(standard, text)).toBe(false);
  });

  it("is true when any place of the full name is named, whichever the search gives first", async () => {
    const [district, town] = ANSWERS["West Bromwich, Staffordshire, England, United Kingdom"].entries;
    mockSearchPlace.mockResolvedValue([town, district]);
    expect(await names("West Bromwich, Staffordshire, England, United Kingdom", "St John's Church, West Bromwich, Staffordshire")).toBe(true);
    mockSearchPlace.mockResolvedValue([town]);
    __clearPlaceResolverCachesForTests();
    expect(await names("West Bromwich, Staffordshire, England, United Kingdom", "St John's Church, West Bromwich, Staffordshire")).toBe(false);
  });

  it("is null when no place's listing can be read, and reads each listing once", async () => {
    mockGetPlaceReps.mockRejectedValue(new Error("FamilySearch API error: 503"));
    expect(await names("Hawaii, United States", "with his daughter")).toBeNull();
    expect(await textNamesPlace({ fullName: "Nowhere", places: [{}] }, "Nowhere")).toBeNull();
    mockGetPlaceReps.mockReset();
    mockGetPlaceReps.mockResolvedValue([{ placeRepId: "328", names: ["Hawaii"] }]);
    expect(await names("Hawaii, United States", "Hawaii")).toBe(true);
    expect(await names("Hawaii, United States", "Honolulu, Hawaii")).toBe(true);
    expect(mockGetPlaceReps).toHaveBeenCalledTimes(1);
  });
});

describe("samePlace: two standard places name one FamilySearch place", () => {
  it("is true when both names are one place id, each read as place_distance reads it, however spelled", async () => {
    mockSearchPlace.mockImplementation(async (name: string) =>
      name === "Canterbury, Kent, England"
        ? [
            entry({ placeRepId: "9", placeId: "P2", fullName: "Canterbury, New Zealand", score: 0.2 }),
            entry({ placeRepId: "1", placeId: "P1", fullName: "Canterbury, Kent, England, United Kingdom", score: 0.9 }),
          ]
        : [
            entry({ placeRepId: "8", placeId: "P3", fullName: "Canterbury, Kent, New Brunswick, Canada", score: 0.95 }),
            entry({ placeRepId: "1", placeId: "P1", fullName: "Canterbury, Kent, England, United Kingdom", score: 0.9 }),
          ],
    );
    expect(await samePlace("Canterbury, Kent, England", "Canterbury, Kent, England, United Kingdom")).toBe(true);
  });

  it("is false for two places, and when either search finds nothing or fails", async () => {
    mockSearchPlace.mockImplementation(async (name: string) => {
      if (name.startsWith("Fails")) throw new Error("FamilySearch API error: 503");
      if (name.startsWith("Nothing")) return [];
      return [entry({ placeRepId: name, placeId: name.startsWith("Ireland") ? "IE" : "MAYO", fullName: name, score: 1 })];
    });
    expect(await samePlace("Ireland", "Mayo, Ireland")).toBe(false);
    expect(await samePlace("Nothing, Here", "Nothing, There")).toBe(false);
    expect(await samePlace("Fails, Here", "Fails, There")).toBe(false);
  });
});

describe("checkFirstPlace (#3696)", () => {
  /** Names in English, plus the extra ones only an all-language read returns. */
  function names(english: string[], otherLanguages: string[] = []) {
    mockGetPlaceCandidateNames.mockImplementation(async (_id, _opts, flags = {}) =>
      flags.anyLanguage ? [...english, ...otherLanguages] : english,
    );
  }

  it("refuses the village it drops: Helvesieck resolves to its parent, Schneverdingen", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Schneverdingen, Soltau, Hanover, Prussia, Germany", score: 90 }),
    ]);
    names([], ["Schneverdingen", "Schnewerdingen"]);
    expect(await checkFirstPlace("Helvesieck, Schneverdingen, Soltau, Hanover")).toEqual({
      status: "mismatch",
      standardPlace: "Schneverdingen, Soltau, Hanover, Prussia, Germany",
    });
  });

  it("refuses a first place the search answers with the country alone", async () => {
    mockSearchPlace.mockResolvedValue([entry({ placeRepId: "r1", placeId: "p1", fullName: "Germany", score: 80 })]);
    names(["Germany"], ["Deutschland"]);
    expect((await checkFirstPlace("Sierkopas, Germany")).status).toBe("mismatch");
  });

  it("matches a name FamilySearch tags as non-English (Forfarshire is Angus)", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Angus, Scotland, United Kingdom", score: 90 }),
    ]);
    names(["Angus"], ["Forfarshire"]);
    expect((await checkFirstPlace("Forfarshire, Scotland")).status).toBe("match");
    expect(mockGetPlaceCandidateNames).toHaveBeenCalledWith("p1", {}, { anyLanguage: true });
  });

  it("matches through the resolved first segment when the English name list is empty", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Ringebu, Oppland, Norway", score: 90 }),
    ]);
    names([]);
    expect(await checkFirstPlace("Ringebu, Oppland, Norway")).toEqual({
      status: "match",
      standardPlace: "Ringebu, Oppland, Norway",
    });
    expect(mockGetPlaceCandidateNames).not.toHaveBeenCalled();
  });

  it("matches a county named with its suffix by ignoring the type word", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Schuylkill, Pennsylvania, United States", score: 90 }),
    ]);
    expect((await checkFirstPlace("Schuylkill County, Pennsylvania")).status).toBe("match");
    expect(mockGetPlaceCandidateNames).not.toHaveBeenCalled();
  });

  it("matches an English alias only the name list holds", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Livorno, Toscana, Italy", score: 90 }),
    ]);
    names(["Livorno", "Leghorn"]);
    expect((await checkFirstPlace("Leghorn, Toscana, Italy")).status).toBe("match");
    expect(mockGetPlaceCandidateNames).toHaveBeenCalledWith("p1", {}, { anyLanguage: true });
  });

  it("folds case, spacing and diacritics on both sides", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Parácuaro, Michoacán, Mexico", score: 90 }),
    ]);
    expect((await checkFirstPlace("  paracuaro , Michoacan, Mexico")).status).toBe("match");
  });

  it.each([
    ["St Louis, Missouri", "St. Louis, Missouri, United States"],
    ["Sondre Land, Oppland, Norway", "Søndre Land, Oppland, Norway"],
    ["Saint Jean, Quebec", "Saint-Jean, Bécancour, Quebec, Canada"],
    ["O'Brien, Ireland", "OBrien, Ireland"],
  ])("matches %s to %s through punctuation and undecomposed letters", async (text, fullName) => {
    mockSearchPlace.mockResolvedValue([entry({ placeRepId: "r1", placeId: "p1", fullName, score: 90 })]);
    expect((await checkFirstPlace(text)).status).toBe("match");
    expect(mockGetPlaceCandidateNames).not.toHaveBeenCalled();
  });

  /** Search answers keyed by the text searched, so a re-search can be told apart. */
  function searchByText(table: Record<string, Entry[]>) {
    mockSearchPlace.mockImplementation(async (name: string) => table[name] ?? []);
  }

  it("keeps segment 2 as a parent check: a real village under the wrong parish is refused", async () => {
    // Helvesiek is real but sits in Rotenburg; context "Schneverdingen" keeps only that parish.
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Helvesiek, Rotenburg, Hanover, Prussia, Germany", score: 95 }),
      entry({ placeRepId: "r2", placeId: "p2", fullName: "Schneverdingen, Soltau, Hanover, Prussia, Germany", score: 90 }),
    ]);
    names(["Schneverdingen"]);
    expect((await checkFirstPlace("Helvesiek, Schneverdingen, Hanover")).status).toBe("mismatch");
  });

  it("checks every entry tied for the top score, not only the first", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "pMM", fullName: "Mount Pleasant MM, Henry, Iowa, United States", score: 98 }),
      entry({ placeRepId: "r2", placeId: "pTown", fullName: "Mount Pleasant, Henry, Iowa, United States", score: 98 }),
    ]);
    expect((await checkFirstPlace("Mt. Pleasant, Iowa")).status).toBe("match");
  });

  it("does not match a lower-scored entry that is not tied", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Germany", score: 80 }),
      entry({ placeRepId: "r2", placeId: "p2", fullName: "Sierkopas, Lithuania", score: 40 }),
    ]);
    names(["Germany"]);
    expect((await checkFirstPlace("Sierkopas, Germany")).status).toBe("mismatch");
  });

  it.each([
    ["Stagstrup Sogn, Thisted Amt, Denmark", "Stagstrup, Thisted, Nordjylland, Denmark"],
    ["Co. Cork, Ireland", "Cork, Ireland"],
    ["Cork County, Ireland", "Cork, Ireland"],
    ["Landkreis Soltau, Hannover", "Soltau, Hanover, Prussia, Germany"],
    ["Parish of Ringsaker, Hedmark, Norway", "Ringsaker, Hedmark, Norway"],
  ])("ignores type words: %s matches %s", async (text, fullName) => {
    mockSearchPlace.mockResolvedValue([entry({ placeRepId: "r1", placeId: "p1", fullName, score: 90 })]);
    expect((await checkFirstPlace(text)).status).toBe("match");
  });

  it("searches again without the type word when the first search misses", async () => {
    searchByText({
      "Ringebu Parish, Oppland, Norway": [entry({ placeRepId: "r1", placeId: "p1", fullName: "Oppland, Norway", score: 90 })],
      "Ringebu, Oppland, Norway": [entry({ placeRepId: "r2", placeId: "p2", fullName: "Ringebu, Oppland, Norway", score: 95 })],
    });
    names(["Oppland"]);
    expect(await checkFirstPlace("Ringebu Parish, Oppland, Norway")).toEqual({
      status: "match",
      standardPlace: "Ringebu, Oppland, Norway",
    });
  });

  it("keeps the first verdict when the re-search also misses", async () => {
    searchByText({
      "Helvesieck Parish, Schneverdingen, Soltau": [
        entry({ placeRepId: "r1", placeId: "p1", fullName: "Schneverdingen, Soltau, Hanover, Prussia, Germany", score: 90 }),
      ],
      "Helvesieck, Schneverdingen, Soltau": [
        entry({ placeRepId: "r1", placeId: "p1", fullName: "Schneverdingen, Soltau, Hanover, Prussia, Germany", score: 90 }),
      ],
    });
    names([], ["Schneverdingen"]);
    expect((await checkFirstPlace("Helvesieck Parish, Schneverdingen, Soltau")).status).toBe("mismatch");
  });

  it("never strips a name down to nothing", async () => {
    // Stripped to nothing, "County" and the place name "Kreis" would both be "".
    mockSearchPlace.mockResolvedValue([entry({ placeRepId: "r1", placeId: "p1", fullName: "Germany", score: 80 })]);
    names(["Germany", "Kreis"]);
    expect((await checkFirstPlace("County, Germany")).status).toBe("mismatch");
  });

  it("ignores a type word on FamilySearch's side too", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Stagstrup Sogn, Thisted, Denmark", score: 90 }),
    ]);
    names([]);
    expect((await checkFirstPlace("Stagstrup, Thisted, Denmark")).status).toBe("match");
  });

  it("spells out Mt, St and Ft on both sides", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Mount Vernon, Westchester, New York, United States", score: 90 }),
    ]);
    expect((await checkFirstPlace("Mt. Vernon, Westchester, New York")).status).toBe("match");
  });

  it("is lookup_failed, not a refusal, when the re-search without the type word fails", async () => {
    mockSearchPlace.mockImplementation(async (name: string) => {
      if (name === "Helvesieck, Schneverdingen, Soltau") throw new Error("FamilySearch API error: 503");
      return [entry({ placeRepId: "r1", placeId: "p1", fullName: "Schneverdingen, Soltau, Hanover, Prussia, Germany", score: 90 })];
    });
    names([], ["Schneverdingen"]);
    expect((await checkFirstPlace("Helvesieck Parish, Schneverdingen, Soltau")).status).toBe("lookup_failed");
  });

  it("searches once per pass and fetches each place's names once", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Germany", score: 80 }),
    ]);
    names(["Germany"]);
    await checkFirstPlace("Sierkopas, Germany");
    expect(mockSearchPlace).toHaveBeenCalledTimes(1);
    expect(mockGetPlaceCandidateNames).toHaveBeenCalledTimes(1);
  });

  it("fetches at most five name lists, and writes with a warning when that leaves entries unchecked", async () => {
    mockSearchPlace.mockResolvedValue(
      Array.from({ length: 40 }, (_, n) =>
        entry({ placeRepId: `r${n}`, placeId: `p${n}`, fullName: `Place${n}, Springfield, Somewhere`, score: 90 }),
      ),
    );
    names(["Elsewhere"]);
    expect((await checkFirstPlace("Nowhereville, Springfield")).status).toBe("lookup_failed");
    expect(mockGetPlaceCandidateNames).toHaveBeenCalledTimes(5);
  });

  it("fetches a place's names once when two of its representations tie", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Germany", score: 80 }),
      entry({ placeRepId: "r2", placeId: "p1", fullName: "Germany, Deutsches Reich", score: 80 }),
    ]);
    names(["Germany"]);
    expect((await checkFirstPlace("Sierkopas, Germany")).status).toBe("mismatch");
    expect(mockGetPlaceCandidateNames).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Helvesiek, Schneverdingen Parish, Hanover"],
    ["Helvesiek, Kirchspiel Schneverdingen, Hanover"],
  ])("still checks the parent when segment 2 carries a type word: %s", async (text) => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Helvesiek, Rotenburg, Hanover, Prussia, Germany", score: 95 }),
      entry({ placeRepId: "r2", placeId: "p2", fullName: "Schneverdingen, Soltau, Hanover, Prussia, Germany", score: 90 }),
    ]);
    names(["Schneverdingen"]);
    expect((await checkFirstPlace(text)).status).toBe("mismatch");
  });

  it("searches the parents without their type words", async () => {
    // Live, "Schneverdingen Parish" in the query returns only the Rotenburg Helvesiek.
    searchByText({
      "Helvesiek, Schneverdingen Parish, Hanover": [
        entry({ placeRepId: "r1", placeId: "p1", fullName: "Helvesiek, Rotenburg, Hanover, Prussia, Germany", score: 86 }),
      ],
      "Helvesiek, Schneverdingen, Hanover": [
        entry({ placeRepId: "r1", placeId: "p1", fullName: "Helvesiek, Rotenburg, Hanover, Prussia, Germany", score: 88 }),
        entry({ placeRepId: "r2", placeId: "p2", fullName: "Schneverdingen, Soltau, Hanover, Prussia, Germany", score: 86 }),
      ],
    });
    names(["Schneverdingen"]);
    expect((await checkFirstPlace("Helvesiek, Schneverdingen Parish, Hanover")).status).toBe("mismatch");
  });

  it("keeps an \"X of\" parent whole: District of Columbia is not Columbia", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Washington, District of Columbia, United States", score: 90 }),
    ]);
    expect((await checkFirstPlace("Washington, District of Columbia, United States")).status).toBe("match");
    expect(mockSearchPlace).toHaveBeenCalledWith("Washington, District of Columbia, United States", expect.anything());
  });

  it("is lookup_failed when the best entry has no place id and its first segment misses", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", fullName: "Schneverdingen, Soltau, Hanover, Germany", score: 90 }),
      entry({ placeRepId: "r2", placeId: "p2", fullName: "Schneverdingen, Soltau, Hanover, Prussia, Germany", score: 90 }),
    ]);
    names([], ["Schneverdingen"]);
    expect((await checkFirstPlace("Helvesieck, Schneverdingen, Soltau, Hanover")).status).toBe("lookup_failed");
  });

  it("skips a tied entry with no place id rather than writing unchecked", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Schneverdingen, Soltau, Hanover, Prussia, Germany", score: 90 }),
      entry({ placeRepId: "r2", fullName: "Schneverdingen, Soltau, Hanover, Germany", score: 90 }),
    ]);
    names([], ["Schneverdingen"]);
    expect((await checkFirstPlace("Helvesieck, Schneverdingen, Soltau, Hanover")).status).toBe("mismatch");
  });

  it("matches dotted initials against the undotted name: Washington D.C. is Washington DC", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "Washington, District of Columbia, United States", score: 90 }),
    ]);
    names(["Washington", "Washington DC"]);
    expect((await checkFirstPlace("Washington D.C., United States")).status).toBe("match");
  });

  it.each([
    ["Co.Cork, Ireland", "Cork, Ireland"],
    ["Stagstrup-Sogn, Thisted, Denmark", "Stagstrup, Thisted, Nordjylland, Denmark"],
  ])("finds a type word joined by a period or hyphen: %s", async (text, fullName) => {
    mockSearchPlace.mockResolvedValue([entry({ placeRepId: "r1", placeId: "p1", fullName, score: 90 })]);
    names([]);
    expect((await checkFirstPlace(text)).status).toBe("match");
  });

  it("reads a period with no space after it as a word break", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "r1", placeId: "p1", fullName: "St. Louis, Missouri, United States", score: 90 }),
    ]);
    expect((await checkFirstPlace("St.Louis, Missouri")).status).toBe("match");
  });

  it("is not_found when the search returns nothing", async () => {
    mockSearchPlace.mockResolvedValue([]);
    expect(await checkFirstPlace("Nowhereville, Atlantis")).toEqual({ status: "not_found" });
  });

  it("is lookup_failed, never a miss, when the search throws", async () => {
    mockSearchPlace.mockRejectedValue(new Error("FamilySearch API error: 503"));
    expect(await checkFirstPlace("Helvesieck, Schneverdingen, Soltau, Hanover")).toEqual({ status: "lookup_failed" });
  });

  it("is lookup_failed when the name fetch throws", async () => {
    mockSearchPlace.mockResolvedValue([entry({ placeRepId: "r1", placeId: "p1", fullName: "Germany", score: 80 })]);
    mockGetPlaceCandidateNames.mockRejectedValue(new Error("FamilySearch API error: 500"));
    expect((await checkFirstPlace("Sierkopas, Germany")).status).toBe("lookup_failed");
  });

  it("is lookup_failed when the picked entry has no place id and the first segment misses", async () => {
    mockSearchPlace.mockResolvedValue([entry({ placeRepId: "r1", fullName: "Germany", score: 80 })]);
    expect((await checkFirstPlace("Sierkopas, Germany")).status).toBe("lookup_failed");
    expect(mockGetPlaceCandidateNames).not.toHaveBeenCalled();
  });

  it("ignores the test place table, which holds no ids, names or failures", async () => {
    __usePlaceTableForTests({ "Sierkopas, Germany": "Sierkopas, Germany" });
    try {
      mockSearchPlace.mockResolvedValue([entry({ placeRepId: "r1", placeId: "p1", fullName: "Germany", score: 80 })]);
      names(["Germany"]);
      expect((await checkFirstPlace("Sierkopas, Germany")).status).toBe("mismatch");
    } finally {
      __usePlaceTableForTests(null);
    }
  });
});
