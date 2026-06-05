import TurndownService from "turndown";
import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import type {
  FSCollectionData,
  FSCollectionEntry,
  FSCollectionsResponse,
  FSCollectionDetailResponse,
  FSContentCount,
  Collection,
  CollectionsResult,
  CollectionDetailResult,
} from "../types/collection.js";

const FS_COLLECTIONS_URL =
  "https://www.familysearch.org/service/search/hr/v2/collections";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Module-level cache for the full collections response
let cache: {
  token: string;
  data: FSCollectionsResponse;
  fetchedAt: number;
} | null = null;

/**
 * Extract the FSCollectionData from a GEDCOMX-wrapped entry.
 * Returns null if the entry structure is unexpected.
 */
function unwrapEntry(entry: FSCollectionEntry): FSCollectionData | null {
  const collections = entry.content?.gedcomx?.collections;
  if (!collections || collections.length === 0) return null;
  return collections[0];
}

/**
 * Filter entries whose title contains the query string (case-insensitive).
 */
export function filterByQuery(
  entries: FSCollectionEntry[],
  query: string
): FSCollectionData[] {
  const lowerQuery = query.toLowerCase();
  const results: FSCollectionData[] = [];

  for (const entry of entries) {
    const data = unwrapEntry(entry);
    if (!data) continue;
    if (data.title.toLowerCase().includes(lowerQuery)) {
      results.push(data);
    }
  }

  return results;
}

/**
 * Fetch all collections from FamilySearch (cached for 1 hour per token).
 */
export async function fetchAllCollections(
  token: string
): Promise<FSCollectionsResponse> {
  if (
    cache &&
    cache.token === token &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache.data;
  }

  const url = `${FS_COLLECTIONS_URL}?count=5000&offset=0&facets=OFF`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(
      `FamilySearch collections API error: ${response.status} ${response.statusText}`
    );
  }

  const data: FSCollectionsResponse = await response.json();

  cache = { token, data, fetchedAt: Date.now() };
  return data;
}

/**
 * Clear the module-level cache (for testing).
 */
export function clearCollectionsCache(): void {
  cache = null;
}

/**
 * Get a count from a content array by resourceType suffix.
 */
function getCount(
  content: FSContentCount[] | undefined,
  typeSuffix: string
): number {
  const entry = content?.find((c) => c.resourceType.endsWith(typeSuffix));
  return entry?.count ?? 0;
}

function toCollection(data: FSCollectionData): Collection {
  const meta = data.searchMetadata?.[0];
  const startYear = meta?.startYear;
  const endYear = meta?.endYear;
  const dateRange =
    startYear != null && endYear != null
      ? `${startYear}-${endYear}`
      : startYear != null
        ? `${startYear}`
        : "";

  return {
    id: data.id,
    title: data.title,
    dateRange,
    recordCount: getCount(data.content, "/Record"),
    personCount: getCount(data.content, "/Person"),
    imageCount: meta?.imageCount ?? 0,
    url: `https://www.familysearch.org/search/collection/${data.id}`,
  };
}

// ---------- Detail mode helpers ----------

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});
turndown.remove(["head", "title", "style", "script"]);
turndown.addRule("dropHidden", {
  filter: (node) => {
    const style = (node as HTMLElement).getAttribute?.("style") ?? "";
    return /display\s*:\s*none/i.test(style);
  },
  replacement: () => "",
});

export function htmlToMarkdown(html: string | undefined | null): string | null {
  if (!html) return null;
  const md = turndown.turndown(html).trim();
  return md.length > 0 ? md : null;
}

export async function fetchCollectionDetail(
  token: string,
  id: string
): Promise<FSCollectionDetailResponse> {
  const url = `${FS_COLLECTIONS_URL}/${encodeURIComponent(id)}?embedWikiAboutCollection=true`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  if (response.status === 404) {
    throw new Error(
      `No FamilySearch collection found with id "${id}". Use collections({ query: ... }) to list available collections.`
    );
  }
  if (!response.ok) {
    throw new Error(
      `FamilySearch collection detail API error: ${response.status} ${response.statusText}`
    );
  }

  try {
    return (await response.json()) as FSCollectionDetailResponse;
  } catch {
    throw new Error("FamilySearch collection detail API returned malformed response.");
  }
}

// Convert documents[*].text from HTML to markdown when textType === "html".
// Per stakeholder direction (Dallan, 2026-05-12), only this field is converted;
// citations stay as HTML.
export function convertHtmlToMarkdown(
  response: FSCollectionDetailResponse
): FSCollectionDetailResponse {
  const documents = response.documents?.map((d) => {
    if (d.textType !== "html" || !d.text) return d;
    const md = htmlToMarkdown(d.text);
    return md == null ? d : { ...d, text: md, textType: "markdown" };
  });

  return { ...response, documents };
}

async function getCollectionDetail(id: string): Promise<CollectionDetailResult> {
  const token = await getValidToken();
  const detail = await fetchCollectionDetail(token, id);
  return convertHtmlToMarkdown(detail);
}

// ---------- Tool entry point ----------

export interface PlaceCollectionsToolInput {
  query?: string;
  id?: string;
}

export async function placeCollectionsTool(
  input: PlaceCollectionsToolInput
): Promise<CollectionsResult | CollectionDetailResult> {
  // Detail mode wins over list inputs.
  if (input.id) {
    return await getCollectionDetail(input.id);
  }

  if (!input.query) {
    throw new Error(
      "Provide one of: id (single-collection detail) or query (place name like \"Alabama\")."
    );
  }

  const token = await getValidToken();
  const data = await fetchAllCollections(token);
  const entries = data.entries ?? [];

  const filtered = filterByQuery(entries, input.query);
  const collections = filtered.map(toCollection);

  return {
    query: input.query,
    matchingCollections: collections.length,
    collections,
  };
}

/**
 * MCP Tool Schema for collections tool
 */
export const placeCollectionsToolSchema = {
  name: "place_collections",
  description:
    "List FamilySearch record collections for a place, OR get detailed " +
    "information about a single collection. Pass `query` (a place name like " +
    "\"Alabama\") to list collections, or `id` (a collection ID like \"1743384\") " +
    "to get the FamilySearch API response for that collection, with HTML " +
    "content (formal citation, FS Research Wiki page) converted to markdown. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Place name to search for in collection titles (e.g., \"Alabama\", \"England\"). " +
          "This is the recommended list-mode parameter — use the places tool first to disambiguate if needed.",
      },
      id: {
        type: "string",
        description:
          "FamilySearch collection ID (e.g., \"1743384\"). When set, returns the " +
          "FS API response for that collection (sourceDescriptions, documents, " +
          "collections), with HTML strings (citations, Research Wiki page) " +
          "converted to markdown. Use list mode (query) first to discover the ID.",
      },
    },
  },
};
