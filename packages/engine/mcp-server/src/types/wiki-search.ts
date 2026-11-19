// wiki-query-api /search response
// POST {WIKI_API_URL}/search

export interface WikiSearchAPIResultItem {
  rank: number;
  relevance_score: number;
  chunk_text: string;
  page_title: string;
  section_heading: string;
  source_url: string;
  /** "wiki" for wiki pages; the server can name another corpus. */
  source?: string;
  source_subtype?: string;
}

export interface WikiSearchTiming {
  embed_ms: number;
  search_ms: number;
  rerank_ms: number;
}

export interface WikiSearchAPIResponse {
  query: string;
  total_chunks_searched: number;
  results: WikiSearchAPIResultItem[];
  query_time_ms: number;
  timing: WikiSearchTiming;
}

// Tool output: the server's envelope, with each result cut to a reference
// (docs/specs/wiki-search-tool-spec.md, "Answer compaction").

export interface WikiSearchResultItem {
  page_title: string;
  section_heading: string;
  source_url: string;
  /** Present only when the server's `source` is not "wiki". */
  source?: string;
  /** Only with `includeText`, on a result whose text fit under the cap. */
  chunk_text?: string;
  /** Only with `includeText`: the 0-based index in `results` of the earlier
   *  result carrying identical text. Never set together with `chunk_text`. */
  same_text_as?: number;
}

export interface WikiSearchResult {
  query: string;
  total_chunks_searched: number;
  results: WikiSearchResultItem[];
  query_time_ms: number;
  timing: WikiSearchTiming;
}
