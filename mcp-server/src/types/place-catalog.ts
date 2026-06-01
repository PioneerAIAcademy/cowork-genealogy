export interface PlaceCatalogInput {
  placeId?: string;
  keywords?: string;
  surname?: string;
  imageGroupNumber?: string;
  count?: number;
  offset?: number;
}

export interface CatalogHit {
  id: string;              // prefix preserved (e.g., "koha:1837843")
  title: string;
  authors: string[];
  holdings: string[];
  imageGroupNumbers: string[];  // DGS numbers from film_note; pass to fulltext_search / image_read
  record_searchable: boolean;
  fulltext_searchable: boolean;
  image_searchable: boolean;
  score: number;
  url: string;
}

export interface PlaceCatalogResult {
  placeId?: string;        // echoed only when caller provided it
  totalHits: number;
  returnedCount: number;
  offset: number;
  hits: CatalogHit[];
}

// Raw upstream search response — internal use only.
export interface CatalogApiResponse {
  searchHits: Array<{
    metadataHit: {
      metadata: {
        creator?: string[];
        identifier?: { value: string };
        title?: Array<{ value: string; lang?: string }>;
        repositoryCalls?: Array<{ title: string }>;
      };
      score: number;
    };
  }>;
  facets?: unknown[];
  totalHits: number;
  offset: number;
}

// Raw upstream item-detail response — internal use only. Only the
// fields the tool actually reads are typed; the rest of source.* is
// ignored. film_note may be a single object or an array depending on
// the format (probe finding: array for multi-roll microfilms, object
// for single-roll items). fs_indexed is sparse — omitted on items
// that are not indexed.
export interface CatalogItemDetailResponse {
  source?: {
    film_note?:
      | { digital_film_no?: string; fs_indexed?: "Y" | "N" }
      | Array<{ digital_film_no?: string; fs_indexed?: "Y" | "N" }>;
  };
}

// Raw upstream artifacts-permissions response. The tool checks
// whether any sourceDescription's rights[] includes
// "http://familysearch.org/v1/Allowed".
export interface ArtifactsPermissionsResponse {
  sourceDescriptions?: Array<{
    id?: string;
    rights?: string[];
  }>;
}

// Raw upstream fulltext-search response (subset). The tool only
// reads `results` to decide fulltext_searchable true/false.
export interface FulltextSearchResponse {
  results?: number;
}
