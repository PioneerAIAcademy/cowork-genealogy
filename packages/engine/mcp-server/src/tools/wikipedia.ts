import { fetchWithRetry } from "../utils/http.js";
import { readBuildInfo } from "../utils/build-info.js";
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

// Wikimedia throttles every User-Agent without contact details in one shared
// bucket: measured, a bare agent got 429s after about ten requests, while the
// same agent with this URL went 20 of 20.
const WIKIPEDIA_HEADERS = {
  "User-Agent": `genealogy-mcp-server/${readBuildInfo().base} (https://github.com/PioneerAIAcademy/cowork-genealogy)`,
};

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

const SEARCH_HITS = 5;

// Small words a title carries that the query need not repeat.
const FUNCTION_WORDS = new Set([
  "of", "the", "and", "in", "on", "at", "a", "an",
  "de", "la", "le", "du", "des", "von", "van", "der",
]);

// Letters NFD does not decompose: the stroked ones, which a query types bare
// ("Osteroy" for "Osterøy"), and ß, which case folding spells ss.
const UNDECOMPOSED: Record<string, string> = { ø: "o", ł: "l", đ: "d", ħ: "h", ŧ: "t", ı: "i", ß: "ss" };

/** Case-folded words with diacritics stripped, split on anything that is not a letter or digit. */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[øłđħŧıß]/g, (c) => UNDECOMPOSED[c])
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");
}

/**
 * Whether the query spells out a search hit's title: every significant word of
 * the title, less a trailing parenthetical, appears in the query. Search
 * ranks by relevance, not meaning, so a query for a place with no article of
 * its own gets some other article back ("Maddock North Dakota history" → "List
 * of governors of North Dakota"), and the caller would take it as the answer.
 */
function titleMatches(title: string, queryWords: ReadonlySet<string>): boolean {
  const significant = words(title.replace(/\s*\([^()]*\)\s*$/, "")).filter(
    (w) => !FUNCTION_WORDS.has(w),
  );
  return significant.length > 0 && significant.every((w) => queryWords.has(w));
}

/** The first of Wikipedia's top search hits for `query` whose title matches it, or null. */
async function matchingSearchTitle(query: string): Promise<string | null> {
  const response = await fetchWithRetry(
    `${WIKIPEDIA_SEARCH_URL}?q=${encodeURIComponent(query)}&limit=${SEARCH_HITS}`,
    { headers: WIKIPEDIA_HEADERS },
    WIKIPEDIA_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`Wikipedia search API error: ${response.status}`);
  }
  const data: WikipediaPageSearchResponse = await response.json();
  const queryWords = new Set(words(query));
  for (const page of data.pages ?? []) {
    if (typeof page.title === "string" && titleMatches(page.title, queryWords)) return page.title;
  }
  return null;
}

export async function wikipediaSearch(
  input: WikipediaSearchInput
): Promise<WikipediaSearchResult> {
  const notFound = () => new Error(`No Wikipedia article found for '${input.query}'`);

  // The summary endpoint takes an exact title, so a descriptive query ("Luo
  // people Kenya ethnic group history") 404s there; the first search hit whose
  // title the query spells out is the article it meant.
  let response = await fetchSummary(input.query);
  if (response.status === 404) {
    const title = await matchingSearchTitle(input.query);
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
