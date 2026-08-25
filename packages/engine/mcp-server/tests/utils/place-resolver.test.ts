import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The resolver builds on the low-level FamilySearch places fetchers in
// utils/place-api.ts. Mock just those three so no network is touched.
vi.mock("../../src/utils/place-api.js", () => ({
  searchPlace: vi.fn(),
  getPlaceById: vi.fn(),
  getPlaceRepIds: vi.fn(),
}));

import {
  searchPlace,
  getPlaceById,
  getPlaceRepIds,
} from "../../src/utils/place-api.js";
import {
  resolveStandardPlace,
  standardPlaceToRepId,
  standardPlaceToPlaceId,
  repIdToStandardPlace,
  standardPlaceToCoords,
  placeIdToRepIds,
  withRetry,
  mapWithConcurrency,
  countryConsistency,
  deriveContextName,
  __clearPlaceResolverCachesForTests,
} from "../../src/utils/place-resolver.js";

const mockSearchPlace = vi.mocked(searchPlace);
const mockGetPlaceById = vi.mocked(getPlaceById);
const mockGetPlaceRepIds = vi.mocked(getPlaceRepIds);

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
  __clearPlaceResolverCachesForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveStandardPlace", () => {
  it("returns the best-scored candidate's fullName for free text", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", placeId: "p1", fullName: "Kentucky, United States", score: 0.4 }),
      entry({ placeRepId: "2", placeId: "p2", fullName: "Kent, England, United Kingdom", score: 0.9 }),
    ]);
    expect(await resolveStandardPlace("Ky")).toBe("Kent, England, United Kingdom");
  });

  it("caches a resolved value (second call does not re-search)", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "1", fullName: "Ohio, United States", score: 1 }),
    ]);
    expect(await resolveStandardPlace("Ohio")).toBe("Ohio, United States");
    expect(await resolveStandardPlace("ohio")).toBe("Ohio, United States"); // normalized key
    expect(mockSearchPlace).toHaveBeenCalledTimes(1);
  });

  it("negative-caches a definitive 0-candidate result", async () => {
    mockSearchPlace.mockResolvedValue([]);
    expect(await resolveStandardPlace("Mrs. John's farm")).toBeNull();
    expect(await resolveStandardPlace("Mrs. John's farm")).toBeNull();
    expect(mockSearchPlace).toHaveBeenCalledTimes(1);
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

    const first = resolveStandardPlace("Paris");
    await vi.runAllTimersAsync();
    expect(await first).toBeNull();

    // Now the API recovers — because the failure wasn't cached, it re-searches.
    mockSearchPlace.mockResolvedValueOnce([
      entry({ placeRepId: "9", fullName: "Paris, France", score: 1 }),
    ]);
    const second = resolveStandardPlace("Paris");
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
    });
    expect(mockGetPlaceById).not.toHaveBeenCalled();
  });

  it("falls back to the description endpoint when the entry lacks coords", async () => {
    mockSearchPlace.mockResolvedValue([
      entry({ placeRepId: "7", fullName: "Atlantis", score: 1 }),
    ]);
    mockGetPlaceById.mockResolvedValue({
      placeRepId: "7",
      name: "Atlantis",
      fullName: "Atlantis",
      type: "City",
      latitude: 1.1,
      longitude: 2.2,
    } as Awaited<ReturnType<typeof getPlaceById>>);
    expect(await standardPlaceToCoords("Atlantis")).toEqual({
      latitude: 1.1,
      longitude: 2.2,
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

  it("does not date-qualify a single-segment input", async () => {
    // "Germany" at 1827 resolves to a village in the Russian Empire when the
    // year is applied: with no parent segment there is nothing to anchor it.
    mockSearchPlace.mockResolvedValue([entry({ placeRepId: "g", fullName: "Germany", score: 99 })]);
    await resolveStandardPlace("Germany", { date: "about 1827" });
    expect(mockSearchPlace).toHaveBeenCalledWith("Germany", { date: undefined });
  });

  it("ignores a date it cannot parse instead of guessing", async () => {
    mockSearchPlace.mockResolvedValue([rochdale(95, "Rochdale, Lancashire, England, United Kingdom")]);
    await resolveStandardPlace("Rochdale, England", { date: "sometime in the war" });
    expect(mockSearchPlace).toHaveBeenCalledWith("Rochdale, England", { date: undefined });
  });

  it("falls back to an undated query when the dated one returns nothing", async () => {
    // `+date:` is a hard filter: where no representation records coverage for
    // the year FamilySearch returns nothing at all, and 13/150 corpus places
    // went blank before this guard existed.
    mockSearchPlace
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([entry({ placeRepId: "m", fullName: "Manger, Hordaland, Norway", score: 90 })]);
    expect(await resolveStandardPlace("Manger, Hordaland, Norge", { date: "1801" }))
      .toBe("Manger, Hordaland, Norway");
    expect(mockSearchPlace).toHaveBeenNthCalledWith(1, "Manger, Hordaland, Norge", { date: 1801 });
    expect(mockSearchPlace).toHaveBeenNthCalledWith(2, "Manger, Hordaland, Norge");
  });

  it("falls back to the undated answer when the dated one contradicts the recorded country", async () => {
    // A dated answer can legitimately name a different sovereign, but
    // research_append turns a countryConsistency contradiction into a hard
    // error that rejects the whole append. Prefer the writable answer.
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
