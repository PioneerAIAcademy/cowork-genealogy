import { getValidToken } from "../auth/refresh.js";
import type {
  FSCollectionData,
  FSCollectionEntry,
  FSCollectionsResponse,
  Collection,
  CollectionsResult,
} from "../types/collection.js";

const FS_COLLECTIONS_URL =
  "https://www.familysearch.org/service/search/hr/v2/collections";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

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
 * Get the place IDs from a collection's searchMetadata.
 */
function getPlaceIds(data: FSCollectionData): number[] {
  return data.searchMetadata?.[0]?.placeIds ?? [];
}

/**
 * Filter entries to those whose searchMetadata placeIds overlap with the requested set.
 */
export function filterByPlaceIds(
  entries: FSCollectionEntry[],
  placeIds: number[]
): FSCollectionData[] {
  const requested = new Set(placeIds);
  const results: FSCollectionData[] = [];

  for (const entry of entries) {
    const data = unwrapEntry(entry);
    if (!data) continue;
    const entryPlaceIds = getPlaceIds(data);
    if (entryPlaceIds.some((id) => requested.has(id))) {
      results.push(data);
    }
  }

  return results;
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
      "User-Agent": USER_AGENT,
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
 * Get a count from the content array by resourceType suffix.
 */
function getCount(data: FSCollectionData, typeSuffix: string): number {
  const entry = data.content?.find((c) => c.resourceType.endsWith(typeSuffix));
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
    placeIds: getPlaceIds(data),
    recordCount: getCount(data, "/Record"),
    personCount: getCount(data, "/Person"),
    imageCount: meta?.imageCount ?? 0,
    url: `https://www.familysearch.org/search/collection/${data.id}`,
  };
}

export interface CollectionsToolInput {
  query?: string;
  placeIds?: number[];
}

export async function collectionsTool(
  input: CollectionsToolInput
): Promise<CollectionsResult> {
  if (!input.query && (!input.placeIds || input.placeIds.length === 0)) {
    throw new Error(
      "Provide either a query (place name like \"Alabama\") or placeIds (internal collection IDs like [33])."
    );
  }

  const token = await getValidToken();
  const data = await fetchAllCollections(token);
  const entries = data.entries ?? [];

  let filtered: FSCollectionData[];
  if (input.query) {
    filtered = filterByQuery(entries, input.query);
  } else {
    filtered = filterByPlaceIds(entries, input.placeIds!);
  }

  const collections = filtered.map(toCollection);

  return {
    ...(input.query ? { query: input.query } : {}),
    ...(input.placeIds ? { placeIds: input.placeIds } : {}),
    matchingCollections: collections.length,
    collections,
  };
}

/**
 * MCP Tool Schema for collections tool
 */
export const collectionsToolSchema = {
  name: "collections",
  description:
    "List FamilySearch record collections for a place, with record counts. " +
    "Pass a place name as query (e.g., \"Alabama\") to search collection titles. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Place name to search for in collection titles (e.g., \"Alabama\", \"England\"). " +
          "This is the recommended parameter — use the places tool first to disambiguate if needed.",
      },
      placeIds: {
        type: "array",
        items: { type: "number" },
        description:
          "Internal FamilySearch collection place IDs. These are NOT the same as " +
          "place IDs from the places tool. Only use if you know the internal IDs.",
      },
    },
  },
};
