import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockGetWikiApiUrl = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", () => ({
  getWikiApiUrl: mockGetWikiApiUrl,
}));

import { wikiReadTool } from "../../src/tools/wiki-read.js";

const API_BASE = "http://localhost:8000";
const TEST_URL = "https://www.familysearch.org/en/wiki/Portugal_Genealogy";

beforeEach(() => {
  mockFetch.mockReset();
  mockGetWikiApiUrl.mockReset();
  mockGetWikiApiUrl.mockResolvedValue(API_BASE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wikiReadTool", () => {
  it("GETs /page/{slug} and returns the page content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        title: "Portugal_Genealogy",
        content: "# Portugal Genealogy",
        source_url: "https://www.familysearch.org/en/wiki/Portugal_Genealogy",
      }),
    });

    const result = await wikiReadTool({ url: TEST_URL });

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Portugal_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Portugal_Genealogy");
    expect(result.content).toBe("# Portugal Genealogy");
  });

  it("throws a descriptive error on 404", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "No wiki page found" }),
    });

    await expect(wikiReadTool({ url: TEST_URL })).rejects.toThrow(
      /No wiki page found for "Portugal_Genealogy"/
    );
  });

  it("throws on non-2xx, non-404 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(wikiReadTool({ url: TEST_URL })).rejects.toThrow(
      "wiki-query-api error: 500"
    );
  });

  it("throws a friendly error when the server is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(wikiReadTool({ url: TEST_URL })).rejects.toThrow(
      /Could not reach wiki-query-api/
    );
  });

  it("throws when given a non-wiki URL (and never calls the server)", async () => {
    await expect(
      wikiReadTool({ url: "https://www.google.com/search?q=test" })
    ).rejects.toThrow(/Not a valid FamilySearch wiki URL/);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles URL-encoded slugs correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        title: "Manitoba,_Canada_Genealogy",
        content: "# Manitoba",
        source_url:
          "https://www.familysearch.org/en/wiki/Manitoba,_Canada_Genealogy",
      }),
    });
    const encodedUrl =
      "https://www.familysearch.org/en/wiki/Manitoba%2C_Canada_Genealogy";

    await wikiReadTool({ url: encodedUrl });

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Manitoba,_Canada_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("extracts slug from URL with query params or fragments", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        title: "Portugal_Genealogy",
        content: "# Content",
        source_url: "https://www.familysearch.org/en/wiki/Portugal_Genealogy",
      }),
    });
    const urlWithParams =
      "https://www.familysearch.org/en/wiki/Portugal_Genealogy?section=2#top";

    await wikiReadTool({ url: urlWithParams });

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Portugal_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("propagates the LLM-instruction error when wikiApiUrl is missing", async () => {
    mockGetWikiApiUrl.mockReset();
    mockGetWikiApiUrl.mockRejectedValueOnce(
      new Error("wiki-query-api MCP is not configured.")
    );

    await expect(wikiReadTool({ url: TEST_URL })).rejects.toThrow(
      /wiki-query-api MCP is not configured/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
