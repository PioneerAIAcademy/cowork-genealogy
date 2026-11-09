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
// 429 pause is a different limit (`user-limits.ts`, issue #3999), whose
// refusal carries this module's marker.
//
// Module state on purpose: the limit is process-wide, so it cannot hang off a
// `Principal` or a request.

export const FS_BUDGET_WINDOW_MS = 60_000;

/** An upper bound on the configured rate. The window holds one timestamp per
 *  admitted call, so without a ceiling `GENEALOGY_FS_CALLS_PER_MINUTE=1000000000`
 *  would grow an array of a billion numbers (~8 GB) with `shift()` going O(n).
 *  `pg-s3-env.ts` caps `GENEALOGY_ORPHAN_SWEEP_INTERVAL_S` for the same class of
 *  reason. No real deployment is near this; it exists to bound the array. */
export const FS_BUDGET_MAX_PER_MINUTE = 100_000;

/** Monotonic milliseconds, never wall clock.
 *
 *  `Date.now()` moves backwards on an NTP correction or a host suspend/resume.
 *  A backwards step leaves every stored timestamp ahead of `now - WINDOW`, so
 *  nothing is ever pruned and every FamilySearch call in the process is refused
 *  for the size of the step -- and `calls` stops being sorted, so `calls[0]` is
 *  no longer the oldest and the "try again in N" figure is wrong too.
 *  `performance.now()` is monotonic and immune to both. */
export function monotonicNow(): number {
  return performance.now();
}

/** `Symbol.for` so the check still holds if two copies of this module are ever
 *  loaded, matching `isFetchTimeout`'s marker in `http.ts`. */
const BUDGET_EXHAUSTED = Symbol.for("cowork-genealogy.fsBudget.exhausted");

/** True for a local FamilySearch refusal: the one this module throws, and the
 *  per-user 429 pause's (`user-limits.ts`), which `markFsRefusal` marks the
 *  same way so every guard below keeps it intact too.
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

/** Mark `err` as a local FamilySearch refusal, so `isFsBudgetExhausted` is
 *  true for it: nothing reached FamilySearch, and retrying cannot help. */
export function markFsRefusal(err: Error): Error {
  (err as unknown as Record<symbol, unknown>)[BUDGET_EXHAUSTED] = true;
  return err;
}

function exhaustedError(retryAfterS: number): Error {
  return markFsRefusal(
    new Error(
      `The server's shared FamilySearch request budget is spent; ` +
        `try again in about ${retryAfterS} ${retryAfterS === 1 ? "second" : "seconds"}.`,
    ),
  );
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
/** The OAuth authorization and token endpoints (`src/auth/config.ts` pins both
 *  under this prefix on ident.familysearch.org). */
const FS_OAUTH_PATH_PREFIX = "/cis-web/oauth2/";

export function countsAgainstFsBudget(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "familysearch.org" && !host.endsWith(".familysearch.org")) return false;

  // The OAuth endpoints are EXEMPT, and this is a deliberate undercount: a
  // token refresh is a real FamilySearch request, so the process can exceed
  // its configured rate by roughly one call per token expiry per user —
  // against a budget denominated in calls per minute, which is noise.
  //
  // Counting them is worse, and not by a little. `getValidToken` turns ANY
  // refresh failure into "FamilySearch session has expired... Call the login
  // tool to re-authenticate" (auth/refresh.ts). So a budget-refused refresh
  // tells the user to re-authenticate over a transient rate limit — and since
  // every tool needing a token then fails the same way, one spent budget reads
  // as a dead session rather than a wait. Letting the refresh through keeps the
  // session alive while the DATA calls refuse with "try again in about N
  // seconds", which is the behaviour the budget exists to produce.
  //
  // Fixing it in `getValidToken` instead would work, but that catch is the
  // documented shape of `src/auth/` (CLAUDE.md: token ops answer rather than
  // throw), and the exemption is the smaller change in the more honest place.
  return !parsed.pathname.toLowerCase().startsWith(FS_OAUTH_PATH_PREFIX);
}

/** Take one slot for `url`, or throw a marked refusal.
 *
 *  Called before any network I/O, so a refused call never reaches the wire.
 *  Every ATTEMPT counts, retries included: the budget is what the upstream
 *  sees, not what the caller meant to send. */
export function consumeFsBudgetSlot(url: string, now: number = monotonicNow()): void {
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
