import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());

vi.mock("fs/promises", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

const mockLoad = vi.hoisted(() => vi.fn());
vi.mock("cheerio", () => ({ load: mockLoad }));

const mockTurndownConvert = vi.hoisted(() => vi.fn().mockReturnValue("# Article"));

vi.mock("turndown", () => ({
  default: class MockTurndown {
    turndown(html: string) {
      return mockTurndownConvert(html);
    }
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { wikiFetchPageTool } from "../../src/tools/wikiFetchPage.js";

const TEST_URL = "https://www.familysearch.org/en/wiki/Portugal_Genealogy";

beforeEach(() => {
  mockFetch.mockReset();
  mockReadFile.mockReset();
  mockWriteFile.mockReset().mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  mockLoad.mockReturnValue((_selector: string) => ({ html: () => "<p>Article</p>" }));
  mockTurndownConvert.mockReturnValue("# Article");
});

describe("wikiFetchPageTool", () => {
  it("returns cached content without fetching when cache file exists", async () => {
    mockReadFile.mockResolvedValueOnce("# Cached Portugal page");

    const result = await wikiFetchPageTool({ url: TEST_URL });

    expect(result.cached).toBe(true);
    expect(result.content).toBe("# Cached Portugal page");
    expect(result.url).toBe(TEST_URL);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches, converts, writes cache, and returns markdown on cache miss", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        "<html><div class='mw-parser-output'><p>Content</p></div></html>",
    });
    mockTurndownConvert.mockReturnValueOnce("# Fetched content");

    const result = await wikiFetchPageTool({ url: TEST_URL });

    expect(result.cached).toBe(false);
    expect(result.url).toBe(TEST_URL);
    expect(mockFetch).toHaveBeenCalledWith(TEST_URL, expect.any(Object));
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it("throws a descriptive error for 404", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(wikiFetchPageTool({ url: TEST_URL })).rejects.toThrow(
      /No FamilySearch wiki page found/
    );
  });

  it("throws a friendly error when the server is unreachable", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(wikiFetchPageTool({ url: TEST_URL })).rejects.toThrow(
      /Could not fetch wiki page/
    );
  });

  it("throws on non-200, non-404 status", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(wikiFetchPageTool({ url: TEST_URL })).rejects.toThrow(
      /Wiki fetch error: 500/
    );
  });
});
