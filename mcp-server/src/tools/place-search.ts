import type {
  FSPlaceSearchResponse,
  FSPlaceDescriptionResponse,
  WikipediaSummaryResponse,
  PlaceResult,
  PlaceSearchToolResponse,
} from "../types/place.js";

const FS_API_BASE = "https://api.familysearch.org/platform/places";
const WIKIPEDIA_API_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary";
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
function extractPrimaryId(
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

interface WikipediaResult {
  title: string;
  description: string;
  extract: string;
  thumbnailUrl?: string;
  wikipediaUrl?: string;
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

/**
 * Get Wikipedia summary for a place.
 * Returns null if article not found or on any error (graceful degradation).
 */
export async function getWikipediaSummary(title: string): Promise<WikipediaResult | null> {
  const url = `${WIKIPEDIA_API_BASE}/${encodeURIComponent(title)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      // Graceful degradation: Wikipedia is optional enrichment
      return null;
    }

    const data: WikipediaSummaryResponse = await response.json();

    return {
      title: data.title,
      description: data.description || "",
      extract: data.extract,
      thumbnailUrl: data.thumbnail?.source,
      wikipediaUrl: data.content_urls?.desktop.page,
    };
  } catch {
    // Graceful degradation: Wikipedia is optional enrichment
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

/**
 * Detect if input looks like a numeric ID
 */
function isNumericId(query: string): boolean {
  return /^\d+$/.test(query.trim());
}

export interface PlaceSearchToolInput {
  query: string;
}

function toPlaceResult(
  placeData: SearchPlaceResult | GetPlaceResult,
  wikiData: WikipediaResult | null
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

  if (wikiData) {
    result.wikipedia = {
      title: wikiData.title,
      description: wikiData.description,
      extract: wikiData.extract,
      thumbnailUrl: wikiData.thumbnailUrl,
    };
    result.wikipediaUrl = wikiData.wikipediaUrl;
  }

  return result;
}

export async function placeSearchTool(input: PlaceSearchToolInput): Promise<PlaceSearchToolResponse> {
  const { query } = input;

  if (isNumericId(query)) {
    const placeData = await getPlaceById(query);
    if (!placeData) {
      throw new Error(`Place not found: ${query}`);
    }
    const wikiData = await getWikipediaSummary(placeData.name);
    return { results: [toPlaceResult(placeData, wikiData)] };
  }

  const searchResults = await searchPlace(query);
  return { results: searchResults.map((r) => toPlaceResult(r, null)) };
}

/**
 * MCP Tool Schema for places tool
 */
export const placeSearchToolSchema = {
  name: "place_search",
  description:
    "Look up place information for genealogy research. " +
    "Pass a place name (e.g., 'Ohio', 'Madison') to get all matching places ranked by relevance — useful for disambiguating among places that share a name. " +
    "Pass a numeric FamilySearch rep ID (the `placeRepId` field from a previous places call) to get the full details for that single place, enriched with a Wikipedia summary. " +
    "Each result exposes two identifiers: `placeId` (the Primary ID, used by downstream tools like `population`) and `placeRepId` (the rep ID, used to re-query `places` lookup mode). " +
    "If you have a `placeId` from another tool's output and want to re-lookup the place, search by name instead — lookup mode does not accept Primary IDs.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A place name to search for (returns all matches), or a numeric FamilySearch rep ID (returns one enriched result). " +
          "The numeric form expects a `placeRepId` from a previous places call — not a `placeId`. " +
          "Passing a `placeId` (Primary) here will silently return a different place.",
      },
    },
    required: ["query"],
  },
};
