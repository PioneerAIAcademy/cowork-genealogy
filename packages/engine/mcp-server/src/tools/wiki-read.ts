import { getWikiApiUrl } from "../auth/config.js";
import type { WikiReadInput, WikiPageResult } from "../types/wikiPage.js";

const FS_WIKI_BASE = "https://www.familysearch.org/en/wiki";

function urlToSlug(url: string): string {
  const match = url.match(/\/wiki\/([^?#]+)/);
  if (!match) {
    throw new Error(`Not a valid FamilySearch wiki URL: ${url}`);
  }
  return decodeURIComponent(match[1]);
}

interface PageApiResponse {
  title: string;
  content: string;
  source_url: string;
}

export async function wikiReadTool(input: WikiReadInput): Promise<WikiPageResult> {
  const slug = urlToSlug(input.url);
  const baseUrl = await getWikiApiUrl();
  const pageUrl = `${baseUrl}/page/${slug}`;

  let response: Response;
  try {
    response = await fetch(pageUrl, {
      method: "GET",
      headers: { "User-Agent": "genealogy-mcp-server/0.0.1" },
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach wiki-query-api at ${baseUrl}. Is the server running? (${cause})`
    );
  }

  if (response.status === 404) {
    throw new Error(
      `No wiki page found for "${slug}". The page may not exist in the corpus.`
    );
  }

  if (!response.ok) {
    throw new Error(`wiki-query-api error: ${response.status}`);
  }

  const data = (await response.json()) as PageApiResponse;
  return { url: `${FS_WIKI_BASE}/${slug}`, content: data.content };
}

export const wikiReadSchema = {
  name: "wiki_read",
  description:
    "Read any FamilySearch wiki page from the hosted wiki-query-api server. " +
    "Pass the full FamilySearch wiki URL; the page title is extracted and the corresponding markdown is fetched from the server. " +
    "Use this for specific wiki pages not covered by the country-specific tools.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "The full URL of a FamilySearch wiki page " +
          "(e.g. https://www.familysearch.org/en/wiki/Portugal_Genealogy)",
      },
    },
    required: ["url"],
  },
};

export type { WikiReadInput };
