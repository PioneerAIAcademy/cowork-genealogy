// FamilySearch Place Search API Response Types
// GET https://api.familysearch.org/platform/places/search?q=name:{query}

export interface FSPlaceSearchEntry {
  id: string;
  score: number;
  content: {
    gedcomx: {
      places: Array<{
        id?: string;
        display: {
          name: string;
          fullName: string;
          type: string;
        };
        latitude?: number;
        longitude?: number;
        temporalDescription?: {
          formal: string;
        };
        identifiers?: Record<string, string[]>;
      }>;
    };
  };
  links?: {
    description?: {
      href: string;
    };
  };
}

export interface FSPlaceSearchResponse {
  entries?: FSPlaceSearchEntry[];
}

// FamilySearch Place Description API Response Types
// GET https://api.familysearch.org/platform/places/description/{id}

export interface FSPlace {
  id: string;
  display: {
    name: string;
    fullName: string;
    type: string;
  };
  latitude?: number;
  longitude?: number;
  temporalDescription?: {
    formal: string;
  };
  names?: Array<{
    lang: string;
    value: string;
  }>;
  jurisdiction?: {
    resourceId: string;
  };
  identifiers?: Record<string, string[]>;
  links?: {
    children?: {
      href: string;
    };
  };
}

export interface FSPlaceDescriptionResponse {
  places?: FSPlace[];
}

// Tool Output Types

export interface PlaceResult {
  // FamilySearch data
  placeId?: string;       // Primary identifier — pass to downstream tools (population, etc.)
  placeRepId: string;     // rep identifier — pass to places lookup mode; used for familysearchUrl
  name: string;
  fullName: string;
  type: string;
  latitude?: number;
  longitude?: number;
  dateRange?: string;
  parentPlaceRepId?: string;
  score?: number;

  // Links
  familysearchUrl: string;
  wikipediaUrl?: string;       // FamilySearch's curated WIKIPEDIA_LINK attribute
}

// LLM-facing place shape. Deliberately omits the FamilySearch identifiers
// (`placeId`, `placeRepId`, parent rep IDs) and the relevance `score` — those
// are internal API details the model never sees. Both `place_search` and
// `place_search_all` return arrays of these.
export interface SimplifiedPlaceResult {
  fullName: string;
  type: string;
  dateRange?: string;
  latitude?: number;
  longitude?: number;
  familysearchUrl: string;
  wikipediaUrl?: string;
}

export interface PlaceSearchToolResponse {
  results: SimplifiedPlaceResult[];
}
