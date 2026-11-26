import { describeFetchError, fetchWithRetry } from "./http.js";
import type { WikiCollectionNotice } from "../types/wikiPage.js";

export const FS_WIKI_BASE = "https://www.familysearch.org/en/wiki";

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

/** At most this many linked collection pages are checked per read. */
export const COLLECTION_NOTICE_MAX_PAGES = 10;
/** Ten notices this long, with a full part, stay under the CLI spill line. */
export const COLLECTION_NOTICE_MAX_CHARS = 450;
const COLLECTION_PAGE_LINK =
  /https:\/\/www\.familysearch\.org\/en\/wiki\/([^\s()"#?]+?_-_FamilySearch_Historical_Records)(?=[\s()"#?]|$)/g;
const LEGACY_NOTICE = "**This is a Legacy Collection**";

/** The slugs of the collection pages a page links, in order, without repeats. */
export function collectionPageSlugs(content: string): string[] {
  const slugs: string[] = [];
  for (const match of content.matchAll(COLLECTION_PAGE_LINK)) {
    let slug = match[1];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      // A malformed escape is kept as written.
    }
    if (!slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

/** The Legacy-collection notice on a collection page, as plain text, or null when it has none. */
export function legacyNotice(content: string): string | null {
  const start = content.indexOf(LEGACY_NOTICE);
  if (start < 0) return null;
  const end = content.indexOf("\n", start);
  const line = content.slice(start, end < 0 ? undefined : end);
  const text = line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*+/g, "")
    .replace(/\s*\|\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= COLLECTION_NOTICE_MAX_CHARS) return text;
  // One character past the cap, so a sentence whose period is the cap's last character is kept.
  const sentenceEnd = text.slice(0, COLLECTION_NOTICE_MAX_CHARS + 1).lastIndexOf(". ");
  return sentenceEnd > 0 ? text.slice(0, sentenceEnd + 1) : text.slice(0, COLLECTION_NOTICE_MAX_CHARS);
}

/**
 * The linked collection pages that carry the Legacy notice. A failed or missing page is skipped,
 * and a lookup still running at `deadlineAt` is dropped.
 */
export async function collectionNoticesFor(
  content: string,
  baseUrl: string,
  deadlineAt: number
): Promise<WikiCollectionNotice[]> {
  const slugs = collectionPageSlugs(content).slice(0, COLLECTION_NOTICE_MAX_PAGES);
  const { results: found } = await settleByDeadline(
    slugs.map((slug) => async (): Promise<WikiCollectionNotice | null> => {
      try {
        const page = await fetchPage(baseUrl, slug);
        if (!page || typeof page.content !== "string") return null;
        const notice = legacyNotice(page.content);
        if (!notice) return null;
        const title = typeof page.title === "string" && page.title ? page.title : slug.replace(/_/g, " ");
        return { title, url: `${FS_WIKI_BASE}/${slug}`, notice };
      } catch {
        return null;
      }
    }),
    deadlineAt
  );
  return found.filter((n): n is WikiCollectionNotice => n !== null);
}
