import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStandardPlaceToPlaceId = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", () => ({
  standardPlaceToPlaceId: mockStandardPlaceToPlaceId,
}));

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
  mockStandardPlaceToPlaceId.mockReset();
  mockStandardPlaceToPlaceId.mockResolvedValue("1927069");
  mockLoadConfig.mockReset();
  mockLoadConfig.mockResolvedValue({ popStatsUrl: "https://pop.example/api" });
  mockFetch.mockReset();
});

describe("populationTool", () => {
  it("resolves the standard place to a placeId and queries Pop Stats", async () => {
    mockFetch.mockResolvedValueOnce(okJson(SAMPLE));

    const result = await populationTool({ standardPlace: "Nigeria" });

    expect(mockStandardPlaceToPlaceId).toHaveBeenCalledWith("Nigeria");
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("place_id=1927069");
    expect(result).toEqual(SAMPLE);
  });

  it("passes year and year-range filters through", async () => {
    mockFetch.mockResolvedValueOnce(okJson(SAMPLE));

    await populationTool({
      standardPlace: "Nigeria",
      year: 1960,
      year_start: 1900,
      year_end: 2000,
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("year=1960");
    expect(url).toContain("year_start=1900");
    expect(url).toContain("year_end=2000");
  });

  it("throws and does not fetch when the place cannot be resolved", async () => {
    mockStandardPlaceToPlaceId.mockResolvedValueOnce(null);

    await expect(populationTool({ standardPlace: "Nowhere" })).rejects.toThrow(
      /Could not resolve "Nowhere"/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when standardPlace is missing", async () => {
    await expect(
      populationTool({ standardPlace: "" } as PopulationToolInput)
    ).rejects.toThrow(/standardPlace is required/);
  });

  it("throws a friendly error when the service is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(populationTool({ standardPlace: "Nigeria" })).rejects.toThrow(
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

    await expect(populationTool({ standardPlace: "Nigeria" })).rejects.toThrow(
      /Population API error: 404/
    );
  });
});
