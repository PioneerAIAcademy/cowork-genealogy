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

// Tool Output

export interface WikipediaSearchResult {
  title: string;
  extract: string;
  url: string;
}
