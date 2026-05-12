import { getWikiApiUrl } from "../auth/config.js";
import type {
  WikiSearchAPIResponse,
  WikiSearchResult,
} from "../types/searchWiki.js";

export interface SearchWikiInput {
  query: string;
}

export async function searchWiki(
  input: SearchWikiInput
): Promise<WikiSearchResult> {
  const baseUrl = await getWikiApiUrl();
  const url = `${baseUrl}/search`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "genealogy-mcp-server/0.0.1",
      },
      body: JSON.stringify({ query: input.query }),
    });
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

export const searchWikiSchema = {
  name: "search_wiki",
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
