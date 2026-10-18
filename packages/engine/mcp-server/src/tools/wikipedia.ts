import { fetchWithRetry } from "../utils/http.js";
import type {
  WikipediaAPIResponse,
  WikipediaPageSearchResponse,
  WikipediaSearchResult,
} from "../types/wikipedia.js";

const WIKIPEDIA_API_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary";
const WIKIPEDIA_SEARCH_URL = "https://en.wikipedia.org/w/rest.php/v1/search/page";

// One un-retried summary fetch, so a slow success today is a hard failure at
// the 30s default with nothing behind it. Measured at 33.7s and 35.2s (2 of 19)
// across the committed e2e run logs.
const WIKIPEDIA_TIMEOUT_MS = 60_000;

const WIKIPEDIA_HEADERS = { "User-Agent": "genealogy-mcp-server/0.0.1" };

export interface WikipediaSearchInput {
  query: string;
}

function fetchSummary(title: string): Promise<Response> {
  return fetchWithRetry(
    `${WIKIPEDIA_API_BASE}/${encodeURIComponent(title)}`,
    { headers: WIKIPEDIA_HEADERS },
    WIKIPEDIA_TIMEOUT_MS,
  );
}

/** The title of Wikipedia's top search hit for `query`, or null when there is none. */
async function topSearchTitle(query: string): Promise<string | null> {
  const response = await fetchWithRetry(
    `${WIKIPEDIA_SEARCH_URL}?q=${encodeURIComponent(query)}&limit=1`,
    { headers: WIKIPEDIA_HEADERS },
    WIKIPEDIA_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`Wikipedia search API error: ${response.status}`);
  }
  const data: WikipediaPageSearchResponse = await response.json();
  const title = data.pages?.[0]?.title;
  return typeof title === "string" && title !== "" ? title : null;
}

export async function wikipediaSearch(
  input: WikipediaSearchInput
): Promise<WikipediaSearchResult> {
  const notFound = () => new Error(`No Wikipedia article found for '${input.query}'`);

  // The summary endpoint takes an exact title, so a descriptive query ("Luo
  // people Kenya ethnic group history") 404s there; the top search hit's
  // title is the article it meant.
  let response = await fetchSummary(input.query);
  if (response.status === 404) {
    const title = await topSearchTitle(input.query);
    if (title === null) throw notFound();
    response = await fetchSummary(title);
    if (response.status === 404) throw notFound();
  }

  if (!response.ok) {
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
