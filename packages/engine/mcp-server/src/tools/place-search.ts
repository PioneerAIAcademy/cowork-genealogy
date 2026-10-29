import type {
  PlaceResult,
  SimplifiedPlaceResult,
  PlaceSearchToolResponse,
} from "../types/place.js";
import {
  searchPlace,
  sanitizeForNameQuery,
  getPlaceById,
  getPlaceByPrimaryId,
  getPlaceRepIds,
  getPlaceWikipediaUrl,
  getPlaceCandidateNames,
  extractPrimaryId,
  type SearchPlaceResult,
  type GetPlaceResult,
} from "../utils/place-api.js";
import { deriveContextName, mapWithConcurrency, resolveStandardPlace } from "../utils/place-resolver.js";
import { placeAnswer } from "../utils/place-verdict.js";

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

/**
 * What the internal placeSearch returns. `matchType` is present only when the
 * results came from the fuzzy "sounds like" fallback after the exact query
 * matched nothing; on an exact hit the field is absent. Top-level rather than
 * per-result because every result in one outcome comes from one query.
 */
export interface PlaceSearchOutcome {
  results: PlaceResult[];
  matchType?: "fuzzy";
}

// A fuzzy result set is unbounded — live, a bare "Brixtol" returns 319
// entries, and each entry costs a description + Wikipedia fetch (uncapped,
// place_search_all exceeded the 60s bridge abort at ~1,500 requests). Exact
// results are never capped.
const MAX_FUZZY_ENTRIES = 10;

// In-memory cache of internal place-search results, keyed by the normalized
// (placeName, contextName) pair. Lives for the life of the MCP server process;
// no TTL. There is no cross-session host storage (see CLAUDE.md), so this only
// memoizes within a single running server. Stores the whole outcome, so a
// cache hit returns `matchType: "fuzzy"` again rather than dropping it.
const placeSearchCache = new Map<string, PlaceSearchOutcome>();

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
 * Steps: search (with a fuzzy fallback on zero exact hits) -> filter by
 * context (keep unfiltered if nothing matches) -> fetch a description per
 * surviving rep ID -> enrich with Wikipedia -> build the outcome. Outcomes
 * are cached by (placeName, contextName), match type included.
 */
export async function placeSearch(
  placeName: string,
  contextName?: string
): Promise<PlaceSearchOutcome> {
  if (!placeName || !placeName.trim()) {
    throw new Error("placeName is required");
  }
  const key = placeSearchCacheKey(placeName, contextName);
  const cached = placeSearchCache.get(key);
  if (cached) return cached;

  let entries = await searchPlace(placeName);
  let matchType: "fuzzy" | undefined;

  // A misspelled place returns zero exact hits and the agent has no other
  // automated way to identify it. Retry once with the Places API's fuzzy
  // ("sounds like") query, built from the leaf — the first comma segment of
  // the SANITIZED name — and only when that leaf is a single token: unquoted
  // multi-token fuzzy is an OR of tokens (the measured hazard in
  // place-api.ts's caller contract). Only an empty SUCCESS triggers it;
  // a thrown search error still propagates.
  if (entries.length === 0) {
    const leaf = sanitizeForNameQuery(placeName).split(",")[0].trim();
    if (leaf && !leaf.includes(" ")) {
      const fuzzyEntries = await searchPlace(leaf, { fuzzy: true });
      if (fuzzyEntries.length > 0) {
        entries = fuzzyEntries;
        matchType = "fuzzy";
      }
    }
  }

  // When no explicit context is supplied, derive one from a comma-qualified
  // placeName (e.g. "Bristol, England" -> "England"). This closes #609, where
  // a bare name search returns the top-scored hit in the wrong jurisdiction
  // (Bristol, Virginia). Safe by construction: an unmatched context leaves the
  // set unfiltered (see the fallback below).
  const context = (contextName?.trim() || deriveContextName(placeName))?.toLowerCase();
  if (context) {
    const filtered = entries.filter((e) =>
      e.fullName.toLowerCase().includes(context)
    );
    // Better to return extra results than zero: only narrow if something matched.
    if (filtered.length > 0) {
      entries = filtered;
    }
  }

  // Cap AFTER the context filter, so an in-context match is never cut, and
  // before the per-entry fetches. Entries arrive ranked and the intended
  // correction sits in the top few (live: Bristol is rank 2 for "Brixtol",
  // Sierokopaß rank 3 for "Sierkopas").
  const toFetch =
    matchType === "fuzzy" ? entries.slice(0, MAX_FUZZY_ENTRIES) : entries;
  const results = await mapWithConcurrency(toFetch, 8, (e) =>
    buildPlaceResult(e.placeRepId, e)
  );

  const outcome: PlaceSearchOutcome = {
    results,
    ...(matchType ? { matchType } : {}),
  };
  placeSearchCache.set(key, outcome);
  return outcome;
}

export async function placeSearchTool(
  input: PlaceSearchToolInput
): Promise<PlaceSearchToolResponse> {
  const { results, matchType } = await placeSearch(
    input.placeName,
    input.contextName
  );
  // What the writers store for the query text on a fact with none supplied that
  // cites no record (place-verdict.ts), read as tree_edit reads a fact's place:
  // `contextName` stands where the fact's other places stand, the context a
  // bare one-part place is resolved against.
  const context = input.contextName ? [input.contextName] : [];
  const answer = await placeAnswer(input.placeName, [], () =>
    resolveStandardPlace(input.placeName, { contextPlaces: context }),
  );
  const on =
    "on a fact that cites no record and has no standard_place supplied, " +
    (input.contextName ? `whose other places include '${input.contextName}'` : "with no other places");
  // Spread rather than assign: an exact hit carries no `matchType` key at all.
  return {
    results: results.map(simplifyPlaceResult),
    ...(matchType ? { matchType } : {}),
    verdict:
      answer.standardPlace !== null
        ? {
            standardPlace: answer.standardPlace,
            reason:
              `the writers store this standard_place for this place text ${on}. A supplied ` +
              "standard_place is kept instead when it is a FamilySearch standard place, as each result is",
          }
        : {
            standardPlace: null,
            reason: `the writers store no standard_place for this place text ${on}: ${answer.reason}`,
          },
  };
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
    new Set(base.results.map((r) => r.placeId).filter((p): p is string => !!p))
  );

  const repIdSets = await mapWithConcurrency(pids, 8, (pid) => getPlaceRepIds(pid));
  const repIds = Array.from(new Set(repIdSets.flat()));

  const built = await mapWithConcurrency(repIds, 8, async (repId) => {
    const placeData = await getPlaceById(repId);
    if (!placeData) return null;
    const wikipediaUrl = await getPlaceWikipediaUrl(repId);
    return simplifyPlaceResult(toPlaceResult(placeData, wikipediaUrl));
  });

  // Unflagged fuzzy results from the sibling tool are the failure the flag
  // exists to prevent — carry the base search's match type unchanged.
  return {
    results: built.filter((r): r is SimplifiedPlaceResult => r !== null),
    ...(base.matchType ? { matchType: base.matchType } : {}),
  };
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
    'If the response carries matchType: "fuzzy", the name you sent matched ' +
    "nothing exactly and these are sounds-alike corrections. Confirm one " +
    "before using it. " +
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
    "FamilySearch link, and (when available) a Wikipedia link. " +
    'If the response carries matchType: "fuzzy", the name you sent matched ' +
    "nothing exactly and these are sounds-alike corrections. Confirm one " +
    "before using it.",
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
