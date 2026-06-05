import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The resolver builds on the low-level FamilySearch places fetchers exported by
// place-search.ts. Mock just those three so no network is touched.
vi.mock("../../src/tools/place-search.js", () => ({
  searchPlace: vi.fn(),
  getPlaceById: vi.fn(),
  getPlaceRepIds: vi.fn(),
}));

import {
  searchPlace,
  getPlaceById,
  getPlaceRepIds,
} from "../../src/tools/place-search.js";
import {
  resolveStandardPlace,
  standardPlaceToRepId,
  standardPlaceToPlaceId,
  repIdToStandardPlace,
  standardPlaceToCoords,
  placeIdToRepIds,
  withRetry,
  mapWithConcurrency,
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
