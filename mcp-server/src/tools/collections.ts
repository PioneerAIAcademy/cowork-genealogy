import { getValidToken } from "../auth/refresh.js";
import type {
  FSCollectionEntry,
  FSCollectionsResponse,
  Collection,
  CollectionsResult,
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
 * Parse a placeId chain like "1-33" into an array of numbers [1, 33].
 */
export function parsePlaceIdChain(chain: string): number[] {
  if (!chain) return [];
  return chain
    .split("-")
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));
}

/**
 * Filter collections to those whose placeId chain contains any of the requested IDs.
 */
export function filterByPlaceIds(
  collections: FSCollectionEntry[],
  placeIds: number[]
): FSCollectionEntry[] {
  const requested = new Set(placeIds);
  return collections.filter((c) => {
    const chain = parsePlaceIdChain(c.placeId ?? "");
    return chain.some((id) => requested.has(id));
  });
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

function toCollection(entry: FSCollectionEntry): Collection {
  return {
    id: entry.id,
    title: entry.title,
    dateRange: entry.coverageTemporal ?? "",
    placeIds: parsePlaceIdChain(entry.placeId ?? ""),
    recordCount: entry.recordCount ?? 0,
    personCount: entry.personCount ?? 0,
    imageCount: entry.imageCount ?? 0,
    url: `https://www.familysearch.org/search/collection/${entry.id}`,
  };
}

export interface CollectionsToolInput {
  placeIds: number[];
}

export async function collectionsTool(
  input: CollectionsToolInput
): Promise<CollectionsResult> {
  const token = await getValidToken();
  const data = await fetchAllCollections(token);
  const allCollections = data.collections ?? [];
  const filtered = filterByPlaceIds(allCollections, input.placeIds);
  const collections = filtered.map(toCollection);

  return {
    placeIds: input.placeIds,
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
    "List FamilySearch record collections for given place IDs, with record counts. " +
    "Use the places tool first to get place IDs.",
  inputSchema: {
    type: "object",
    properties: {
      placeIds: {
        type: "array",
        items: { type: "number" },
        description:
          "FamilySearch place IDs (e.g., [33, 351] for Alabama). Get these from the places tool.",
      },
    },
    required: ["placeIds"],
  },
};
