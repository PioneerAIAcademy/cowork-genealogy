import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The resolver builds on the low-level FamilySearch places fetchers in
// utils/place-api.ts. Mock just those four so no network is touched.
vi.mock("../../src/utils/place-api.js", () => ({
  searchPlace: vi.fn(),
  getPlaceById: vi.fn(),
  getPlaceRepIds: vi.fn(),
  getPlaceCandidateNames: vi.fn(),
}));

import {
  searchPlace,
  getPlaceById,
  getPlaceRepIds,
  getPlaceCandidateNames,
} from "../../src/utils/place-api.js";
import {
  resolveStandardPlace,
  standardPlaceToRepId,
  standardPlaceToPlaceId,
  resolveStandardPlaceToPlaceId,
  repIdToStandardPlace,
  standardPlaceToCoords,
  placeIdToRepIds,
  withRetry,
  mapWithConcurrency,
  countryConsistency,
  countryOfPlace,
  deriveContextName,
  __clearPlaceResolverCachesForTests,
  __usePlaceTableForTests,
  isNonPlacePhrase,
  checkFirstPlace,
} from "../../src/utils/place-resolver.js";

const mockSearchPlace = vi.mocked(searchPlace);
const mockGetPlaceById = vi.mocked(getPlaceById);
const mockGetPlaceRepIds = vi.mocked(getPlaceRepIds);
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
  mockGetPlaceRepIds.mockReset();
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

  it("accepts a real place, including one that contains a phrase word", () => {
    for (const p of ["Same Place, Wayne, Ohio", "Same, Manufahi, Timor-Leste", "Homer", "Rural Retreat", "Dover", "Home, Clermont, Ohio"]) {
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
    mockGetPlaceRepIds.mockResolvedValue(["10", "20", "30"]);
    expect(await placeIdToRepIds("P")).toEqual(["10", "20", "30"]);
    expect(await placeIdToRepIds("P")).toEqual(["10", "20", "30"]);
    expect(mockGetPlaceRepIds).toHaveBeenCalledTimes(1);
  });

  it("returns [] on failure without caching", async () => {
    vi.useFakeTimers();
    mockGetPlaceRepIds.mockRejectedValue(new Error("boom"));
    const p = placeIdToRepIds("P");
    await vi.runAllTimersAsync();
    expect(await p).toEqual([]);

    mockGetPlaceRepIds.mockResolvedValueOnce(["1"]);
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
