import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetPlaceById = vi.hoisted(() => vi.fn());
vi.mock("../../src/tools/places.js", () => ({
  getPlaceById: mockGetPlaceById,
  searchPlace: vi.fn(),
  getWikipediaSummary: vi.fn(),
  placesTool: vi.fn(),
}));

const mockFetchAndCacheWikiPage = vi.hoisted(() => vi.fn());
vi.mock("../../src/tools/wikiFetchPage.js", () => ({
  fetchAndCacheWikiPage: mockFetchAndCacheWikiPage,
  wikiFetchPageTool: vi.fn(),
  wikiFetchPageSchema: {},
}));

import {
  wikiCountryHomeTool,
  wikiCountryGettingStartedTool,
  wikiCountryRecordsTool,
  wikiCountryResearchTipsTool,
} from "../../src/tools/wikiCountryPage.js";

const MOCK_RESULT = { url: "", content: "# Content", cached: false };

beforeEach(() => {
  mockGetPlaceById.mockReset();
  mockFetchAndCacheWikiPage.mockReset().mockResolvedValue(MOCK_RESULT);
});

describe("wikiCountryHomeTool", () => {
  it("builds the correct _Genealogy URL", async () => {
    mockGetPlaceById.mockResolvedValueOnce({ name: "Portugal", placeRepId: "267" });
    await wikiCountryHomeTool({ placeRepId: "267" });
    expect(mockFetchAndCacheWikiPage).toHaveBeenCalledWith(
      "https://www.familysearch.org/en/wiki/Portugal_Genealogy"
    );
  });
});

describe("wikiCountryGettingStartedTool", () => {
  it("builds the correct _Getting_Started URL", async () => {
    mockGetPlaceById.mockResolvedValueOnce({ name: "Portugal", placeRepId: "267" });
    await wikiCountryGettingStartedTool({ placeRepId: "267" });
    expect(mockFetchAndCacheWikiPage).toHaveBeenCalledWith(
      "https://www.familysearch.org/en/wiki/Portugal_Getting_Started"
    );
  });
});

describe("wikiCountryRecordsTool", () => {
  it("builds the correct _Online_Genealogy_Records URL", async () => {
    mockGetPlaceById.mockResolvedValueOnce({ name: "Portugal", placeRepId: "267" });
    await wikiCountryRecordsTool({ placeRepId: "267" });
    expect(mockFetchAndCacheWikiPage).toHaveBeenCalledWith(
      "https://www.familysearch.org/en/wiki/Portugal_Online_Genealogy_Records"
    );
  });
});

describe("wikiCountryResearchTipsTool", () => {
  it("builds the correct _Research_Tips_and_Strategies URL", async () => {
    mockGetPlaceById.mockResolvedValueOnce({ name: "Portugal", placeRepId: "267" });
    await wikiCountryResearchTipsTool({ placeRepId: "267" });
    expect(mockFetchAndCacheWikiPage).toHaveBeenCalledWith(
      "https://www.familysearch.org/en/wiki/Portugal_Research_Tips_and_Strategies"
    );
  });
});

describe("shared behaviour across all 4 tools", () => {
  it("replaces spaces with underscores for multi-word place names", async () => {
    mockGetPlaceById.mockResolvedValueOnce({ name: "British Columbia", placeRepId: "123" });
    await wikiCountryHomeTool({ placeRepId: "123" });
    expect(mockFetchAndCacheWikiPage).toHaveBeenCalledWith(
      "https://www.familysearch.org/en/wiki/British_Columbia_Genealogy"
    );
  });

  it("includes place metadata in the result", async () => {
    mockGetPlaceById.mockResolvedValueOnce({ name: "Portugal", placeRepId: "267" });
    mockFetchAndCacheWikiPage.mockResolvedValueOnce({
      url: "https://www.familysearch.org/en/wiki/Portugal_Genealogy",
      content: "# Portugal",
      cached: true,
    });
    const result = await wikiCountryHomeTool({ placeRepId: "267" });
    expect(result.placeRepId).toBe("267");
    expect(result.placeName).toBe("Portugal");
    expect(result.cached).toBe(true);
  });

  it("throws when place is not found", async () => {
    mockGetPlaceById.mockResolvedValueOnce(null);
    await expect(wikiCountryHomeTool({ placeRepId: "999" })).rejects.toThrow(
      /No place found for placeRepId: 999/
    );
  });

  it("propagates fetch errors", async () => {
    mockGetPlaceById.mockResolvedValueOnce({ name: "Portugal", placeRepId: "267" });
    mockFetchAndCacheWikiPage.mockRejectedValueOnce(
      new Error("No FamilySearch wiki page found at ...")
    );
    await expect(wikiCountryHomeTool({ placeRepId: "267" })).rejects.toThrow(
      /No FamilySearch wiki page found/
    );
  });
});
