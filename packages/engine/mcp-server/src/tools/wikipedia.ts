import { fetchWithRetry, DEFAULT_RETRY_BUDGET_MS } from "../utils/http.js";
import { readBuildInfo } from "../utils/build-info.js";
import type {
  WikipediaAPIResponse,
  WikipediaPageSearchResponse,
  WikipediaSearchResult,
} from "../types/wikipedia.js";

const WIKIPEDIA_API_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary";
const WIKIPEDIA_SEARCH_URL = "https://en.wikipedia.org/w/rest.php/v1/search/page";

// Cowork's device bridge aborts any MCP call at 60s, so the summary, the search
// and the second summary share one deadline under it, each request getting what
// is left. A slow summary has run 33.7s and 35.2s (2 of 19 across the committed
// e2e run logs), so the first may need most of it.
const WIKIPEDIA_DEADLINE_MS = 55_000;

// With less than this left, a request is not started.
const MIN_REQUEST_MS = 1_000;

// Wikimedia throttles every User-Agent without contact details in one shared
// bucket: measured, a bare agent got 429s after about ten requests, while the
// same agent with this URL went 20 of 20.
const WIKIPEDIA_HEADERS = {
  "User-Agent": `genealogy-mcp-server/${readBuildInfo().base} (https://github.com/PioneerAIAcademy/cowork-genealogy)`,
};

export interface WikipediaSearchInput {
  query: string;
}

type DeadlineFetch = (url: string) => Promise<Response>;

/**
 * A fetch whose timeout and retry budget are both capped at what is left
 * before `deadline`. With too little left it throws `outOfTime()` rather than
 * send a request bound to time out.
 */
function requestBefore(deadline: number, outOfTime: () => Error): DeadlineFetch {
  return async (url) => {
    const remaining = deadline - Date.now();
    if (remaining < MIN_REQUEST_MS) throw outOfTime();
    return fetchWithRetry(url, { headers: WIKIPEDIA_HEADERS }, remaining, {
      budgetMs: Math.min(DEFAULT_RETRY_BUDGET_MS, remaining),
    });
  };
}

const summaryUrl = (title: string) => `${WIKIPEDIA_API_BASE}/${encodeURIComponent(title)}`;

const SEARCH_HITS = 5;

// Small words a title carries that the query need not repeat.
const FUNCTION_WORDS = new Set([
  "of", "the", "and", "in", "on", "at", "a", "an",
  "de", "la", "le", "du", "des", "von", "van", "der",
]);

// Letters NFD does not decompose: the stroked ones, which a query types bare
// ("Osteroy" for "Osterøy"), and ß, which case folding spells ss.
const UNDECOMPOSED: Record<string, string> = { ø: "o", ł: "l", đ: "d", ħ: "h", ŧ: "t", ı: "i", ß: "ss" };

/**
 * Case-folded words with diacritics stripped, split on anything that is not a
 * letter or digit. An apostrophe (', ’, ʼ) is removed, neither a letter nor a
 * split, so "Mo'orea" reads as "Moʼorea", whose ʼ Unicode counts as a letter.
 */
function words(text: string): string[] {
  return text
    .replace(/['’ʼ]/g, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[øłđħŧıß]/g, (c) => UNDECOMPOSED[c])
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");
}

/** Whether `titleWords` appear in `queryWords` in the same order, other words allowed between. */
function inOrder(titleWords: string[], queryWords: readonly string[]): boolean {
  let next = 0;
  for (const w of titleWords) {
    next = queryWords.indexOf(w, next) + 1;
    if (next === 0) return false;
  }
  return true;
}

/**
 * Whether the query spells out a search hit's title, by the rule in
 * docs/specs/wikipedia-search-tool-spec.md, "Lookup order". Search ranks by
 * relevance, not meaning, so a query for a place with no article of its own
 * gets some other article back ("Maddock North Dakota history" → "List of
 * governors of North Dakota"), and the caller would take it as the answer.
 */
function titleMatches(title: string, queryWords: readonly string[]): boolean {
  const paren = title.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  const base = paren ? paren[1] : title;
  const dated = paren !== null && /\d/.test(paren[2]);
  const headOf = dated ? null : base.match(/^(.+?) of (.+)$/);
  const spellings = headOf ? [base, `${headOf[2]} ${headOf[1]}`] : [base];
  return spellings.some((spelling) => {
    const parts = spelling
      .split(",")
      .map((part) => words(part).filter((w) => !FUNCTION_WORDS.has(w)))
      .filter((part) => part.length > 0);
    return parts.length > 0 && parts.every((part) => inOrder(part, queryWords));
  });
}

/** The first of Wikipedia's top search hits for `query` whose title matches it, or null. */
async function matchingSearchTitle(query: string, request: DeadlineFetch): Promise<string | null> {
  const response = await request(
    `${WIKIPEDIA_SEARCH_URL}?q=${encodeURIComponent(query)}&limit=${SEARCH_HITS}`,
  );
  if (!response.ok) {
    throw new Error(`Wikipedia search API error: ${response.status}`);
  }
  const data: WikipediaPageSearchResponse = await response.json();
  const queryWords = words(query);
  for (const page of data.pages ?? []) {
    if (typeof page.title === "string" && titleMatches(page.title, queryWords)) return page.title;
  }
  return null;
}

export async function wikipediaSearch(
  input: WikipediaSearchInput
): Promise<WikipediaSearchResult> {
  const notFound = () => new Error(`No Wikipedia article found for '${input.query}'`);
  // Only the search fallback can find too little time left, and running out
  // there is no evidence the article is missing.
  const request = requestBefore(
    Date.now() + WIKIPEDIA_DEADLINE_MS,
    () =>
      new Error(
        `Wikipedia lookup for '${input.query}' timed out: it is not an exact article title, and too ` +
          `little of the ${WIKIPEDIA_DEADLINE_MS / 1000}s limit was left to search for it. Retry, or ` +
          "pass the exact article title.",
      ),
  );

  // The summary endpoint takes an exact title, so a descriptive query ("Luo
  // people Kenya ethnic group history") 404s there; the first search hit whose
  // title the query spells out is the article it meant.
  let response = await request(summaryUrl(input.query));
  if (response.status === 404) {
    const title = await matchingSearchTitle(input.query, request);
    if (title === null) throw notFound();
    response = await request(summaryUrl(title));
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
