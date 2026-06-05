import type {
  PlaceResult,
  SimplifiedPlaceResult,
  PlaceSearchToolResponse,
} from "../types/place.js";
import {
  searchPlace,
  getPlaceById,
  getPlaceByPrimaryId,
  getPlaceRepIds,
  getPlaceWikipediaUrl,
  getPlaceCandidateNames,
  extractPrimaryId,
  type SearchPlaceResult,
  type GetPlaceResult,
} from "../utils/place-api.js";

// Re-export the low-level FamilySearch places fetchers so existing tool/test
// imports keep resolving from here. Their implementations live in
// `utils/place-api.ts` — the low-level layer the resolver also builds on.
export {
  searchPlace,
  getPlaceById,
  getPlaceByPrimaryId,
  getPlaceRepIds,
  getPlaceWikipediaUrl,
  getPlaceCandidateNames,
  extractPrimaryId,
};

const FS_PLACES_PUBLIC_BASE =
  "https://www.familysearch.org/en/research/places";

function buildFamilysearchUrl(name: string, placeRepId: string): string {
  return `${FS_PLACES_PUBLIC_BASE}/?text=${encodeURIComponent(name)}&focusedId=${placeRepId}`;
}

export interface PlaceSearchToolInput {
  placeName: string;
  contextName?: string;
}

export type PlaceSearchAllToolInput = PlaceSearchToolInput;

function toPlaceResult(
  placeData: SearchPlaceResult | GetPlaceResult,
  wikipediaUrl: string | null
): PlaceResult {
  const result: PlaceResult = {
    ...(placeData.placeId ? { placeId: placeData.placeId } : {}),
    placeRepId: placeData.placeRepId,
    name: placeData.name,
    fullName: placeData.fullName,
    type: placeData.type,
    latitude: placeData.latitude,
    longitude: placeData.longitude,
    dateRange: placeData.dateRange,
    familysearchUrl: buildFamilysearchUrl(placeData.name, placeData.placeRepId),
  };

  if (placeData.score !== undefined) {
    result.score = placeData.score;
  }

  if ("parentPlaceRepId" in placeData && placeData.parentPlaceRepId) {
    result.parentPlaceRepId = placeData.parentPlaceRepId;
  }

  if (wikipediaUrl) {
    result.wikipediaUrl = wikipediaUrl;
  }

  return result;
}

/**
 * Project a full (internal) PlaceResult down to the LLM-facing shape,
 * dropping all FamilySearch identifiers and the relevance score. Optional
 * fields are omitted when absent so the JSON stays clean.
 */
export function simplifyPlaceResult(r: PlaceResult): SimplifiedPlaceResult {
  return {
    standardPlace: r.fullName,
    type: r.type,
    ...(r.dateRange !== undefined ? { dateRange: r.dateRange } : {}),
    ...(r.latitude !== undefined ? { latitude: r.latitude } : {}),
    ...(r.longitude !== undefined ? { longitude: r.longitude } : {}),
    familysearchUrl: r.familysearchUrl,
    ...(r.wikipediaUrl !== undefined ? { wikipediaUrl: r.wikipediaUrl } : {}),
  };
}

// In-memory cache of internal place-search results, keyed by the normalized
// (placeName, contextName) pair. Lives for the life of the MCP server process;
// no TTL. There is no cross-session host storage (see CLAUDE.md), so this only
// memoizes within a single running server.
const placeSearchCache = new Map<string, PlaceResult[]>();

function placeSearchCacheKey(placeName: string, contextName?: string): string {
  return `${placeName.trim().toLowerCase()} ${(contextName ?? "").trim().toLowerCase()}`;
}

/** Test-only: empty the in-memory cache so cases don't bleed into each other. */
export function __clearPlaceSearchCacheForTests(): void {
  placeSearchCache.clear();
}

/**
 * Build a full PlaceResult from a rep ID: fetch its description, enrich with
 * Wikipedia, and assemble. Falls back to `searchFallback` (the search-entry
 * data) when the description endpoint 404s, so a place is never dropped.
 */
async function buildPlaceResult(
  repId: string,
  searchFallback: SearchPlaceResult
): Promise<PlaceResult> {
  const placeData = (await getPlaceById(repId)) ?? searchFallback;
  const wikipediaUrl = await getPlaceWikipediaUrl(placeData.placeRepId);
  return toPlaceResult(placeData, wikipediaUrl);
}

/**
 * Internal place search. The single entry point any tool should call when it
 * needs FamilySearch place data or IDs for a named place.
 *
 * @param placeName   the place to search for (e.g. "Paris")
 * @param contextName optional name of a higher-level place to disambiguate by
 *                    (e.g. "Idaho" or "France"); matched as a case-insensitive
 *                    substring of each candidate's full jurisdictional name
 *
 * Steps: search -> filter by context (keep unfiltered if nothing matches) ->
 * fetch a description per surviving rep ID -> enrich with Wikipedia -> build
 * PlaceResult[]. Results are cached by (placeName, contextName).
 */
export async function placeSearch(
  placeName: string,
  contextName?: string
): Promise<PlaceResult[]> {
  const key = placeSearchCacheKey(placeName, contextName);
  const cached = placeSearchCache.get(key);
  if (cached) return cached;

  let entries = await searchPlace(placeName);

  const context = contextName?.trim().toLowerCase();
  if (context) {
    const filtered = entries.filter((e) =>
      e.fullName.toLowerCase().includes(context)
    );
    // Better to return extra results than zero: only narrow if something matched.
    if (filtered.length > 0) {
      entries = filtered;
    }
  }

  const results = await Promise.all(
    entries.map((e) => buildPlaceResult(e.placeRepId, e))
  );

  placeSearchCache.set(key, results);
  return results;
}

export async function placeSearchTool(
  input: PlaceSearchToolInput
): Promise<PlaceSearchToolResponse> {
  const results = await placeSearch(input.placeName, input.contextName);
  return { results: results.map(simplifyPlaceResult) };
}

/**
 * place_search_all: every jurisdiction a place has belonged to over time.
 *
 * Runs the internal placeSearch, then for each distinct Primary place ID
 * expands to all of its representations (Place_resource), de-duplicates the rep
 * IDs across places, fetches a description + Wikipedia for each, and returns the
 * simplified, ID-free results.
 */
export async function placeSearchAllTool(
  input: PlaceSearchAllToolInput
): Promise<PlaceSearchToolResponse> {
  const base = await placeSearch(input.placeName, input.contextName);

  const pids = Array.from(
    new Set(base.map((r) => r.placeId).filter((p): p is string => !!p))
  );

  const repIdSets = await Promise.all(pids.map((pid) => getPlaceRepIds(pid)));
  const repIds = Array.from(new Set(repIdSets.flat()));

  const built = await Promise.all(
    repIds.map(async (repId) => {
      const placeData = await getPlaceById(repId);
      if (!placeData) return null;
      const wikipediaUrl = await getPlaceWikipediaUrl(repId);
      return simplifyPlaceResult(toPlaceResult(placeData, wikipediaUrl));
    })
  );

  return { results: built.filter((r): r is SimplifiedPlaceResult => r !== null) };
}

/**
 * MCP Tool Schema for place_search
 */
export const placeSearchToolSchema = {
  name: "place_search",
  description:
    "Look up places for genealogy research by name. " +
    "Pass a place name (e.g., 'Paris', 'Madison') to get all matching places. " +
    "Optionally pass a higher-level place as context to disambiguate among places " +
    "that share a name — e.g. placeName 'Paris' with contextName 'Idaho' returns " +
    "Paris in Idaho, while contextName 'France' returns Paris in France. " +
    "Each result includes the standardized place name (standardPlace), place type, date range," +
    "coordinates, a FamilySearch link, and (when available) a Wikipedia link. " +
    "Use place_search_all instead when you need every historical jurisdiction a " +
    "place has belonged to over time.",
  inputSchema: {
    type: "object",
    properties: {
      placeName: {
        type: "string",
        description:
          "The place name to search for (e.g., 'Paris', 'Schuylkill County').",
      },
      contextName: {
        type: "string",
        description:
          "Optional name of a higher-level place (state, country, etc.) used to " +
          "disambiguate. Matches places whose full name contains this text. If " +
          "nothing matches, the unfiltered results are returned instead.",
      },
    },
    required: ["placeName"],
  },
};

/**
 * MCP Tool Schema for place_search_all
 */
export const placeSearchAllToolSchema = {
  name: "place_search_all",
  description:
    "Look up a place and return every jurisdiction it has belonged to over time. " +
    "Takes the same input as place_search (a place name plus an optional " +
    "higher-level place as context). Where place_search returns the matching " +
    "place(s), place_search_all additionally expands each match to all of its " +
    "historical representations — useful when boundaries or parent jurisdictions " +
    "changed across the time period you're researching. Each result includes the " +
    "standardized place name (standardPlace), place type, date range, coordinates, a " +
    "FamilySearch link, and (when available) a Wikipedia link.",
  inputSchema: {
    type: "object",
    properties: {
      placeName: {
        type: "string",
        description:
          "The place name to search for (e.g., 'Paris', 'Schuylkill County').",
      },
      contextName: {
        type: "string",
        description:
          "Optional name of a higher-level place (state, country, etc.) used to " +
          "disambiguate. Matches places whose full name contains this text. If " +
          "nothing matches, the unfiltered results are returned instead.",
      },
    },
    required: ["placeName"],
  },
};
