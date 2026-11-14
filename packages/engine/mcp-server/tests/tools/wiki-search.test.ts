import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WIKI_SEARCH_TEXT_BUDGET,
  cleanWikiSearchText,
  compactWikiSearchAnswer,
  wikiSearch,
  wikiSearchSchema,
} from "../../src/tools/wiki-search.js";
import type { WikiSearchAPIResponse, WikiSearchAPIResultItem } from "../../src/types/wiki-search.js";
import { rejectUnknownArgs } from "../../src/utils/unknown-args.js";
import { socketFetchFailure } from "../helpers/fetch-failed.js";

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

describe("wikiSearch", () => {
  it("POSTs to {url}/search with the query in the body", async () => {
    getWikiApiUrlMock.mockResolvedValueOnce("http://localhost:8000");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await wikiSearch({ query: "How do I find Italian birth records?" }, LOCAL);

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
    expect(result).toEqual({
      query: "How do I find Italian birth records?",
      total_chunks_searched: 1229322,
      results: [
        {
          page_title: "Italy Civil Registration",
          section_heading: "Birth Records",
          source_url:
            "https://www.familysearch.org/en/wiki/Italy_Civil_Registration#Birth_Records",
        },
      ],
      query_time_ms: 612.4,
      timing: { embed_ms: 84.1, search_ms: 412.7, rerank_ms: 115.6 },
    });
  });

  it("propagates the LLM-instruction error when wikiApiUrl is missing", async () => {
    getWikiApiUrlMock.mockRejectedValueOnce(
      new Error("wiki-query-api MCP is not configured.")
    );

    await expect(wikiSearch({ query: "anything" }, LOCAL)).rejects.toThrow(
      /wiki-query-api MCP is not configured/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on non-2xx response", async () => {
    getWikiApiUrlMock.mockResolvedValueOnce("http://localhost:8000");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
    });

    await expect(wikiSearch({ query: "test" }, LOCAL)).rejects.toThrow(
      "wiki-query-api error: 500"
    );
  });

  it("throws a friendly error when the server is unreachable", async () => {
    getWikiApiUrlMock.mockResolvedValueOnce("http://localhost:8000");
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(wikiSearch({ query: "test" }, LOCAL)).rejects.toThrow(
      /Could not reach wiki-query-api/
    );
  });

  it("names the socket cause, not just \"fetch failed\"", async () => {
    getWikiApiUrlMock.mockResolvedValueOnce("http://localhost:8000");
    mockFetch.mockRejectedValue(socketFetchFailure());

    const err = await wikiSearch({ query: "test" }, LOCAL).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Could not reach wiki-query-api.*ETIMEDOUT/s);
    expect((err as Error).message).toContain("http://localhost:8000");
    expect((err as Error).message).not.toMatch(/Is the server running/);
  });
});

const ENVELOPE = ["query", "total_chunks_searched", "results", "query_time_ms", "timing"];

function item(i: number, chunk: string, extra: Partial<WikiSearchAPIResultItem> = {}): WikiSearchAPIResultItem {
  return {
    rank: i + 1,
    relevance_score: 0.9 - i / 100,
    chunk_text: chunk,
    page_title: `Page ${i}`,
    section_heading: `Section ${i}`,
    source_url: `https://www.familysearch.org/en/wiki/Page_${i}#Section_${i}`,
    source: "wiki",
    source_subtype: "",
    ...extra,
  };
}

function answerOf(results: WikiSearchAPIResultItem[]): WikiSearchAPIResponse {
  return {
    query: "q",
    total_chunks_searched: 100,
    results,
    query_time_ms: 1,
    timing: { embed_ms: 1, search_ms: 1, rerank_ms: 1 },
  };
}

function serve(answer: WikiSearchAPIResponse): void {
  getWikiApiUrlMock.mockResolvedValueOnce("http://localhost:8000");
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => answer });
}

describe("wiki_search answer", () => {
  it("returns references by default: no chunk_text, rank, relevance_score or source_subtype", async () => {
    serve(answerOf([item(0, "a"), item(1, "b")]));
    const result = await wikiSearch({ query: "q" }, LOCAL);
    expect(Object.keys(result)).toEqual(ENVELOPE);
    for (const r of result.results) {
      expect(Object.keys(r)).toEqual(["page_title", "section_heading", "source_url"]);
    }
  });

  it('keeps source only when it is not "wiki"', () => {
    const out = compactWikiSearchAnswer(answerOf([item(0, "a"), item(1, "b", { source: "library" })]), false);
    expect(out.results[0]).not.toHaveProperty("source");
    expect(out.results[1].source).toBe("library");
  });

  it("a 20 × 4,200-char answer with includeText stays under 24,000 characters with all 20 source_urls", async () => {
    const raw = Array.from({ length: 20 }, (_, i) => item(i, `${i} `.repeat(2100).slice(0, 4200)));
    serve(answerOf(raw));
    const result = await wikiSearch({ query: "q", includeText: true }, LOCAL);
    // The literal, not the constant: a raised budget must fail here.
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
    expect(result.results.map((r) => r.source_url)).toEqual(raw.map((r) => r.source_url));
    expect(result.results[0].chunk_text).toBe(raw[0].chunk_text);
    expect(result.results[19]).not.toHaveProperty("chunk_text");
    const withText = result.results.map((r) => r.chunk_text !== undefined);
    const kept = withText.filter(Boolean).length;
    expect(kept).toBeGreaterThan(0);
    expect(withText).toEqual(withText.map((_, i) => i < kept));
    expect(result.results.some((r) => r.same_text_as !== undefined)).toBe(false);
  });

  it("marks a repeated chunk same_text_as the 0-based index of the earlier result", () => {
    const out = compactWikiSearchAnswer(answerOf([item(0, "alpha"), item(1, "beta"), item(2, "beta")]), true);
    expect(out.results[1].chunk_text).toBe("beta");
    expect(out.results[2].same_text_as).toBe(1);
    expect(out.results[2]).not.toHaveProperty("chunk_text");
  });

  it("a capped result's same_text_as referrers become plain references", () => {
    const big = "x".repeat(WIKI_SEARCH_TEXT_BUDGET);
    const out = compactWikiSearchAnswer(answerOf([item(0, "small"), item(1, big), item(2, big)]), true);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(WIKI_SEARCH_TEXT_BUDGET);
    expect(out.results[0].chunk_text).toBe("small");
    expect(out.results[1]).not.toHaveProperty("chunk_text");
    expect(out.results[2]).not.toHaveProperty("same_text_as");
    out.results.forEach((r, i) => {
      if (r.same_text_as === undefined) return;
      expect(r.same_text_as).toBeLessThan(i);
      expect(out.results[r.same_text_as].chunk_text).toBeDefined();
    });
  });

  it("strips the sidebar, image links and link titles from chunk_text", () => {
    const linkedImage =
      "[![Norway Marriages 1716-1763](/en/wiki/img_auth.php/thumb/c/c4/Norway_Marriages_1716-1763.jpg/400px-Norway_Marriages_1716-1763.jpg)](https://www.familysearch.org/en/wiki/index.php?title=File:Norway_Marriages_1716-1763.jpg&filetimestamp=20080829202425& \"Norway Marriages 1716-1763\")";
    const sidebar = [
      "|  |",
      "| --- |",
      "| [England Wiki Topics](https://www.familysearch.org/en/wiki/England_Genealogy) |",
      "| [Census](https://www.familysearch.org/en/wiki/England_Census) |",
      "",
    ].join("\n");
    const text = [
      sidebar + "Intro.",
      `Before ${linkedImage} after.`,
      "A bare ![scan](/img/Page.PNG) image.",
      "A ![leaflet](/docs/leaflet.pdf) stays.",
      'See [Norway Church Records](https://www.familysearch.org/en/wiki/Norway_Church_Records "Norway Church Records").',
      'And [Hesse](https://www.familysearch.org/en/wiki/Hesse-Nassau_(Hessen-Nassau),_German_Empire_Church_Records "Hesse").',
    ].join("\n");
    expect(cleanWikiSearchText(text)).toBe(
      [
        "Intro.",
        "Before  after.",
        "A bare  image.",
        "A ![leaflet](/docs/leaflet.pdf) stays.",
        "See [Norway Church Records](https://www.familysearch.org/en/wiki/Norway_Church_Records).",
        "And [Hesse](https://www.familysearch.org/en/wiki/Hesse-Nassau_(Hessen-Nassau),_German_Empire_Church_Records).",
      ].join("\n")
    );
    const out = compactWikiSearchAnswer(answerOf([item(0, text)]), true);
    expect(out.results[0].chunk_text).toBe(cleanWikiSearchText(text));
  });

  it("does not forward includeText to the sidecar and only boolean true opts in", async () => {
    serve(answerOf([item(0, "a")]));
    const result = await wikiSearch({ query: "q", includeText: "true" as unknown as boolean }, LOCAL);
    expect(mockFetch.mock.calls[0][1].body).toBe(JSON.stringify({ query: "q" }));
    expect(result.results[0]).not.toHaveProperty("chunk_text");
  });

  it("compactWikiSearchAnswer does not mutate its input", () => {
    const answer = answerOf([item(0, "a"), item(1, "a"), item(2, "x".repeat(WIKI_SEARCH_TEXT_BUDGET))]);
    const before = JSON.parse(JSON.stringify(answer));
    compactWikiSearchAnswer(answer, true);
    compactWikiSearchAnswer(answer, false);
    expect(answer).toEqual(before);
  });

  it("tolerates a result with no text: it comes back a reference", () => {
    const noText = { ...item(1, ""), chunk_text: undefined } as unknown as WikiSearchAPIResultItem;
    const out = compactWikiSearchAnswer(answerOf([item(0, "a"), noText]), true);
    expect(Object.keys(out.results[1])).toEqual(["page_title", "section_heading", "source_url"]);
  });

  it("advertises includeText", () => {
    const props = wikiSearchSchema.inputSchema.properties as Record<string, { type: string }>;
    expect(props.includeText.type).toBe("boolean");
    expect(rejectUnknownArgs("wiki_search", { query: "q", includeText: true })).toBeNull();
    expect(wikiSearchSchema.description).not.toContain("Returns up to 20 wiki sections with source URLs");
    expect(wikiSearchSchema.description).toContain("includeText");
    expect(wikiSearchSchema.description).toContain("24,000");
  });
});
