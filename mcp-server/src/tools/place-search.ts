import type {
  FSPlaceSearchResponse,
  FSPlaceDescriptionResponse,
  PlaceResult,
  SimplifiedPlaceResult,
  PlaceSearchToolResponse,
} from "../types/place.js";
import type { FSPlaceLookupResponse } from "../types/image-search.js";
import { BROWSER_USER_AGENT } from "../constants.js";

const FS_API_BASE = "https://api.familysearch.org/platform/places";
// FamilySearch's place service (the one the research-places website uses). It
// carries curated per-place external links — including the correct Wikipedia
// link — that the public /platform/places API does not expose.
const FS_PLACE_WS_UI_BASE =
  "https://www.familysearch.org/service/standards/place/ws-ui/places/reps";
const FS_PLACES_PUBLIC_BASE =
  "https://www.familysearch.org/en/research/places";
const FS_PRIMARY_IDENTIFIER_KEY = "http://gedcomx.org/Primary";

interface SearchPlaceResult {
  placeId?: string;     // Primary
  placeRepId: string;   // rep
  name: string;
  fullName: string;
  type: string;
  latitude?: number;
  longitude?: number;
  dateRange?: string;
  score?: number;
}

interface GetPlaceResult extends SearchPlaceResult {
  parentPlaceRepId?: string;
}

/**
 * Extract the bare Primary place ID from the identifiers map.
 * The Primary value is a URL of the form
 * "https://api.familysearch.org/platform/places/{primaryId}"; the bare ID
 * is the last path segment. Returns undefined if the Primary identifier
 * is missing or malformed.
 */
export function extractPrimaryId(
  identifiers: Record<string, string[]> | undefined
): string | undefined {
  const url = identifiers?.[FS_PRIMARY_IDENTIFIER_KEY]?.[0];
  if (!url) return undefined;
  const segments = url.split("/");
  const last = segments[segments.length - 1];
  return last || undefined;
}

function buildFamilysearchUrl(name: string, placeRepId: string): string {
  return `${FS_PLACES_PUBLIC_BASE}/?text=${encodeURIComponent(name)}&focusedId=${placeRepId}`;
}


export async function searchPlace(name: string): Promise<SearchPlaceResult[]> {
  const url = `${FS_API_BASE}/search?q=name:${encodeURIComponent(name)}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/x-gedcomx-atom+json",
    },
  });

  if (!response.ok) {
    throw new Error(`FamilySearch API error: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (!text || text.trim() === "") {
    return [];
  }

  const data: FSPlaceSearchResponse = JSON.parse(text);

  if (!data.entries || data.entries.length === 0) {
    return [];
  }

  return data.entries.map((entry) => {
    const place = entry.content.gedcomx.places[0];
    return {
      placeId: extractPrimaryId(place.identifiers),
      placeRepId: entry.id,
      name: place.display.name,
      fullName: place.display.fullName,
      type: place.display.type,
      latitude: place.latitude,
      longitude: place.longitude,
      dateRange: place.temporalDescription?.formal,
      score: entry.score,
    };
  });
}

/**
 * Get place details by Primary ID using FamilySearch API.
 * The Primary ID is the canonical place ID (placeId) returned by the places tool.
 * Returns null for 404 (invalid ID), throws for other errors.
 */
export async function getPlaceByPrimaryId(primaryId: string): Promise<GetPlaceResult | null> {
  const url = `${FS_API_BASE}/${primaryId}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`FamilySearch API error: ${response.status} ${response.statusText}`);
  }

  const data: FSPlaceDescriptionResponse = await response.json();

  // The response contains two objects: the place (names only, no display/coords)
  // and the place description (has display, latitude, longitude). Use the latter.
  const place = data.places?.find((p) => p.display != null);
  if (!place) {
    return null;
  }

  return {
    placeId: extractPrimaryId(place.identifiers),
    placeRepId: place.id,
    name: place.display.name,
    fullName: place.display.fullName,
    type: place.display.type,
    latitude: place.latitude,
    longitude: place.longitude,
    dateRange: place.temporalDescription?.formal,
    parentPlaceRepId: place.jurisdiction?.resourceId,
  };
}

/**
 * Get place details by ID using FamilySearch API.
 * Returns null for 404 (invalid ID), throws for other errors.
 */
export async function getPlaceById(id: string): Promise<GetPlaceResult | null> {
  const url = `${FS_API_BASE}/description/${id}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`FamilySearch API error: ${response.status} ${response.statusText}`);
  }

  const data: FSPlaceDescriptionResponse = await response.json();

  if (!data.places || data.places.length === 0) {
    return null;
  }

  const place = data.places[0];

  return {
    placeId: extractPrimaryId(place.identifiers),
    placeRepId: place.id,
    name: place.display.name,
    fullName: place.display.fullName,
    type: place.display.type,
    latitude: place.latitude,
    longitude: place.longitude,
    dateRange: place.temporalDescription?.formal,
    parentPlaceRepId: place.jurisdiction?.resourceId,
  };
}

interface FSPlaceAttribute {
  type?: { code?: string };
  url?: string;
}
interface FSPlaceAttributesResponse {
  attributes?: FSPlaceAttribute[];
}

/**
 * Get the curated Wikipedia URL FamilySearch stores for a place rep.
 *
 * FamilySearch keeps a per-place `WIKIPEDIA_LINK` attribute (e.g. Paris, Idaho
 * → en.wikipedia.org/wiki/Paris,_Idaho) on its place service — the same one the
 * research-places website uses. This is correct per-place, unlike a name-based
 * Wikipedia lookup. Returns null when the place has no such attribute or on any
 * error (graceful degradation — the Wikipedia link is optional enrichment).
 *
 * Note: places may also carry an `FS_WIKI_LINK` attribute (the FamilySearch
 * research wiki, a different thing); we take only `WIKIPEDIA_LINK`.
 */
export async function getPlaceWikipediaUrl(repId: string): Promise<string | null> {
  const url = `${FS_PLACE_WS_UI_BASE}/${encodeURIComponent(repId)}/attributes/`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
        "FS-User-Agent-Chain": "zion-user",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as FSPlaceAttributesResponse;
    const wiki = (data.attributes ?? []).find(
      (a) => a.type?.code === "WIKIPEDIA_LINK" && !!a.url
    );
    return wiki?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Get place details by Primary (canonical) place ID.
 * Returns null for 404 (invalid ID), throws for other errors.
 */
type PrimaryIdResponse = {
  places?: Array<{ id: string; names?: Array<{ lang: string; value: string }> }>;
};

async function fetchPrimaryIdResponse(primaryId: string): Promise<PrimaryIdResponse> {
  const url = `${FS_API_BASE}/${primaryId}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    if (response.status === 404) return {};
    throw new Error(`FamilySearch API error: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as PrimaryIdResponse;
}

export async function getPlaceCandidateNames(primaryId: string): Promise<string[]> {
  const data = await fetchPrimaryIdResponse(primaryId);
  if (!data.places?.length) return [];

  const allNames = data.places[0].names ?? [];

  // Keep proper-case English names: starts uppercase, not all-caps (filters abbreviations like PRT, MN)
  const properEnglish = allNames
    .filter(
      (n) =>
        n.lang === "en" &&
        n.value.length > 0 &&
        n.value[0] === n.value[0].toUpperCase() &&
        n.value !== n.value.toUpperCase()
    )
    .map((n) => n.value);

  // Deduplicate; single-word names first (more likely to be the canonical wiki page name)
  const seen = new Set<string>();
  const singleWord: string[] = [];
  const multiWord: string[] = [];
  for (const name of properEnglish) {
    if (seen.has(name)) continue;
    seen.add(name);
    (name.includes(" ") ? multiWord : singleWord).push(name);
  }
  return [...singleWord, ...multiWord];
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
    fullName: r.fullName,
    type: r.type,
    ...(r.dateRange !== undefined ? { dateRange: r.dateRange } : {}),
    ...(r.latitude !== undefined ? { latitude: r.latitude } : {}),
    ...(r.longitude !== undefined ? { longitude: r.longitude } : {}),
    familysearchUrl: r.familysearchUrl,
    ...(r.wikipediaUrl !== undefined ? { wikipediaUrl: r.wikipediaUrl } : {}),
  };
}

/**
 * Get every place representation ID for a Primary place ID via the
 * Place_resource endpoint (GET /platform/places/{pid}). The response lists the
 * bare place entry (id === pid, no `display`) followed by its representation
 * entries, each with `place.resourceId === pid`. We collect those rep IDs.
 *
 * Public (no auth) — the places endpoints accept anonymous requests.
 */
export async function getPlaceRepIds(pid: string): Promise<string[]> {
  const url = `${FS_API_BASE}/${encodeURIComponent(pid)}`;

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(
      `FamilySearch API error: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as FSPlaceLookupResponse;
  const reps = (data.places ?? []).filter((p) => p.place?.resourceId === pid);

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rep of reps) {
    if (rep.id && !seen.has(rep.id)) {
      seen.add(rep.id);
      ids.push(rep.id);
    }
  }
  return ids;
}

/**
 * Authenticated version: convert a placeId to numeric placeRepIds for use in
 * RMS search bodies (which require number[], not string[]). Used by
 * metadata_search and image_search.
 */
export async function placeIdToRepIds(
  placeId: string,
  token: string
): Promise<number[]> {
  const response = await fetch(`${FS_API_BASE}/${encodeURIComponent(placeId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `FamilySearch places API error: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as FSPlaceLookupResponse;
  const reps = (data.places ?? []).filter(
    (p) => p.place?.resourceId === placeId
  );

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const rep of reps) {
    const n = Number(rep.id);
    if (!Number.isNaN(n) && !seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }
  return ids;
}

// In-memory cache of internal place-search results, keyed by the normalized
// (placeName, contextName) pair. Lives for the life of the MCP server process;
// no TTL. There is no cross-session host storage (see CLAUDE.md), so this only
// memoizes within a single running server.
const placeSearchCache = new Map<string, PlaceResult[]>();

function placeSearchCacheKey(placeName: string, contextName?: string): string {
  return `${placeName.trim().toLowerCase()} ${(contextName ?? "").trim().toLowerCase()}`;
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
    "Each result includes the full jurisdictional name, place type, date range, " +
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
    "full jurisdictional name, place type, date range, coordinates, a FamilySearch " +
    "link, and (when available) a Wikipedia link.",
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
