import { describeFetchError, fetchWithRetry } from "./http.js";

export interface PageApiResponse {
  title: string;
  content: string;
  source_url: string;
}

/**
 * GET {WIKI_API_URL}/page/{slug}.
 * Returns the response body on 200, null on 404 (so the caller can try
 * the next candidate), and throws on network failure or any other
 * non-OK status (a transient 5xx must not be silently treated as
 * "page not found"). Shared by `wiki_place_page` and `wiki_read`, and used by
 * `dev/check-wiki-paging.ts`, which reads a page whole through it.
 */
export async function fetchPage(
  baseUrl: string,
  slug: string
): Promise<PageApiResponse | null> {
  let response: Response;
  try {
    response = await fetchWithRetry(`${baseUrl}/page/${slug}`, {
      method: "GET",
      headers: { "User-Agent": "genealogy-mcp-server/0.0.1" },
    });
  } catch (error) {
    throw new Error(
      `Could not reach wiki-query-api at ${baseUrl} (${describeFetchError(error)}).`
    );
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`wiki-query-api error: ${response.status}`);
  }
  return (await response.json()) as PageApiResponse;
}
