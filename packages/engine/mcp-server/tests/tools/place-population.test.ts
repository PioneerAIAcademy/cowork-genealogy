import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveStandardPlaceToPlaceId = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return {
    resolveStandardPlaceToPlaceId: mockResolveStandardPlaceToPlaceId,
    ambiguousPlaceError: real.ambiguousPlaceError,
  };
});

const mockLoadConfig = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", () => ({
  loadConfig: mockLoadConfig,
}));

import { populationTool } from "../../src/tools/place-population.js";
import type { PopulationToolInput } from "../../src/types/place-population.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const SAMPLE = { place: { place_id: "1927069", name: "Nigeria" }, population: {} };

function okJson(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: () => Promise.resolve(body) };
}

beforeEach(() => {
  mockResolveStandardPlaceToPlaceId.mockReset();
  mockResolveStandardPlaceToPlaceId.mockResolvedValue({ kind: "resolved", placeId: "1927069" });
  mockLoadConfig.mockReset();
  mockLoadConfig.mockResolvedValue({ popStatsUrl: "https://pop.example/api" });
  mockFetch.mockReset();
});

describe("populationTool", () => {
  it("resolves the standard place to a placeId and queries Pop Stats", async () => {
    mockFetch.mockResolvedValueOnce(okJson(SAMPLE));

    const result = await populationTool({ standardPlace: "Nigeria" }, LOCAL);

    expect(mockResolveStandardPlaceToPlaceId).toHaveBeenCalledWith("Nigeria");
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("place_id=1927069");
    expect(result).toEqual(SAMPLE);
  });

  it("maps camelCase startYear/endYear to upstream year_start/year_end", async () => {
    mockFetch.mockResolvedValueOnce(okJson(SAMPLE));

    await populationTool({
      standardPlace: "Nigeria",
      year: 1960,
      startYear: 1900,
      endYear: 2000,
    }, LOCAL);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("year=1960");
    expect(url).toContain("year_start=1900");
    expect(url).toContain("year_end=2000");
  });

  it("throws and does not fetch when the place cannot be resolved", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({ kind: "unresolved" });

    await expect(populationTool({ standardPlace: "Nowhere" }, LOCAL)).rejects.toThrow(
      /Could not resolve "Nowhere"/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes a (Type)-suffixed standardPlace through verbatim and queries its placeId", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({ kind: "resolved", placeId: "3172" });
    mockFetch.mockResolvedValueOnce(okJson(SAMPLE));
    await populationTool(
      { standardPlace: "Baltimore, Maryland, United States (Independent City)" },
      LOCAL
    );
    expect(mockResolveStandardPlaceToPlaceId).toHaveBeenCalledWith(
      "Baltimore, Maryland, United States (Independent City)"
    );
    expect(mockFetch.mock.calls[0][0] as string).toContain("place_id=3172");
  });

  it("names the candidates when the standard place is ambiguous", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({
      kind: "ambiguous",
      candidates: [
        "Baltimore, Maryland, United States (Independent City)",
        "Baltimore, Maryland, United States (County)",
      ],
    });
    await expect(
      populationTool({ standardPlace: "Baltimore, Maryland, United States" }, LOCAL)
    ).rejects.toThrow(
      /matches more than one place:.*Independent City.*County.*including the parenthesised type/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not reuse the unresolvable wording for an ambiguous place", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({
      kind: "ambiguous",
      candidates: ["A (County)", "B (City)"],
    });
    const err = await populationTool(
      { standardPlace: "Somewhere" },
      LOCAL
    ).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err, "an ambiguous place must still throw").toBeInstanceOf(Error);
    expect(err?.message).not.toMatch(/Could not resolve/);
    expect(err?.message).toContain("A (County)");
  });

  it("throws when standardPlace is missing", async () => {
    await expect(
      populationTool({ standardPlace: "" } as PopulationToolInput, LOCAL)
    ).rejects.toThrow(/standardPlace is required/);
  });

  it("throws a friendly error when the service is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(populationTool({ standardPlace: "Nigeria" }, LOCAL)).rejects.toThrow(
      /Population data service is unavailable/
    );
  });

  it("throws on a non-OK response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: () => Promise.resolve({}),
    });

    await expect(populationTool({ standardPlace: "Nigeria" }, LOCAL)).rejects.toThrow(
      /Population API error: 404/
    );
  });
});
