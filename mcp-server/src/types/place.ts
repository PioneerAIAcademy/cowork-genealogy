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

// LLM-facing place shape: `place_search` / `place_search_all` always and only
// return standard places. `standardPlace` (the fully-qualified standardized
// name) is the canonical handle skills pass to every downstream tool; the rest
// is metadata. Deliberately omits the FamilySearch identifiers (`placeId`,
// `placeRepId`, parent rep IDs) and the relevance `score` — internal API
// details the model never sees.
export interface SimplifiedPlaceResult {
  standardPlace: string;
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
