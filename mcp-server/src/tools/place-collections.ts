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
 * Derive the collection-title search term from a place. FamilySearch organizes
 * record collections at the state/province level for the United States, Canada,
 * and Mexico, and at the country level everywhere else. Given a `standardPlace`
 * (the fully-qualified name from place_search, e.g.
 * "Schuylkill, Pennsylvania, United States"), return the right title-match term:
 *   - United States   -> the state            ("Pennsylvania")
 *   - Canada / Mexico  -> "Country, State"      ("Canada, Ontario")
 *   - everywhere else  -> the country          ("France")
 *
 * The standardPlace format is comma-separated with the country last and the
 * state/province second-to-last. A free-text query that isn't a standardPlace
 * (no recognized country tail, e.g. "Census" or "Schuylkill County Pennsylvania")
 * passes through unchanged, so the tool still accepts an arbitrary place query.
 */
export function standardPlaceToCollectionsQuery(value: string): string {
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return value.trim();

  const country = parts[parts.length - 1];
  const state = parts.length >= 2 ? parts[parts.length - 2] : undefined;

  if (country === "United States") return state ?? country;
  if (country === "Canada" || country === "Mexico") {
    return state ? `${country}, ${state}` : country;
  }
  return country;
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
      `No FamilySearch collection found with id "${id}". Use place_collections({ standardPlace: ... }) to list available collections.`
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
  standardPlace?: string;
  id?: string;
}

export async function placeCollectionsTool(
  input: PlaceCollectionsToolInput
): Promise<CollectionsResult | CollectionDetailResult> {
  // Detail mode wins over list inputs.
  if (input.id) {
    return await getCollectionDetail(input.id);
  }

  if (!input.standardPlace) {
    throw new Error(
      "Provide one of: id (single-collection detail) or standardPlace (a place to list collections for, preferably the standardPlace from place_search)."
    );
  }

  // Derive the right collection scope (US state, "Country, State" for
  // Canada/Mexico, country otherwise). Free-text queries pass through.
  const query = standardPlaceToCollectionsQuery(input.standardPlace);

  const token = await getValidToken();
  const data = await fetchAllCollections(token);
  const entries = data.entries ?? [];

  const filtered = filterByQuery(entries, query);
  const collections = filtered.map(toCollection);

  return {
    standardPlace: input.standardPlace,
    query,
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
    "information about a single collection. For list mode, pass `standardPlace` " +
    "— preferably the standardized place name from place_search (e.g. " +
    "\"Schuylkill, Pennsylvania, United States\"); a plain place name also works. " +
    "FamilySearch organizes collections at the state/province level for the " +
    "United States, Canada, and Mexico, and at the country level everywhere else, " +
    "so results come back at that scope (the tool derives it from the place). " +
    "For detail mode, pass `id` (a collection ID like \"1743384\") to get the " +
    "FamilySearch API response for that collection, with HTML content (formal " +
    "citation, FS Research Wiki page) converted to markdown. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      standardPlace: {
        type: "string",
        description:
          "The place to list collections for — preferably the `standardPlace` " +
          "from place_search (e.g. \"Schuylkill, Pennsylvania, United States\"). " +
          "The tool derives the right collection scope (the US state, " +
          "\"Country, State\" for Canada/Mexico, or the country) and matches it " +
          "against collection titles. A plain place name works too.",
      },
      id: {
        type: "string",
        description:
          "FamilySearch collection ID (e.g., \"1743384\"). When set, returns the " +
          "FS API response for that collection (sourceDescriptions, documents, " +
          "collections), with HTML strings (citations, Research Wiki page) " +
          "converted to markdown. Use list mode (standardPlace) first to discover the ID.",
      },
    },
  },
};
