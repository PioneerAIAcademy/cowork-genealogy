import type { Principal } from "../auth/principal.js";
import { getWikiApiUrl } from "../auth/config.js";
import { describeFetchError, fetchWithRetry } from "../utils/http.js";
import { pageText, requireWholeNumber } from "../utils/text-page.js";
import {
  WIKI_OFFSET_PROPERTY,
  WIKI_PAGE_MAX_CHARS,
  WIKI_PAGING_NOTE,
  type WikiReadInput,
  type WikiPageResult,
} from "../types/wikiPage.js";

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

export async function wikiReadTool(input: WikiReadInput, principal: Principal): Promise<WikiPageResult> {
  // Argument checks first: a bad offset must not cost a request.
  const offset = input.offset === undefined ? undefined : requireWholeNumber("offset", input.offset, 0);
  const slug = urlToSlug(input.url);
  const baseUrl = await getWikiApiUrl(principal);
  const pageUrl = `${baseUrl}/page/${slug}`;

  let response: Response;
  try {
    response = await fetchWithRetry(pageUrl, {
      method: "GET",
      headers: { "User-Agent": "genealogy-mcp-server/0.0.1" },
    });
  } catch (error) {
    throw new Error(
      `Could not reach wiki-query-api at ${baseUrl} (${describeFetchError(error)}).`
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
  const url = `${FS_WIKI_BASE}/${slug}`;
  // A body with no text passes through as it always did: there is nothing to cut.
  if (typeof data.content !== "string") return { url, content: data.content };
  const { content, paging } = pageText(data.content, offset, WIKI_PAGE_MAX_CHARS);
  return { url, content, ...paging };
}

export const wikiReadSchema = {
  name: "wiki_read",
  description:
    "Read any FamilySearch wiki page from the hosted wiki-query-api server. " +
    "Pass the full FamilySearch wiki URL; the page title is extracted and the corresponding markdown is fetched from the server. " +
    "Use this for specific wiki pages not covered by the country-specific tools. " +
    WIKI_PAGING_NOTE,
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "The full URL of a FamilySearch wiki page " +
          "(e.g. https://www.familysearch.org/en/wiki/Portugal_Genealogy)",
      },
      offset: WIKI_OFFSET_PROPERTY,
    },
    required: ["url"],
  },
};

export type { WikiReadInput };
