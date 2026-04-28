import type {
  FSPlaceSearchResponse,
  FSPlaceDescriptionResponse,
  WikipediaSummaryResponse,
  PlaceResult,
  PlacesToolResponse,
} from "../types/place.js";

const FS_API_BASE = "https://api.familysearch.org/platform/places";
const WIKIPEDIA_API_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary";

interface SearchPlaceResult {
  placeId: string;
  name: string;
  fullName: string;
  type: string;
  latitude?: number;
  longitude?: number;
  dateRange?: string;
  score?: number;
}

interface GetPlaceResult extends SearchPlaceResult {
  parentPlaceId?: string;
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
      placeId: entry.id,
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
    placeId: place.id,
    name: place.display.name,
    fullName: place.display.fullName,
    type: place.display.type,
    latitude: place.latitude,
    longitude: place.longitude,
    dateRange: place.temporalDescription?.formal,
    parentPlaceId: place.jurisdiction?.resourceId,
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
 * Detect if input looks like a numeric ID
 */
function isNumericId(query: string): boolean {
  return /^\d+$/.test(query.trim());
}

export interface PlacesToolInput {
  query: string;
}

function toPlaceResult(
  placeData: SearchPlaceResult | GetPlaceResult,
  wikiData: WikipediaResult | null
): PlaceResult {
  const result: PlaceResult = {
    placeId: placeData.placeId,
    name: placeData.name,
    fullName: placeData.fullName,
    type: placeData.type,
    latitude: placeData.latitude,
    longitude: placeData.longitude,
    dateRange: placeData.dateRange,
    familysearchUrl: `https://www.familysearch.org/search/catalog/place/${placeData.placeId}`,
  };

  if (placeData.score !== undefined) {
    result.score = placeData.score;
  }

  if ("parentPlaceId" in placeData && placeData.parentPlaceId) {
    result.parentPlaceId = placeData.parentPlaceId;
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

export async function placesTool(input: PlacesToolInput): Promise<PlacesToolResponse> {
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
export const placesToolSchema = {
  name: "places",
  description:
    "Look up place information for genealogy research. " +
    "Pass a place name (e.g., 'Ohio', 'Madison') to get all matching places ranked by relevance — useful for disambiguating among places that share a name. " +
    "Pass a numeric FamilySearch place ID to get the full details for that single place, enriched with a Wikipedia summary.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A place name to search for (returns all matches), or a numeric FamilySearch place ID (returns one enriched result).",
      },
    },
    required: ["query"],
  },
};
