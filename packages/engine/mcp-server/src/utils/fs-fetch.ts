/**
 * Authenticated FamilySearch fetch with 401 re-read.
 *
 * The standard way to call an authenticated FamilySearch endpoint. Calls
 * `getValidToken(principal)`, sets `Authorization: Bearer`, and delegates to
 * `fetchWithRetry` (or `fetchWithTimeout` for long-timeout sites).
 *
 * On a 401 under `LOCAL`: re-reads `tokens.json` via `getValidToken` once more.
 * If the token changed (the control plane pushed a fresh one), retries once.
 * Otherwise returns the original 401 unchanged so the caller's own 401 handler
 * can produce the right user-facing error.
 *
 * Never calls `refreshAccessToken` on a 401 — a refresh revokes every other
 * holder's token (measured in PR #2859). Issue #2887.
 *
 * For a connector caller, both honour that user's 429 pause
 * (`user-limits.ts`, issue #3999): a 429 pauses the user, and every call these
 * two make for a paused user waits the pause out within its time or is refused
 * before any network I/O.
 */

import type { Principal } from "../auth/principal.js";
import { getValidToken } from "../auth/refresh.js";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_RETRY_BUDGET_MS,
  fetchWithRetry,
  fetchWithTimeout,
  pauseWaitAllowance,
  retryAfterMs,
  type RetryBudgetOptions,
} from "./http.js";
import { awaitFsPause, connectorUserId, recordFsPause } from "./user-limits.js";

function mergeAuth(
  token: string,
  init: RequestInit = {},
): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

async function handle401(
  principal: Principal,
  originalToken: string,
  response: Response,
  url: string | URL,
  init: RequestInit,
  fetcher: (url: string | URL, init: RequestInit) => Promise<Response>,
): Promise<Response> {
  if (response.status !== 401) return response;
  if (principal.kind !== "local") return response;

  const freshToken = await getValidToken(principal);
  if (freshToken === originalToken) return response;

  return fetcher(url, mergeAuth(freshToken, init));
}

/**
 * Hand the FamilySearch status to the door's per-request recorder, if this
 * principal carries one (E1 logs one line per call with it). Records the FINAL
 * status, after any 401 re-read, because that is what the call actually got.
 *
 * Never throws: a recorder is a logging detail, and a tool call the caller was
 * entitled to make must not fail because the door's logger did.
 */
function recordFamilySearchStatus(principal: Principal, response: Response): Response {
  recordStatus(principal, response.status);
  return response;
}

function recordStatus(principal: Principal, status: number): void {
  if (principal.kind === "bearer" && principal.recordFamilySearchStatus) {
    try {
      principal.recordFamilySearchStatus(status);
    } catch {
      // Deliberately swallowed; see above.
    }
  }
}

/**
 * The retry options with a connector user's 429 pause added: the observer sees
 * a 429 even when `fetchWithRetry` then throws for a long `Retry-After`, and the
 * gate runs before every attempt, retries included, since each is a
 * FamilySearch call. Any hooks the caller passed still run. Unchanged for every
 * other principal.
 *
 * What the pause does not cover: anonymous FamilySearch calls carry no
 * principal and never come through here (place lookups, public memory
 * artifacts and story text, external-links search), so they stay under the
 * process-wide budget only. And "per user" assumes FamilySearch rate-limits per
 * token, which is UNVERIFIED: if its 429s are per IP address, every connector
 * user shares one address and this pause protects nobody else.
 */
function withUserPause(
  principal: Principal,
  retryOpts: RetryBudgetOptions | undefined,
  seen: (status: number) => void,
): RetryBudgetOptions | undefined {
  const userId = connectorUserId(principal);
  if (userId === undefined) return retryOpts;
  return {
    ...retryOpts,
    onRetryableResponse: (status, retryAfter) => {
      seen(status);
      if (status === 429) recordFsPause(userId, retryAfter);
      retryOpts?.onRetryableResponse?.(status, retryAfter);
    },
    beforeAttempt: async (maxWaitMs) => {
      await awaitFsPause(userId, maxWaitMs);
      await retryOpts?.beforeAttempt?.(maxWaitMs);
    },
  };
}

/**
 * Authenticated FamilySearch fetch with retry and 401 re-read.
 * Use for most FS endpoints. Delegates to `fetchWithRetry`.
 */
export async function fsFetch(
  principal: Principal,
  url: string | URL,
  init: RequestInit = {},
  timeoutMs?: number,
  retryOpts?: RetryBudgetOptions,
): Promise<Response> {
  const token = await getValidToken(principal);
  const authedInit = mergeAuth(token, init);
  let lastRetryable: number | undefined;
  const opts = withUserPause(principal, retryOpts, (status) => {
    lastRetryable = status;
  });

  let response: Response;
  try {
    response = await fetchWithRetry(url, authedInit, timeoutMs, opts);
  } catch (err) {
    // The loop saw a 429 or 5xx and then threw (a Retry-After past the budget,
    // or this user's pause): FamilySearch still answered that status, and the
    // door's log line is how an operator sees a user was throttled.
    if (lastRetryable !== undefined) recordStatus(principal, lastRetryable);
    throw err;
  }

  return recordFamilySearchStatus(
    principal,
    await handle401(principal, token, response, url, init, (u, i) =>
      fetchWithRetry(u, i, timeoutMs, opts),
    ),
  );
}

/**
 * Authenticated FamilySearch fetch without retry, with 401 re-read.
 * Use for `match-engine.ts` and `fs-image-fetch.ts` which manage their own
 * retry or carry timeouts too long for the retry budget.
 *
 * With no retry loop of its own, a paused connector user waits at most the
 * default retry budget, and only while the request keeps time to run
 * (`pauseWaitAllowance`); the wait comes out of `timeoutMs`, so the call never
 * runs longer than its caller sized it (volume_bisect's legs sum to fit
 * Cowork's 60 s abort). Its own 429 records the pause.
 */
export async function fsFetchWithTimeout(
  principal: Principal,
  url: string | URL,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<Response> {
  const userId = connectorUserId(principal);
  let requestTimeoutMs = timeoutMs;
  if (userId !== undefined) {
    const limit = timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const before = Date.now();
    await awaitFsPause(userId, pauseWaitAllowance(limit, DEFAULT_RETRY_BUDGET_MS));
    requestTimeoutMs = Math.max(0, limit - (Date.now() - before));
  }
  const token = await getValidToken(principal);
  const authedInit = mergeAuth(token, init);

  const response = await fetchWithTimeout(url, authedInit, requestTimeoutMs);
  if (userId !== undefined && response.status === 429) recordFsPause(userId, retryAfterMs(response));

  return recordFamilySearchStatus(
    principal,
    await handle401(principal, token, response, url, init, (u, i) =>
      fetchWithTimeout(u, i, timeoutMs),
    ),
  );
}
