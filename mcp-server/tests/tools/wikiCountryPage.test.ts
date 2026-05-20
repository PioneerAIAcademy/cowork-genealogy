import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetPlaceCandidateNames = vi.hoisted(() => vi.fn());
vi.mock("../../src/tools/place-search.js", () => ({
  getPlaceCandidateNames: mockGetPlaceCandidateNames,
  getPlaceByPrimaryId: vi.fn(),
  getPlaceById: vi.fn(),
  searchPlace: vi.fn(),
  getWikipediaSummary: vi.fn(),
  placeSearchTool: vi.fn(),
}));

const mockReadFile = vi.hoisted(() => vi.fn());
vi.mock("fs/promises", () => ({
  readFile: mockReadFile,
}));

const mockGetWikiMarkdownDir = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", () => ({
  getWikiMarkdownDir: mockGetWikiMarkdownDir,
  getWikiApiUrl: vi.fn(),
}));

import {
  wikiCountryHomeTool,
  wikiCountryGettingStartedTool,
  wikiCountryRecordsTool,
  wikiCountryResearchTipsTool,
} from "../../src/tools/wikiCountryPage.js";

const WIKI_DIR = "/test/wiki/dir";
const PORTUGAL = { name: "Portugal", placeId: "1927089" };
const MANITOBA = { name: "Manitoba", placeId: "1927456" };
const BRITISH_COLUMBIA = { name: "British Columbia", placeId: "1927123" };

beforeEach(() => {
  mockGetPlaceCandidateNames.mockReset();
  mockReadFile.mockReset();
  mockGetWikiMarkdownDir.mockResolvedValue(WIKI_DIR);
});

describe("wikiCountryHomeTool", () => {
  it("reads Portugal_Genealogy.md when it exists", async () => {
    mockGetPlaceCandidateNames.mockResolvedValueOnce([PORTUGAL.name]);
    mockReadFile.mockResolvedValueOnce("# Portugal");

    const result = await wikiCountryHomeTool({ placeId: "1927089" });

    expect(mockReadFile).toHaveBeenCalledWith(`${WIKI_DIR}/Portugal_Genealogy.md`, "utf8");
    expect(result.placeId).toBe("1927089");
    expect(result.placeName).toBe("Portugal");
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Portugal_Genealogy");
    expect(result).not.toHaveProperty("placeRepId");
    expect(result).not.toHaveProperty("cached");
  });

  it("falls back to Manitoba,_Canada_Genealogy.md when plain _Genealogy is missing", async () => {
    mockGetPlaceCandidateNames.mockResolvedValueOnce([MANITOBA.name]);
    mockReadFile
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce("# Manitoba Genealogy");

    const result = await wikiCountryHomeTool({ placeId: "1927456" });

    expect(mockReadFile).toHaveBeenNthCalledWith(
      1,
      `${WIKI_DIR}/Manitoba_Genealogy.md`,
      "utf8"
    );
    expect(mockReadFile).toHaveBeenNthCalledWith(
      2,
      `${WIKI_DIR}/Manitoba,_Canada_Genealogy.md`,
      "utf8"
    );
    expect(result.url).toBe(
      "https://www.familysearch.org/en/wiki/Manitoba,_Canada_Genealogy"
    );
    expect(result.placeId).toBe("1927456");
  });

  it("throws when neither file candidate exists", async () => {
    mockGetPlaceCandidateNames.mockResolvedValueOnce([MANITOBA.name]);
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await expect(wikiCountryHomeTool({ placeId: "1927456" })).rejects.toThrow(
      /No wiki page found for place "1927456"/
    );
  });

  it("handles multi-word place names with underscores", async () => {
    mockGetPlaceCandidateNames.mockResolvedValueOnce([BRITISH_COLUMBIA.name]);
    mockReadFile.mockResolvedValueOnce("# BC");

    await wikiCountryHomeTool({ placeId: "1927123" });

    expect(mockReadFile).toHaveBeenCalledWith(
      `${WIKI_DIR}/British_Columbia_Genealogy.md`,
      "utf8"
    );
  });

  it("throws when place is not found", async () => {
    mockGetPlaceCandidateNames.mockResolvedValueOnce([]);

    await expect(wikiCountryHomeTool({ placeId: "999" })).rejects.toThrow(
      /No place found for placeId: 999/
    );
  });
});

describe("wikiCountryGettingStartedTool", () => {
  it("reads the correct _Getting_Started file", async () => {
    mockGetPlaceCandidateNames.mockResolvedValueOnce([PORTUGAL.name]);
    mockReadFile.mockResolvedValueOnce("# Getting Started");

    await wikiCountryGettingStartedTool({ placeId: "1927089" });

    expect(mockReadFile).toHaveBeenCalledWith(
      `${WIKI_DIR}/Portugal_Getting_Started.md`,
      "utf8"
    );
  });

  it("does not try a Canada variant (no fallback for non-home pages)", async () => {
    mockGetPlaceCandidateNames.mockResolvedValueOnce([MANITOBA.name]);
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(wikiCountryGettingStartedTool({ placeId: "1927456" })).rejects.toThrow(
      /No wiki page found for place "1927456"/
    );
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });
});

describe("wikiCountryRecordsTool", () => {
  it("reads the correct _Online_Genealogy_Records file", async () => {
    mockGetPlaceCandidateNames.mockResolvedValueOnce([PORTUGAL.name]);
    mockReadFile.mockResolvedValueOnce("# Records");

    await wikiCountryRecordsTool({ placeId: "1927089" });

    expect(mockReadFile).toHaveBeenCalledWith(
      `${WIKI_DIR}/Portugal_Online_Genealogy_Records.md`,
      "utf8"
    );
  });
});

describe("wikiCountryResearchTipsTool", () => {
  it("reads the correct _Research_Tips_and_Strategies file", async () => {
    mockGetPlaceCandidateNames.mockResolvedValueOnce([PORTUGAL.name]);
    mockReadFile.mockResolvedValueOnce("# Research Tips");

    await wikiCountryResearchTipsTool({ placeId: "1927089" });

    expect(mockReadFile).toHaveBeenCalledWith(
      `${WIKI_DIR}/Portugal_Research_Tips_and_Strategies.md`,
      "utf8"
    );
  });
});

describe("shared behaviour across all 4 tools", () => {
  it("includes placeId and placeName in the result", async () => {
    mockGetPlaceCandidateNames.mockResolvedValueOnce([PORTUGAL.name]);
    mockReadFile.mockResolvedValueOnce("# Portugal");

    const result = await wikiCountryHomeTool({ placeId: "1927089" });

    expect(result.placeId).toBe("1927089");
    expect(result.placeName).toBe("Portugal");
    expect(result.content).toBe("# Portugal");
  });
});
