import { getWikiApiUrl } from "../auth/config.js";
import { fetchWithTimeout } from "../utils/http.js";
import type {
  WikiSearchAPIResponse,
  WikiSearchResult,
} from "../types/wiki-search.js";

// One un-retried RAG request against the sidecar, and retrieval over the wiki
// corpus is slower than a plain JSON read: calls have been measured up to 56s,
// with 5 of 47 above the 30s default. Nothing retries behind this one.
const WIKI_SEARCH_TIMEOUT_MS = 60_000;

export interface WikiSearchInput {
  query: string;
}

export async function wikiSearch(
  input: WikiSearchInput
): Promise<WikiSearchResult> {
  const baseUrl = await getWikiApiUrl();
  const url = `${baseUrl}/search`;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "genealogy-mcp-server/0.0.1",
        },
        body: JSON.stringify({ query: input.query }),
      },
      WIKI_SEARCH_TIMEOUT_MS
    );
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach wiki-query-api at ${baseUrl}. Is the server running? (${cause})`
    );
  }

  if (!response.ok) {
    throw new Error(`wiki-query-api error: ${response.status}`);
  }

  const data = (await response.json()) as WikiSearchAPIResponse;
  return data;
}

export const wikiSearchSchema = {
  name: "wiki_search",
  description:
    "Search the FamilySearch Wiki for genealogy guidance. Use this when the user asks how to find records (birth, marriage, death, census, immigration, military, church), how to research ancestors from a specific country or region, or how to use FamilySearch resources. Returns up to 20 wiki sections with source URLs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "A natural-language genealogy question",
      },
    },
    required: ["query"],
  },
};
