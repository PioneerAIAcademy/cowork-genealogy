import { describe, it, expect, vi, beforeEach } from "vitest";
import { haversineDistance, placeDistanceTool } from "../../src/tools/distance.js";

vi.mock("../../src/utils/place-resolver.js", () => ({
  standardPlaceToCoords: vi.fn(),
}));

import { standardPlaceToCoords } from "../../src/utils/place-resolver.js";
const mockCoords = vi.mocked(standardPlaceToCoords);

beforeEach(() => {
  mockCoords.mockReset();
});

const englandCoords = { latitude: 52.0, longitude: -1.0 };
const ohioCoords = { latitude: 40.4, longitude: -82.9 };

describe("haversineDistance", () => {
  it("returns a reasonable distance between London and New York", () => {
    const result = haversineDistance(51.5074, -0.1278, 40.7128, -74.006);
    // ~5570 km / ~3461 miles, allow ±100 km tolerance
    expect(result.kilometers).toBeGreaterThan(5470);
    expect(result.kilometers).toBeLessThan(5670);
    expect(result.miles).toBeGreaterThan(3400);
    expect(result.miles).toBeLessThan(3520);
  });

  it("returns zero distance for the same point", () => {
    const result = haversineDistance(52.0, -1.0, 52.0, -1.0);
    expect(result.kilometers).toBe(0);
    expect(result.miles).toBe(0);
  });

  it("returns rounded integer values", () => {
    const result = haversineDistance(52.0, -1.0, 40.4, -82.9);
    expect(Number.isInteger(result.miles)).toBe(true);
    expect(Number.isInteger(result.kilometers)).toBe(true);
  });
});

describe("placeDistanceTool", () => {
  it("returns distance between two standard places", async () => {
    mockCoords.mockResolvedValueOnce(englandCoords);
    mockCoords.mockResolvedValueOnce(ohioCoords);

    const result = await placeDistanceTool({
      standardPlace1: "England, United Kingdom",
      standardPlace2: "Ohio, United States",
    });

    expect(result.standardPlace1).toBe("England, United Kingdom");
    expect(result.standardPlace2).toBe("Ohio, United States");
    expect(result.miles).toBeGreaterThan(0);
    expect(result.kilometers).toBeGreaterThan(0);
    expect(mockCoords).toHaveBeenNthCalledWith(1, "England, United Kingdom");
    expect(mockCoords).toHaveBeenNthCalledWith(2, "Ohio, United States");
  });

  it("throws when the first place cannot be resolved", async () => {
    mockCoords.mockResolvedValueOnce(null);
    mockCoords.mockResolvedValueOnce(ohioCoords);

    await expect(
      placeDistanceTool({
        standardPlace1: "Nowhere, Nowhere",
        standardPlace2: "Ohio, United States",
      })
    ).rejects.toThrow('Could not resolve coordinates for "Nowhere, Nowhere"');
  });

  it("throws when the second place cannot be resolved", async () => {
    mockCoords.mockResolvedValueOnce(englandCoords);
    mockCoords.mockResolvedValueOnce(null);

    await expect(
      placeDistanceTool({
        standardPlace1: "England, United Kingdom",
        standardPlace2: "Nowhere, Nowhere",
      })
    ).rejects.toThrow('Could not resolve coordinates for "Nowhere, Nowhere"');
  });
});
