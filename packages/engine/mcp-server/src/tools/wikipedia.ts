import { fetchWithTimeout } from "../utils/http.js";
import type {
  WikipediaAPIResponse,
  WikipediaSearchResult,
} from "../types/wikipedia.js";

const WIKIPEDIA_API_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary";

// One un-retried summary fetch, so a slow success today is a hard failure at
// the 30s default with nothing behind it. Measured at 33.7s and 35.2s (2 of 19)
// across the committed e2e run logs.
const WIKIPEDIA_TIMEOUT_MS = 60_000;

export interface WikipediaSearchInput {
  query: string;
}

export async function wikipediaSearch(
  input: WikipediaSearchInput
): Promise<WikipediaSearchResult> {
  const url = `${WIKIPEDIA_API_BASE}/${encodeURIComponent(input.query)}`;

  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": "genealogy-mcp-server/0.0.1",
      },
    },
    WIKIPEDIA_TIMEOUT_MS
  );

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
