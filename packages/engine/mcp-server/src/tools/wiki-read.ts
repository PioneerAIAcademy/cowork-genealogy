import type { Principal } from "../auth/principal.js";
import { getWikiApiUrl } from "../auth/config.js";
import { describeFetchError, fetchWithRetry } from "../utils/http.js";
import { pageText, requireWholeNumber } from "../utils/text-page.js";
import { stripWikiSidebar } from "../utils/wiki-sidebar.js";
import {
  WIKI_OFFSET_PROPERTY,
  WIKI_PAGE_MAX_CHARS,
  WIKI_PAGING_NOTE,
  WIKI_TOPIC_SUFFIXES,
  type WikiReadInput,
  type WikiReadResult,
} from "../types/wikiPage.js";
import {
  COLLECTION_NOTICE_MAX_CHARS,
  COLLECTION_NOTICE_MAX_PAGES,
  FS_WIKI_BASE,
  WIKI_EXTRAS_DEADLINE_MS,
  collectionNoticesFor,
  collectionPageSlugs,
  fetchPage,
  legacyNotice,
} from "../utils/wiki-page-fetch.js";

export { COLLECTION_NOTICE_MAX_CHARS, COLLECTION_NOTICE_MAX_PAGES, collectionPageSlugs, legacyNotice };

/**
 * For a regional record-type slug `{Region},_{Country}_{Suffix}`, the country's own
 * `{Country}_{Suffix}` slug; null for any other slug.
 */
export function countryTopicSlug(slug: string): string | null {
  for (const suffix of WIKI_TOPIC_SUFFIXES) {
    if (!slug.endsWith(`_${suffix}`)) continue;
    const prefix = slug.slice(0, -(suffix.length + 1));
    const cut = prefix.lastIndexOf(",_");
    if (cut < 0) return null;
    const country = prefix.slice(cut + 2);
    return country ? `${country}_${suffix}` : null;
  }
  return null;
}

/** The not-found message, naming the country's page when a regional one is missing and it exists. */
async function notFoundMessage(slug: string, baseUrl: string): Promise<string> {
  const base = `No wiki page found for "${slug}". The page may not exist in the corpus.`;
  const country = countryTopicSlug(slug);
  if (!country) return base;
  try {
    if ((await fetchPage(baseUrl, country)) !== null) {
      return `${base} The country's page exists: ${FS_WIKI_BASE}/${country}`;
    }
  } catch {
    // The hint is extra; a failed lookup leaves the plain message.
  }
  return base;
}

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

export async function wikiReadTool(input: WikiReadInput, principal: Principal): Promise<WikiReadResult> {
  const deadlineAt = Date.now() + WIKI_EXTRAS_DEADLINE_MS;
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
    throw new Error(await notFoundMessage(slug, baseUrl));
  }

  if (!response.ok) {
    throw new Error(`wiki-query-api error: ${response.status}`);
  }

  const data = (await response.json()) as PageApiResponse;
  const url = `${FS_WIKI_BASE}/${slug}`;
  // A body with no text passes through as it always did: there is nothing to cut. The sidebar
  // goes before the cut, so `totalChars` and `offset` count the text the caller reads.
  if (typeof data.content !== "string") return { url, content: data.content };
  const { content, paging } = pageText(stripWikiSidebar(data.content), offset, WIKI_PAGE_MAX_CHARS);
  const result: WikiReadResult = { url, content, ...paging };
  if (!offset) {
    const notices = await collectionNoticesFor(content, baseUrl, deadlineAt);
    if (notices.length) result.collectionNotices = notices;
  }
  return result;
}

export const wikiReadSchema = {
  name: "wiki_read",
  description:
    "Read any FamilySearch wiki page from the hosted wiki-query-api server. " +
    "Pass the full FamilySearch wiki URL; the page title is extracted and the corresponding markdown is fetched from the server. " +
    "Use this for specific wiki pages not covered by the country-specific tools. " +
    "On the first part, `collectionNotices` lists the FamilySearch collection pages the page links that carry a Legacy-collection notice (a partial index that is no longer added to or corrected), with that notice. " +
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
