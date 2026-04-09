// FamilySearch Place Search API Response Types
// GET https://api.familysearch.org/platform/places/search?q=name:{query}

export interface FSPlaceSearchEntry {
  id: string;
  score: number;
  content: {
    gedcomx: {
      places: Array<{
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
  links?: {
    children?: {
      href: string;
    };
  };
}

export interface FSPlaceDescriptionResponse {
  places?: FSPlace[];
}

// Wikipedia REST API Response Types
// GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}

export interface WikipediaSummaryResponse {
  title: string;
  description?: string;
  extract: string;
  coordinates?: {
    lat: number;
    lon: number;
  };
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  };
  content_urls?: {
    desktop: {
      page: string;
    };
  };
}

// Tool Output Types

export interface WikipediaData {
  title: string;
  description: string;
  extract: string;
  thumbnailUrl?: string;
}

export interface PlaceResult {
  // FamilySearch data
  placeId: string;
  name: string;
  fullName: string;
  type: string;
  latitude?: number;
  longitude?: number;
  dateRange?: string;
  parentPlaceId?: string;

  // Wikipedia data (if available)
  wikipedia?: WikipediaData;

  // Links
  familysearchUrl: string;
  wikipediaUrl?: string;
}
