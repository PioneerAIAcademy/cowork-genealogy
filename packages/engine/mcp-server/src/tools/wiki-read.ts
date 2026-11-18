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
  type WikiCollectionNotice,
} from "../types/wikiPage.js";
import { WIKI_EXTRAS_DEADLINE_MS, fetchPage, settleByDeadline } from "../utils/wiki-page-fetch.js";

const FS_WIKI_BASE = "https://www.familysearch.org/en/wiki";

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

/** At most this many linked collection pages are checked per read. */
export const COLLECTION_NOTICE_MAX_PAGES = 10;
/** Ten notices this long, with a full part, stay under the CLI spill line. */
export const COLLECTION_NOTICE_MAX_CHARS = 450;
const COLLECTION_PAGE_LINK =
  /https:\/\/www\.familysearch\.org\/en\/wiki\/([^\s()"#?]+?_-_FamilySearch_Historical_Records)(?=[\s()"#?]|$)/g;
const LEGACY_NOTICE = "**This is a Legacy Collection**";

/** The slugs of the collection pages a page links, in order, without repeats. */
export function collectionPageSlugs(content: string): string[] {
  const slugs: string[] = [];
  for (const match of content.matchAll(COLLECTION_PAGE_LINK)) {
    let slug = match[1];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      // A malformed escape is kept as written.
    }
    if (!slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

/** The Legacy-collection notice on a collection page, as plain text, or null when it has none. */
export function legacyNotice(content: string): string | null {
  const start = content.indexOf(LEGACY_NOTICE);
  if (start < 0) return null;
  const end = content.indexOf("\n", start);
  const line = content.slice(start, end < 0 ? undefined : end);
  const text = line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*+/g, "")
    .replace(/\s*\|\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= COLLECTION_NOTICE_MAX_CHARS) return text;
  // One character past the cap, so a sentence whose period is the cap's last character is kept.
  const sentenceEnd = text.slice(0, COLLECTION_NOTICE_MAX_CHARS + 1).lastIndexOf(". ");
  return sentenceEnd > 0 ? text.slice(0, sentenceEnd + 1) : text.slice(0, COLLECTION_NOTICE_MAX_CHARS);
}

/**
 * The linked collection pages that carry the Legacy notice. A failed or missing page is skipped,
 * and a lookup still running at `deadlineAt` is dropped.
 */
async function collectionNoticesFor(
  content: string,
  baseUrl: string,
  deadlineAt: number
): Promise<WikiCollectionNotice[]> {
  const slugs = collectionPageSlugs(content).slice(0, COLLECTION_NOTICE_MAX_PAGES);
  const { results: found } = await settleByDeadline(
    slugs.map((slug) => async (): Promise<WikiCollectionNotice | null> => {
      try {
        const page = await fetchPage(baseUrl, slug);
        if (!page || typeof page.content !== "string") return null;
        const notice = legacyNotice(page.content);
        if (!notice) return null;
        const title = typeof page.title === "string" && page.title ? page.title : slug.replace(/_/g, " ");
        return { title, url: `${FS_WIKI_BASE}/${slug}`, notice };
      } catch {
        return null;
      }
    }),
    deadlineAt
  );
  return found.filter((n): n is WikiCollectionNotice => n !== null);
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
