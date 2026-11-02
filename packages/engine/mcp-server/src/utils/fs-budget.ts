// One FamilySearch request budget for the whole process (self-hosted beta E4).
// Off unless `configureFsBudget` is called with a limit, which only
// `src/http.ts` does — `src/index.ts` (the `.mcpb`) never does, so the desktop
// extension is unaffected.
//
// The budget sits in `fetchWithTimeout`, NOT `fsFetch`: many FamilySearch
// calls never pass through `fsFetch` (`utils/place-api.ts`, `utils/memories.ts`,
// `utils/fs-image-fetch.ts`, `auth/refresh.ts`), and `fetchWithTimeout` is the
// one place that calls the global `fetch`.
//
// It never reads a response. A block or challenge page, a 403 or a 429 fails
// only its own call and trips nothing process-wide (plan, E4); the per-user
// 429 pause is a different limit (issue #3999).
//
// Module state on purpose: the limit is process-wide, so it cannot hang off a
// `Principal` or a request.

export const FS_BUDGET_WINDOW_MS = 60_000;

/** `Symbol.for` so the check still holds if two copies of this module are ever
 *  loaded, matching `isFetchTimeout`'s marker in `http.ts`. */
const BUDGET_EXHAUSTED = Symbol.for("cowork-genealogy.fsBudget.exhausted");

/** True for the refusal this module throws.
 *
 *  Every retry loop over a FamilySearch call must check this and rethrow at
 *  once. There are two: `fetchWithRetry` (`http.ts`) and `withRetry`
 *  (`place-resolver.ts`). Both treat any other throw as a retryable transport
 *  failure, so without the check one refusal becomes three, each with a
 *  backoff sleep. */
export function isFsBudgetExhausted(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Record<symbol, unknown>)[BUDGET_EXHAUSTED] === true
  );
}

function exhaustedError(retryAfterS: number): Error {
  const err = new Error(
    `The server's shared FamilySearch request budget is spent; ` +
      `try again in about ${retryAfterS} seconds.`,
  );
  (err as unknown as Record<symbol, unknown>)[BUDGET_EXHAUSTED] = true;
  return err;
}

let perMinute: number | undefined;
/** The timestamps of the calls inside the window, oldest first. Timestamps, not
 *  a count: the refusal has to name how long to wait, which is derived from
 *  when the oldest call in the window falls out of it. */
let calls: number[] = [];

export function configureFsBudget(opts: { perMinute: number | undefined }): void {
  perMinute = opts.perMinute;
  calls = [];
}

/** Test-only reset (a restart, as far as the budget can tell). */
export function __resetFsBudgetForTests(): void {
  perMinute = undefined;
  calls = [];
}

/** True for a URL the budget counts: FamilySearch itself and its subdomains,
 *  and nothing else. Parse failures are not counted — a URL `fetch` cannot
 *  parse is not a FamilySearch call. */
export function countsAgainstFsBudget(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "familysearch.org" || host.endsWith(".familysearch.org");
}

/** Take one slot for `url`, or throw a marked refusal.
 *
 *  Called before any network I/O, so a refused call never reaches the wire.
 *  Every ATTEMPT counts, retries included: the budget is what the upstream
 *  sees, not what the caller meant to send. */
export function consumeFsBudgetSlot(url: string, now: number = Date.now()): void {
  if (perMinute === undefined) return;
  if (!countsAgainstFsBudget(url)) return;

  const cutoff = now - FS_BUDGET_WINDOW_MS;
  while (calls.length > 0 && calls[0]! <= cutoff) calls.shift();

  if (calls.length >= perMinute) {
    // The oldest call in the window is the first to fall out of it, so that is
    // when a slot frees. Rounded up, and never 0 — "try again in about 0
    // seconds" reads as a bug.
    const freesAt = calls[0]! + FS_BUDGET_WINDOW_MS;
    throw exhaustedError(Math.max(1, Math.ceil((freesAt - now) / 1000)));
  }

  calls.push(now);
}
