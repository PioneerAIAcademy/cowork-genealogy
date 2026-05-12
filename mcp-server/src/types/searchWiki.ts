// wiki-query-api /search response
// POST {WIKI_API_URL}/search

export interface WikiSearchResultItem {
  rank: number;
  relevance_score: number;
  chunk_text: string;
  page_title: string;
  section_heading: string;
  source_url: string;
}

export interface WikiSearchTiming {
  embed_ms: number;
  search_ms: number;
  rerank_ms: number;
}

export interface WikiSearchAPIResponse {
  query: string;
  total_chunks_searched: number;
  results: WikiSearchResultItem[];
  query_time_ms: number;
  timing: WikiSearchTiming;
}

// Tool Output (identical to API response for v1)

export type WikiSearchResult = WikiSearchAPIResponse;
