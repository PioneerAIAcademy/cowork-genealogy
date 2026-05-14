import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
vi.mock("fs/promises", () => ({
  readFile: mockReadFile,
}));

const mockGetWikiMarkdownDir = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", () => ({
  getWikiMarkdownDir: mockGetWikiMarkdownDir,
  getWikiApiUrl: vi.fn(),
}));

import { wikiFetchPageTool } from "../../src/tools/wikiFetchPage.js";

const WIKI_DIR = "/test/wiki/dir";
const TEST_URL = "https://www.familysearch.org/en/wiki/Portugal_Genealogy";

beforeEach(() => {
  mockReadFile.mockReset();
  mockGetWikiMarkdownDir.mockResolvedValue(WIKI_DIR);
});

describe("wikiFetchPageTool", () => {
  it("reads the correct file from disk for a valid wiki URL", async () => {
    mockReadFile.mockResolvedValueOnce("# Portugal Genealogy");

    const result = await wikiFetchPageTool({ url: TEST_URL });

    expect(mockReadFile).toHaveBeenCalledWith(`${WIKI_DIR}/Portugal_Genealogy.md`, "utf8");
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Portugal_Genealogy");
    expect(result.content).toBe("# Portugal Genealogy");
    expect(result).not.toHaveProperty("cached");
  });

  it("throws a descriptive error when the file is not on disk", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(wikiFetchPageTool({ url: TEST_URL })).rejects.toThrow(
      /No wiki page found for "Portugal_Genealogy"/
    );
  });

  it("throws when given a non-wiki URL", async () => {
    await expect(
      wikiFetchPageTool({ url: "https://www.google.com/search?q=test" })
    ).rejects.toThrow(/Not a valid FamilySearch wiki URL/);
  });

  it("handles URL-encoded slugs correctly", async () => {
    mockReadFile.mockResolvedValueOnce("# Manitoba");
    const encodedUrl =
      "https://www.familysearch.org/en/wiki/Manitoba%2C_Canada_Genealogy";

    await wikiFetchPageTool({ url: encodedUrl });

    expect(mockReadFile).toHaveBeenCalledWith(
      `${WIKI_DIR}/Manitoba,_Canada_Genealogy.md`,
      "utf8"
    );
  });

  it("extracts slug from URL with query params or fragments", async () => {
    mockReadFile.mockResolvedValueOnce("# Content");
    const urlWithParams =
      "https://www.familysearch.org/en/wiki/Portugal_Genealogy?section=2#top";

    await wikiFetchPageTool({ url: urlWithParams });

    expect(mockReadFile).toHaveBeenCalledWith(`${WIKI_DIR}/Portugal_Genealogy.md`, "utf8");
  });
});
