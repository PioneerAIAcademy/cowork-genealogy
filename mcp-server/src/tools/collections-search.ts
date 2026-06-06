import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import type {
  FSCollectionData,
  FSCollectionEntry,
  FSCollectionsResponse,
  FSContentCount,
  Collection,
  CollectionsSearchResult,
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

// A collection overlaps [startYear, endYear] when its searchMetadata year span
// intersects the window. A collection with no year span (undated) is always
// included, mirroring the rest of the place-search family.
function overlapsYears(
  data: FSCollectionData,
  startYear: number,
  endYear: number
): boolean {
  const meta = data.searchMetadata?.[0];
  const cStart = meta?.startYear;
  const cEnd = meta?.endYear;
  if (cStart == null && cEnd == null) return true;
  const effectiveStart = cStart ?? (cEnd as number);
  const effectiveEnd = cEnd ?? (cStart as number);
  return effectiveStart <= endYear && effectiveEnd >= startYear;
}

// ---------- Tool entry point ----------

export interface CollectionsSearchInput {
  standardPlace: string;
  startYear?: number;
  endYear?: number;
}

export async function collectionsSearchTool(
  input: CollectionsSearchInput
): Promise<CollectionsSearchResult> {
  if (!input.standardPlace) {
    throw new Error(
      "collections_search requires a standardPlace (preferably the standardPlace from place_search)."
    );
  }

  const hasStart = input.startYear != null;
  const hasEnd = input.endYear != null;
  const startYear = hasStart ? Number(input.startYear) : undefined;
  const endYear = hasEnd ? Number(input.endYear) : undefined;
  if (startYear != null && endYear != null && endYear < startYear) {
    throw new Error("endYear must be greater than or equal to startYear.");
  }

  // Derive the right collection scope (US state, "Country, State" for
  // Canada/Mexico, country otherwise). Free-text queries pass through.
  const scope = standardPlaceToCollectionsQuery(input.standardPlace);

  const token = await getValidToken();
  const data = await fetchAllCollections(token);
  const entries = data.entries ?? [];

  // Title match first; totalForPlace is this count, BEFORE any date filter.
  const matchedByScope = filterByQuery(entries, scope);

  const dateFiltered =
    startYear == null && endYear == null
      ? matchedByScope
      : matchedByScope.filter((c) =>
          overlapsYears(
            c,
            startYear ?? Number.NEGATIVE_INFINITY,
            endYear ?? Number.POSITIVE_INFINITY
          )
        );

  const results = dateFiltered.map(toCollection);

  const query: CollectionsSearchResult["query"] = {
    standardPlace: input.standardPlace,
  };
  if (startYear != null) query.startYear = startYear;
  if (endYear != null) query.endYear = endYear;

  return {
    query,
    scope,
    totalForPlace: matchedByScope.length,
    results,
  };
}

/**
 * MCP Tool Schema for collections_search (list mode).
 */
export const collectionsSearchToolSchema = {
  name: "collections_search",
  description:
    "List FamilySearch record collections for a place. Pass `standardPlace` — " +
    "preferably the standardized place name from place_search (e.g. " +
    "\"Schuylkill, Pennsylvania, United States\"); a plain place name also works. " +
    "FamilySearch organizes collections at the state/province level for the " +
    "United States, Canada, and Mexico, and at the country level everywhere else, " +
    "so results come back at that scope (the tool derives it and returns it as " +
    "`scope`). Optionally filter by startYear/endYear to keep only collections " +
    "whose date range overlaps that window. Returns the full matched set in one " +
    "response (no pagination). To fetch full detail for one collection, pass its " +
    "id to collection_read. " +
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
      startYear: {
        type: "integer",
        description:
          "Earliest year of interest (inclusive). Omit for all periods.",
      },
      endYear: {
        type: "integer",
        description:
          "Latest year of interest (inclusive). Must be >= startYear. Omit for all periods.",
      },
    },
    required: ["standardPlace"],
  },
};
