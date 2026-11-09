import { describe, it, expect, vi, beforeEach } from "vitest";

// Same seam as place-resolver.test.ts: mock the low-level Places fetchers so no
// network is touched, and let the real resolver (and its caches) run.
vi.mock("../../src/utils/place-api.js", () => ({
  searchPlace: vi.fn(),
  getPlaceById: vi.fn(),
  getPlaceReps: vi.fn(),
  getPlaceCandidateNames: vi.fn(),
}));

import { searchPlace, getPlaceById, getPlaceReps } from "../../src/utils/place-api.js";
import {
  placeSearchNames,
  MAX_PLACE_SEARCH_NAMES,
  __clearPlaceResolverCachesForTests,
} from "../../src/utils/place-resolver.js";
import {
  configureFsBudget,
  consumeFsBudgetSlot,
  isFsBudgetExhausted,
  __resetFsBudgetForTests,
} from "../../src/utils/fs-budget.js";

const mockSearchPlace = vi.mocked(searchPlace);
const mockGetPlaceById = vi.mocked(getPlaceById);
const mockGetPlaceReps = vi.mocked(getPlaceReps);

type Entry = Awaited<ReturnType<typeof searchPlace>>[number];
type Rep = Awaited<ReturnType<typeof getPlaceReps>>[number];
type Described = NonNullable<Awaited<ReturnType<typeof getPlaceById>>>;

const PERIOD = "Rieti, Perugia, Umbria, Italy";
const MODERN = "Rieti, Rieti, Lazio, Italy";
const PARENT = "Rieti, Lazio, Italy";

function entry(placeRepId: string, placeId: string, fullName: string): Entry {
  return { placeRepId, placeId, fullName, name: "Rieti", type: "Municipality", score: 0.9 } as Entry;
}

function rep(placeRepId: string, fullName: string, dateRange?: string): Rep {
  return { placeRepId, fullName, ...(dateRange ? { dateRange } : {}), names: ["Rieti"] };
}

/** Place 4662032's six representations, as the live listing gave them on
 *  2026-11-09 (issue #4067). Listing order is FamilySearch's, not by date. */
const RIETI_REPS: Rep[] = [
  rep("7065321", MODERN, "+1927/"),
  rep("7065322", "Rieti, Roma, Lazio, Italy", "+1923/+1927"),
  rep("11077059", PERIOD, "+1882/+1923"),
  rep("11077060", "Rieti, Umbria, Umbria, Italy", "+1861/+1882"),
  rep("13760867", "Rieti, Perugia, Umbria, Papal States", "+1370/+1860"),
  rep("12885240", "Rieti, Umbria, Papal States", "/+1860"),
];

function rietiResolves(reps: Rep[] = RIETI_REPS): void {
  mockSearchPlace.mockResolvedValue([entry("11077059", "4662032", PERIOD)]);
  mockGetPlaceReps.mockResolvedValue(reps);
  mockGetPlaceById.mockImplementation(async (id: string) => {
    if (id === "7065321") {
      return { placeRepId: "7065321", placeId: "4662032", fullName: MODERN, name: "Rieti", type: "Municipality", parentPlaceRepId: "425995" } as Described;
    }
    if (id === "425995") {
      return { placeRepId: "425995", placeId: "p-prov", fullName: PARENT, name: "Rieti", type: "Province" } as Described;
    }
    return null;
  });
}

beforeEach(() => {
  mockSearchPlace.mockReset();
  mockGetPlaceById.mockReset();
  mockGetPlaceReps.mockReset();
  __clearPlaceResolverCachesForTests();
  __resetFsBudgetForTests();
});

describe("placeSearchNames", () => {
  it("returns the typed text, the modern name, then the rest newest first", async () => {
    rietiResolves();
    expect(await placeSearchNames(PERIOD, false)).toEqual([
      PERIOD,
      MODERN,
      "Rieti, Roma, Lazio, Italy",
      "Rieti, Umbria, Umbria, Italy",
      "Rieti, Perugia, Umbria, Papal States",
      "Rieti, Umbria, Papal States",
    ]);
  });

  it("puts the modern name second even when FamilySearch lists it last", async () => {
    rietiResolves([...RIETI_REPS.slice(1), RIETI_REPS[0]!]);
    const names = await placeSearchNames(PERIOD, false);
    expect(names?.slice(0, 2)).toEqual([PERIOD, MODERN]);
  });

  it("adds the modern representation's parent third under *PlaceExact", async () => {
    rietiResolves();
    const names = await placeSearchNames(PERIOD, true);
    expect(names?.slice(0, 3)).toEqual([PERIOD, MODERN, PARENT]);
    expect(names).toHaveLength(7);
  });

  it("keeps a typed text that is no representation's name, first", async () => {
    // "Rieti, Lazio, Italy" is how Giuseppa's 1913 death is indexed; whatever the
    // caller typed is always searched, so the union is never smaller than today.
    mockSearchPlace.mockResolvedValue([entry("11077059", "4662032", PERIOD)]);
    mockGetPlaceReps.mockResolvedValue(RIETI_REPS);
    const names = await placeSearchNames("Rieti, Perugia, Umbria", false);
    expect(names?.[0]).toBe("Rieti, Perugia, Umbria");
  });

  it("de-duplicates case-insensitively, so the typed period name appears once", async () => {
    rietiResolves();
    const names = await placeSearchNames(PERIOD.toUpperCase(), false);
    expect(names?.[0]).toBe(PERIOD.toUpperCase());
    expect(names?.filter((n) => n.toLowerCase() === PERIOD.toLowerCase())).toHaveLength(1);
  });

  it("caps the list, cutting from the end so the modern name and parent survive", async () => {
    const many = [
      ...RIETI_REPS,
      ...Array.from({ length: 6 }, (_, i) => rep(`x${i}`, `Rieti, Old${i}, Italy`, `+${1500 + i}/+${1501 + i}`)),
    ];
    rietiResolves(many);
    const names = await placeSearchNames(PERIOD, true);
    expect(names).toHaveLength(MAX_PLACE_SEARCH_NAMES);
    expect(names?.slice(0, 3)).toEqual([PERIOD, MODERN, PARENT]);
    expect(names).not.toContain("Rieti, Old0, Italy");
  });

  it("skips the parent when no representation is open-ended", async () => {
    rietiResolves(RIETI_REPS.slice(1));
    const names = await placeSearchNames(PERIOD, true);
    expect(names?.[1]).toBe("Rieti, Roma, Lazio, Italy");
    expect(names).not.toContain(PARENT);
    expect(mockGetPlaceById).not.toHaveBeenCalled();
  });

  it("returns null for a country-only place without any lookup", async () => {
    expect(await placeSearchNames("Italy", false)).toBeNull();
    expect(await placeSearchNames("England", true)).toBeNull();
    expect(mockSearchPlace).not.toHaveBeenCalled();
  });

  it("returns null for an ambiguous place (more than one placeId)", async () => {
    mockSearchPlace.mockResolvedValue([
      entry("1", "P1", "Franklin, Virginia, United States"),
      entry("2", "P2", "Franklin, Virginia, United States"),
    ]);
    expect(await placeSearchNames("Franklin, Virginia, United States", false)).toBeNull();
    expect(mockGetPlaceReps).not.toHaveBeenCalled();
  });

  it("returns null when the place has a single name", async () => {
    mockSearchPlace.mockResolvedValue([entry("9", "P9", "Shelby, Ohio, United States")]);
    mockGetPlaceReps.mockResolvedValue([rep("9", "Shelby, Ohio, United States")]);
    expect(await placeSearchNames("Shelby, Ohio, United States", false)).toBeNull();
  });

  it("returns null, not a throw, when a lookup fails", async () => {
    mockSearchPlace.mockRejectedValue(new Error("FamilySearch API error: 503"));
    expect(await placeSearchNames(PERIOD, false)).toBeNull();
    mockSearchPlace.mockResolvedValue([entry("11077059", "4662032", PERIOD)]);
    mockGetPlaceReps.mockRejectedValue(new Error("FamilySearch API error: 503"));
    expect(await placeSearchNames(PERIOD, false)).toBeNull();
  });

  it("rethrows the FS budget refusal", async () => {
    const FS_URL = "https://www.familysearch.org/service/places/search";
    configureFsBudget({ perMinute: 1 });
    consumeFsBudgetSlot(FS_URL);
    mockSearchPlace.mockImplementation(() => {
      consumeFsBudgetSlot(FS_URL); // throws the real refusal, as the fetcher would
      throw new Error("unreachable");
    });
    const err = await placeSearchNames(PERIOD, false).then(() => null, (e: unknown) => e);
    expect(isFsBudgetExhausted(err)).toBe(true);
  });

  it("makes no new lookup on a repeat call (resolver caches)", async () => {
    rietiResolves();
    const first = await placeSearchNames(PERIOD, true);
    const calls = mockSearchPlace.mock.calls.length + mockGetPlaceReps.mock.calls.length + mockGetPlaceById.mock.calls.length;
    expect(await placeSearchNames(PERIOD, true)).toEqual(first);
    expect(mockSearchPlace.mock.calls.length + mockGetPlaceReps.mock.calls.length + mockGetPlaceById.mock.calls.length).toBe(calls);
  });
});
