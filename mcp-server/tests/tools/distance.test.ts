import { describe, it, expect, vi, beforeEach } from "vitest";
import { haversineDistance, placeDistanceTool } from "../../src/tools/distance.js";

vi.mock("../../src/tools/places.js", () => ({
  getPlaceByPrimaryId: vi.fn(),
}));

import { getPlaceByPrimaryId } from "../../src/tools/places.js";
const mockGetPlaceById = vi.mocked(getPlaceByPrimaryId);

beforeEach(() => {
  mockGetPlaceById.mockReset();
});

const englandPlace = {
  placeId: "267",
  name: "England",
  fullName: "England, United Kingdom",
  type: "Country",
  latitude: 52.0,
  longitude: -1.0,
};

const ohioPlace = {
  placeId: "456",
  name: "Ohio",
  fullName: "Ohio, United States",
  type: "State",
  latitude: 40.4,
  longitude: -82.9,
};

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
  it("returns distance between two valid places", async () => {
    mockGetPlaceById.mockResolvedValueOnce(englandPlace);
    mockGetPlaceById.mockResolvedValueOnce(ohioPlace);

    const result = await placeDistanceTool({ placeId1: "267", placeId2: "456" });

    expect(result.placeId1).toBe("267");
    expect(result.placeId2).toBe("456");
    expect(result.place1Name).toBe("England, United Kingdom");
    expect(result.place2Name).toBe("Ohio, United States");
    expect(result.miles).toBeGreaterThan(0);
    expect(result.kilometers).toBeGreaterThan(0);
  });

  it("throws when the first place ID is not found", async () => {
    mockGetPlaceById.mockResolvedValueOnce(null);
    mockGetPlaceById.mockResolvedValueOnce(ohioPlace);

    await expect(
      placeDistanceTool({ placeId1: "999", placeId2: "456" })
    ).rejects.toThrow("Place not found: 999");
  });

  it("throws when the second place ID is not found", async () => {
    mockGetPlaceById.mockResolvedValueOnce(englandPlace);
    mockGetPlaceById.mockResolvedValueOnce(null);

    await expect(
      placeDistanceTool({ placeId1: "267", placeId2: "999" })
    ).rejects.toThrow("Place not found: 999");
  });

  it("throws when the first place has no coordinates", async () => {
    const noCoords = { ...englandPlace, latitude: undefined, longitude: undefined };
    mockGetPlaceById.mockResolvedValueOnce(noCoords);
    mockGetPlaceById.mockResolvedValueOnce(ohioPlace);

    await expect(
      placeDistanceTool({ placeId1: "267", placeId2: "456" })
    ).rejects.toThrow('Place "England" (ID 267) has no coordinates.');
  });

  it("throws when the second place has no coordinates", async () => {
    const noCoords = { ...ohioPlace, latitude: undefined, longitude: undefined };
    mockGetPlaceById.mockResolvedValueOnce(englandPlace);
    mockGetPlaceById.mockResolvedValueOnce(noCoords);

    await expect(
      placeDistanceTool({ placeId1: "267", placeId2: "456" })
    ).rejects.toThrow('Place "Ohio" (ID 456) has no coordinates.');
  });
});
