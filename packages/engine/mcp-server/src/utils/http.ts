// Shared fetch wrapper with a bounded timeout. Node's global fetch has no
// timeout of its own — if an upstream connection (FamilySearch behind
// Imperva, the wiki-query-api sidecar, OpenRouter) stalls after accepting the
// TCP connection instead of erroring, a bare `fetch()` call hangs forever.
// Every tool that talks to an external service should call this instead of
// the global `fetch` directly.
//
// The budget covers headers AND body. `AbortSignal.timeout` runs from the
// moment it is created and keeps running after the headers arrive, so a body
// that is still streaming when it fires is aborted mid-read. That rejection
// comes out of `response.json()` / `.text()` / `.arrayBuffer()` at the call
// site, long after this function has returned — which is why the body readers
// are wrapped below rather than only the fetch itself. Size the timeout for
// the whole transfer, not just the round-trip to first byte.

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

// Every `Response` method that consumes the body stream, and can therefore
// reject with the abort once the timeout fires mid-transfer.
const BODY_READERS = [
  "json",
  "text",
  "arrayBuffer",
  "blob",
  "bytes",
  "formData",
] as const;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

// Both throw sites below replace the underlying `TimeoutError` with a readable
// message, which drops the `name` a caller could have discriminated on. This
// marker puts that back, because the difference decides whether retrying is
// cheap: a transport failure never reached the upstream and costs nothing to
// re-attempt, while a timeout has already spent the entire budget and a second
// attempt doubles the worst case. `Symbol.for` so the check still holds if two
// copies of this module are ever loaded.
const TIMED_OUT = Symbol.for("cowork-genealogy.fetchWithTimeout.timedOut");

/** True for the timeout errors this module throws — not for transport failures. */
export function isFetchTimeout(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Record<symbol, unknown>)[TIMED_OUT] === true
  );
}

function timeoutError(message: string): Error {
  const err = new Error(message);
  (err as unknown as Record<symbol, unknown>)[TIMED_OUT] = true;
  return err;
}

/**
 * Shadow the response's body-reading methods with versions that translate the
 * abort into the same readable message the fetch itself produces. Mutates the
 * instance rather than wrapping it in a Proxy so the response a caller gets is
 * the same object identity fetch returned — callers pass it around, and a
 * stand-in would be a second thing to reason about for no gain.
 */
function guardBodyReads(
  response: Response,
  url: string | URL,
  timeoutMs: number
): Response {
  for (const name of BODY_READERS) {
    const original = (response as unknown as Record<string, unknown>)[name];
    if (typeof original !== "function") continue;
    Object.defineProperty(response, name, {
      configurable: true,
      writable: true,
      value: async (...args: unknown[]) => {
        try {
          return await (original as (...a: unknown[]) => Promise<unknown>).apply(
            response,
            args
          );
        } catch (err) {
          if (isTimeout(err)) {
            throw timeoutError(
              `Request to ${url} timed out after ${timeoutMs}ms while reading the response body.`
            );
          }
          throw err;
        }
      },
    });
  }
  return response;
}

export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  let response: Response;
  try {
    // `signal` is spread last deliberately: no caller passes its own signal
    // today (grep `signal:` under src/ outside this file), and the timeout
    // must always win if one ever does — not silently drop the timeout.
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeout(err)) {
      throw timeoutError(`Request to ${url} timed out after ${timeoutMs}ms.`);
    }
    throw err;
  }
  return guardBodyReads(response, url, timeoutMs);
}

// ─── Retry with budget cap (issue #2054) ─────────────────────────────────────

/** HTTP statuses worth retrying: throttling and transient server faults. */
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// Cap: 10 seconds for retry sleeps and for any attempt after the first,
// whose timeout is clamped to what remains. Total wall clock stays
// under timeoutMs + budget. Chosen so every
// tool's existing per-attempt timeout stays valid inside the Cowork bridge's
// 60s abort window. Configurable per call and in tests via `budgetMs`.
export const DEFAULT_RETRY_BUDGET_MS = 10_000;

/**
 * Retry-After in milliseconds, or null when the header is absent or not a
 * bare integer. Only the numeric (delay-seconds) form is honoured; the
 * HTTP-date form needs clock-skew handling and is treated as absent.
 */
export function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (header === null) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed) * 1000;
}

export interface RetryBudgetOptions {
  /** Max attempts (including the first try). Default 3. */
  attempts?: number;
  /** Total wall-clock budget in ms for all attempts + sleeps. Default 10_000. */
  budgetMs?: number;
  /** Base delay for exponential backoff when no Retry-After. Default 200. */
  baseMs?: number;
}

const retrySleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * `fetchWithTimeout` + automatic retry of transient failures.
 *
 * Retries on RETRYABLE_STATUS (429, 5xx), network errors, and per-attempt
 * timeouts. Returns the Response immediately for 2xx and permanent 4xx
 * (400/401/403/404). On exhaustion:
 *   - retryable HTTP status -> returns the last Response (caller's !response.ok
 *     block handles it, so existing error messaging is preserved)
 *   - thrown error (network/timeout) -> re-throws the last error
 *
 * Parses Retry-After when present and uses it as the next delay if it fits
 * inside the remaining budget; otherwise throws a descriptive error naming the
 * requested wait so the agent can tell the user how long to wait.
 */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  retryOpts: RetryBudgetOptions = {},
): Promise<Response> {
  const {
    attempts = 3,
    budgetMs = DEFAULT_RETRY_BUDGET_MS,
    baseMs = 200,
  } = retryOpts;
  const deadline = Date.now() + budgetMs;
  let lastErr: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    // Budget check before starting a new attempt (first attempt always runs).
    if (attempt > 0 && Date.now() >= deadline) break;

    let response: Response;
    try {
      const attemptTimeout =
        attempt === 0
          ? timeoutMs
          : Math.min(timeoutMs, Math.max(0, deadline - Date.now()));
      response = await fetchWithTimeout(url, init, attemptTimeout);
    } catch (err) {
      // Network error or per-attempt timeout — retryable.
      lastErr = err;
      if (attempt >= attempts - 1) break;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const backoff = baseMs * 2 ** attempt;
      const jitter = backoff * 0.5 * Math.random();
      const delay = Math.min(backoff + jitter, remaining);
      if (delay > 0) await retrySleep(delay);
      continue;
    }

    if (!RETRYABLE_STATUS.has(response.status)) {
      return response; // 2xx or permanent 4xx — done.
    }

    // Retryable HTTP status (429/5xx).
    lastResponse = response;
    lastErr = new Error(
      `HTTP ${response.status} ${response.statusText}`,
    );

    if (attempt >= attempts - 1) break;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const ra = retryAfterMs(response);
    if (ra !== null && ra > remaining) {
      throw new Error(
        `Server requested a ${Math.ceil(ra / 1000)}s wait (Retry-After: ${response.headers.get("retry-after")}), ` +
          `but only ${Math.ceil(remaining / 1000)}s of the ${Math.ceil(budgetMs / 1000)}s retry budget remains. ` +
          `The request may succeed if retried later.`,
      );
    }

    const backoff = baseMs * 2 ** attempt;
    const jitter = backoff * 0.5 * Math.random();
    const delay = ra ?? Math.min(backoff + jitter, remaining);
    if (delay > 0) await retrySleep(Math.min(delay, remaining));
  }

  // Exhausted: return the last retryable Response if we have one (so the
  // caller's !response.ok block can produce an LLM-actionable error), or
  // re-throw the last error (network/timeout).
  if (lastResponse !== undefined) return lastResponse;
  throw lastErr;
}
