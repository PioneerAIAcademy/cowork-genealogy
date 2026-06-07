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

const mockStandardPlaceToPlaceId = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", () => ({
  standardPlaceToPlaceId: mockStandardPlaceToPlaceId,
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

import { wikiPlacePageTool } from "../../src/tools/wiki-place-page.js";

const WIKI_DIR = "/test/wiki/dir";

beforeEach(() => {
  mockGetPlaceCandidateNames.mockReset();
  mockStandardPlaceToPlaceId.mockReset();
  mockStandardPlaceToPlaceId.mockResolvedValue(null); // default: rely on the leaf name
  mockReadFile.mockReset();
  mockGetWikiMarkdownDir.mockResolvedValue(WIKI_DIR);
});

describe("wikiPlacePageTool — home section", () => {
  it("reads Portugal_Genealogy.md from the standard place's leaf name", async () => {
    mockReadFile.mockResolvedValueOnce("# Portugal");

    const result = await wikiPlacePageTool({ standardPlace: "Portugal", section: "home" });

    expect(mockReadFile).toHaveBeenCalledWith(`${WIKI_DIR}/Portugal_Genealogy.md`, "utf8");
    expect(result.standardPlace).toBe("Portugal");
    expect(result.placeName).toBe("Portugal");
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Portugal_Genealogy");
    expect(result).not.toHaveProperty("placeId");
  });

  it("derives the leaf from a fully-qualified standard place", async () => {
    mockReadFile.mockResolvedValueOnce("# Minnesota");

    const result = await wikiPlacePageTool({
      standardPlace: "Minnesota, United States",
      section: "home",
    });

    // leaf "Minnesota" -> tries _Genealogy first (succeeds here)
    expect(mockReadFile).toHaveBeenCalledWith(`${WIKI_DIR}/Minnesota_Genealogy.md`, "utf8");
    expect(result.standardPlace).toBe("Minnesota, United States");
    expect(result.placeName).toBe("Minnesota");
  });

  it("falls back to Manitoba,_Canada_Genealogy.md when plain _Genealogy is missing", async () => {
    mockReadFile
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce("# Manitoba Genealogy");

    const result = await wikiPlacePageTool({ standardPlace: "Manitoba, Canada", section: "home" });

    expect(mockReadFile).toHaveBeenNthCalledWith(1, `${WIKI_DIR}/Manitoba_Genealogy.md`, "utf8");
    expect(mockReadFile).toHaveBeenNthCalledWith(
      2,
      `${WIKI_DIR}/Manitoba,_Canada_Genealogy.md`,
      "utf8"
    );
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Manitoba,_Canada_Genealogy");
    expect(result.standardPlace).toBe("Manitoba, Canada");
  });

  it("handles multi-word place names with underscores", async () => {
    mockReadFile.mockResolvedValueOnce("# BC");

    await wikiPlacePageTool({ standardPlace: "British Columbia, Canada", section: "home" });

    expect(mockReadFile).toHaveBeenCalledWith(
      `${WIKI_DIR}/British_Columbia_Genealogy.md`,
      "utf8"
    );
  });

  it("tries additional name variants from the places API when the leaf misses", async () => {
    // Leaf "Old Name" has no file; resolving yields the canonical wiki name.
    mockStandardPlaceToPlaceId.mockResolvedValueOnce("1927089");
    mockGetPlaceCandidateNames.mockResolvedValueOnce(["Czechia"]);
    mockReadFile
      .mockRejectedValueOnce(new Error("ENOENT")) // Old_Name_Genealogy
      .mockRejectedValueOnce(new Error("ENOENT")) // Old_Name,_Canada_Genealogy
      .mockRejectedValueOnce(new Error("ENOENT")) // Old_Name,_United_States_Genealogy
      .mockResolvedValueOnce("# Czechia"); // Czechia_Genealogy

    const result = await wikiPlacePageTool({ standardPlace: "Old Name", section: "home" });

    expect(result.placeName).toBe("Czechia");
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Czechia_Genealogy");
  });

  it("throws when no candidate file exists", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await expect(
      wikiPlacePageTool({ standardPlace: "Nowhere", section: "home" })
    ).rejects.toThrow(/No wiki page found for "Nowhere"/);
  });

  it("rejects an empty/whitespace standardPlace without touching the filesystem", async () => {
    await expect(
      wikiPlacePageTool({ standardPlace: "  ", section: "home" })
    ).rejects.toThrow(/standardPlace is required/);
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockStandardPlaceToPlaceId).not.toHaveBeenCalled();
  });
});

describe("wikiPlacePageTool — getting_started section", () => {
  it("reads the correct _Getting_Started file", async () => {
    mockReadFile.mockResolvedValueOnce("# Getting Started");

    await wikiPlacePageTool({ standardPlace: "Portugal", section: "getting_started" });

    expect(mockReadFile).toHaveBeenCalledWith(
      `${WIKI_DIR}/Portugal_Getting_Started.md`,
      "utf8"
    );
  });

  it("does not try a Canada variant (no fallback for non-home sections)", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(
      wikiPlacePageTool({ standardPlace: "Manitoba, Canada", section: "getting_started" })
    ).rejects.toThrow(/No wiki page found for "Manitoba, Canada"/);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });
});

describe("wikiPlacePageTool — online_records section", () => {
  it("reads the correct _Online_Genealogy_Records file", async () => {
    mockReadFile.mockResolvedValueOnce("# Records");

    await wikiPlacePageTool({ standardPlace: "Portugal", section: "online_records" });

    expect(mockReadFile).toHaveBeenCalledWith(
      `${WIKI_DIR}/Portugal_Online_Genealogy_Records.md`,
      "utf8"
    );
  });
});

describe("wikiPlacePageTool — research_tips section", () => {
  it("reads the correct _Research_Tips_and_Strategies file", async () => {
    mockReadFile.mockResolvedValueOnce("# Research Tips");

    await wikiPlacePageTool({ standardPlace: "Portugal", section: "research_tips" });

    expect(mockReadFile).toHaveBeenCalledWith(
      `${WIKI_DIR}/Portugal_Research_Tips_and_Strategies.md`,
      "utf8"
    );
  });
});

describe("wikiPlacePageTool — shared behaviour", () => {
  it("includes standardPlace and placeName in the result", async () => {
    mockReadFile.mockResolvedValueOnce("# Portugal");

    const result = await wikiPlacePageTool({ standardPlace: "Portugal", section: "home" });

    expect(result.standardPlace).toBe("Portugal");
    expect(result.placeName).toBe("Portugal");
    expect(result.content).toBe("# Portugal");
  });
});
