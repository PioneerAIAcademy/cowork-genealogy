/**
 * Shared retry/backoff for the dev/ probe + explore scripts.
 *
 * WHY THIS EXISTS. Every `explore-*` / `probe-*` script that pages a throttling
 * FamilySearch endpoint hand-rolled the same retry loop, and the copies drifted
 * into two OPPOSITE bugs the compiler cannot see:
 *
 *   - `Number(res.headers.get("retry-after"))` reads `0` when the header is
 *     ABSENT — `Number(null) === 0`, and 0 is finite — so an
 *     `Number.isFinite(ra) ? ra : fallback` guard never reaches its fallback and
 *     the script retries almost instantly. The throttling it exists to survive
 *     gets worse, not better. (Retry-After is optional per RFC 7231, so absent
 *     is the common case.)
 *   - `Number(header ?? fallback)` fixes the absent case but returns NaN on the
 *     HTTP-date form RFC 7231 also allows, which `setTimeout` treats as 0ms —
 *     the same instant-retry failure by the other door.
 *
 * `retryAfterMs` handles BOTH: it honours only a numeric (delay-seconds)
 * Retry-After and returns null for an absent OR non-numeric one, matching the
 * parse in `probe-search-qualifiers.ts`'s `backoff()` — the one copy that was
 * correct, and which now shares this primitive.
 *
 * `fetchRetry` owns the retry LOOP, which is what lets one import fix three
 * separate defects at once: the attempt counter is local to a single call, so a
 * per-page caller can never accumulate 429s across pages into a spurious abort
 * (the counter-never-reset bug); and a caller that swaps a bare fetch for
 * `fetchRetry` gains 429 handling it never had.
 *
 * Uses `fetchWithTimeout`, never the global `fetch`: these scripts page for tens
 * of minutes against an endpoint that throttles, and Node's fetch never times
 * out on its own (`volume_search` hung 236 minutes on exactly this — CLAUDE.md).
 */
import { fetchWithTimeout } from "../src/utils/http.js";

/** Statuses worth retrying: throttling and transient gateway faults. A 400/401/404 will fail the same way, so it falls straight through. */
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Retry-After in milliseconds, or null when the server sent none usable.
 *
 * Only the numeric (delay-seconds) form is honoured; the HTTP-date form needs
 * clock-skew handling a dev script has no business guessing at, so it reads as
 * null and the caller falls back to exponential backoff. Returning null for
 * both absent and non-numeric is the whole point — see the file header.
 */
export function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (header === null) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed) * 1000;
}

export interface RetryOptions {
  /** Max retry attempts after the first try. Default 8. */
  maxRetries?: number;
  /** Base for exponential backoff when no numeric Retry-After is given. Default 1000ms. */
  baseMs?: number;
  /** Upper bound on any single wait, so one pathological header cannot stall a run. Default 30_000ms. */
  capMs?: number;
  /** Short label for the retry log line (e.g. the query or offset). */
  label?: string;
  /** Called once per retry, before the wait. For scripts that keep a run-wide retry tally. */
  onRetry?: (attempt: number, res: Response) => void;
}

/** The wait before the next attempt: a numeric Retry-After if given, else capped exponential backoff. */
export function backoffDelayMs(
  res: Response,
  attempt: number,
  { baseMs = 1000, capMs = 30_000 }: Pick<RetryOptions, "baseMs" | "capMs"> = {},
): number {
  return Math.min(retryAfterMs(res) ?? baseMs * 2 ** attempt, capMs);
}

/**
 * `fetchWithTimeout` + automatic retry of RETRYABLE_STATUS. Returns the FINAL
 * Response — the caller still owns every non-retryable decision: a 204 that
 * means "zero results", a 400 that is itself the finding, an exhausted-retry
 * 429 the caller wants to treat as a bounded null rather than a partial read.
 *
 * The attempt counter is local to this call ON PURPOSE: a caller paging with a
 * fresh `fetchRetry` per page cannot leak 429s from one page into the next.
 */
export async function fetchRetry(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const { maxRetries = 8, baseMs, capMs, label, onRetry } = opts;
  let res = await fetchWithTimeout(url, init);
  for (
    let attempt = 0;
    RETRYABLE_STATUS.has(res.status) && attempt < maxRetries;
    attempt++
  ) {
    onRetry?.(attempt, res);
    const delay = backoffDelayMs(res, attempt, { baseMs, capMs });
    console.error(
      `    [retry ${attempt + 1}/${maxRetries}] HTTP ${res.status} — waiting ${delay}ms` +
        (label ? ` — ${label.slice(0, 80)}` : ""),
    );
    await sleep(delay);
    res = await fetchWithTimeout(url, init);
  }
  return res;
}
