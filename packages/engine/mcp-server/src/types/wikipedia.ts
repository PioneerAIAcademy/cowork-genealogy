// Wikipedia REST API Response
// GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}

export interface WikipediaAPIResponse {
  title: string;
  extract: string;
  content_urls: {
    desktop: {
      page: string;
    };
  };
}

// MediaWiki REST search, the fallback when a query is not an exact title
// GET https://en.wikipedia.org/w/rest.php/v1/search/page?q={query}&limit=5

export interface WikipediaPageSearchResponse {
  pages?: Array<{
    title?: string;
  }>;
}

// Tool Output

export interface WikipediaSearchResult {
  title: string;
  extract: string;
  url: string;
}
