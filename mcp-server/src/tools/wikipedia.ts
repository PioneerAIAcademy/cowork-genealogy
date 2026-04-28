import type {
  WikipediaAPIResponse,
  WikipediaSearchResult,
} from "../types/wikipedia.js";

const WIKIPEDIA_API_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary";

export interface WikipediaSearchInput {
  query: string;
}

export async function wikipediaSearch(
  input: WikipediaSearchInput
): Promise<WikipediaSearchResult> {
  const url = `${WIKIPEDIA_API_BASE}/${encodeURIComponent(input.query)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "genealogy-mcp-server/0.0.1",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`No Wikipedia article found for '${input.query}'`);
    }
    throw new Error(`Wikipedia API error: ${response.status}`);
  }

  const data: WikipediaAPIResponse = await response.json();

  return {
    title: data.title,
    extract: data.extract,
    url: data.content_urls.desktop.page,
  };
}

export const wikipediaSearchSchema = {
  name: "wikipedia_search",
  description:
    "Search Wikipedia and return an article summary. Use this when the user wants to look up information about a topic on Wikipedia.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The topic to search for on Wikipedia",
      },
    },
    required: ["query"],
  },
};
