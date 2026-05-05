import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchWiki } from "../../src/tools/searchWiki.js";
import type { WikiSearchAPIResponse } from "../../src/types/searchWiki.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const getWikiApiUrlMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", () => ({
  getWikiApiUrl: getWikiApiUrlMock,
}));

beforeEach(() => {
  mockFetch.mockReset();
  getWikiApiUrlMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const mockResponse: WikiSearchAPIResponse = {
  query: "How do I find Italian birth records?",
  total_chunks_searched: 1229322,
  results: [
    {
      rank: 1,
      relevance_score: 0.86,
      chunk_text: "Civil registration of births in Italy began...",
      page_title: "Italy Civil Registration",
      section_heading: "Birth Records",
      source_url:
        "https://www.familysearch.org/en/wiki/Italy_Civil_Registration#Birth_Records",
    },
  ],
  query_time_ms: 612.4,
  timing: { embed_ms: 84.1, search_ms: 412.7, rerank_ms: 115.6 },
};

describe("searchWiki", () => {
  it("POSTs to {url}/search with the query in the body", async () => {
    getWikiApiUrlMock.mockResolvedValueOnce("http://localhost:8000");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await searchWiki({ query: "How do I find Italian birth records?" });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ query: "How do I find Italian birth records?" }),
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it("propagates the LLM-instruction error when wikiApiUrl is missing", async () => {
    getWikiApiUrlMock.mockRejectedValueOnce(
      new Error("wiki-query-api MCP is not configured.")
    );

    await expect(searchWiki({ query: "anything" })).rejects.toThrow(
      /wiki-query-api MCP is not configured/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on non-2xx response", async () => {
    getWikiApiUrlMock.mockResolvedValueOnce("http://localhost:8000");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(searchWiki({ query: "test" })).rejects.toThrow(
      "wiki-query-api error: 500"
    );
  });

  it("throws a friendly error when the server is unreachable", async () => {
    getWikiApiUrlMock.mockResolvedValueOnce("http://localhost:8000");
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(searchWiki({ query: "test" })).rejects.toThrow(
      /Could not reach wiki-query-api/
    );
  });
});
