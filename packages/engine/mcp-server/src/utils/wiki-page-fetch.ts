import { describeFetchError, fetchWithRetry } from "./http.js";

export interface PageApiResponse {
  title: string;
  content: string;
  source_url: string;
}

/**
 * How long after a wiki tool call starts its best-effort extra lookups may still run. It sits
 * under the Cowork bridge's 60 s abort, so a stalled wiki host costs the extras, never the call.
 */
export const WIKI_EXTRAS_DEADLINE_MS = 50_000;
/** Node fires a longer `setTimeout` delay at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Runs `tasks` together and returns once all settle or `deadlineAt` (epoch ms) passes, whichever
 * is first. `results[i]` is task i's value, or null when it threw or had not finished; `timedOut`
 * says the deadline cut the run short. A task can poll `stopped()` to skip work not yet started.
 */
export async function settleByDeadline<T>(
  tasks: ((stopped: () => boolean) => Promise<T | null>)[],
  deadlineAt: number
): Promise<{ results: (T | null)[]; timedOut: boolean }> {
  const results: (T | null)[] = tasks.map(() => null);
  let timedOut = false;
  const stopped = () => timedOut;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, Math.min(MAX_TIMER_MS, Math.max(0, deadlineAt - Date.now())));
  });
  const all = Promise.all(
    tasks.map(async (task, i) => {
      let value: T | null = null;
      try {
        value = await task(stopped);
      } catch {
        value = null;
      }
      if (!timedOut) results[i] = value;
    })
  );
  try {
    await Promise.race([all, deadline]);
  } finally {
    clearTimeout(timer);
  }
  return { results: [...results], timedOut };
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
