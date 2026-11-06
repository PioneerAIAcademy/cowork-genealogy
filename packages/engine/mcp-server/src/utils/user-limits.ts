// Per-user limits for connector callers (self-hosted beta E4, per-user half;
// issue #3999). Two of them, both keyed by the connector caller's `users.id`:
//
// - At most USER_CALL_CAP `tools/call` requests in flight per user, taken at the
//   door (`src/http-server.ts`). A call over the cap WAITS in FIFO order; it is
//   never refused, because `locality-guide` sends ten or more calls in one turn
//   and a refused call would read as a failed source (lead, rescope 2026-11-05).
// - A pause when FamilySearch answers that user 429, taken in the authenticated
//   fetch (`src/utils/fs-fetch.ts`).
//
// Neither touches the worker path or `LOCAL`: `connectorUserId` is undefined
// for both, and the door never takes a slot on the worker path.
//
// Module state on purpose, as in `fs-budget.ts`: the limits span requests, so
// they cannot hang off a `Principal` or a request.

import type { Principal } from "../auth/principal.js";
import { markFsRefusal, monotonicNow } from "./fs-budget.js";

/** A constant, not a setting (issue #3999, "Decided (review-ready,
 *  2026-11-05)"): nothing yet needs another value. */
export const USER_CALL_CAP = 4;

/** The pause when a 429 carries no usable `Retry-After`. */
export const DEFAULT_FS_PAUSE_MS = 30_000;

/** The connector caller's user id, or undefined for every other principal
 *  (`LOCAL`, the worker's bearer). */
export function connectorUserId(principal: Principal): string | undefined {
  return principal.kind === "bearer" && principal.surface === "connector" ? principal.userId : undefined;
}

// ─── 4 calls at a time ──────────────────────────────────────────────────────

interface UserCalls {
  running: number;
  /** Waiting calls, oldest first. Each is handed a slot directly on release. */
  waiting: Array<() => void>;
}

let calls = new Map<string, UserCalls>();

/** Deleted once nothing is running or waiting, so the map holds only users
 *  with a call in flight, not every user ever seen. */
function dropIfIdle(userId: string, entry: UserCalls): void {
  if (entry.running === 0 && entry.waiting.length === 0 && calls.get(userId) === entry) {
    calls.delete(userId);
  }
}

/** Give the slot to the oldest waiter, or free it. */
function releaseSlot(userId: string, entry: UserCalls): void {
  const next = entry.waiting.shift();
  if (next) {
    next();
    return;
  }
  entry.running--;
  dropIfIdle(userId, entry);
}

/** Resolves to the entry the slot was taken from and whether the call had to
 *  wait for it, or null when `signal` aborted first (the waiter has left the
 *  queue and holds nothing). */
function acquireSlot(
  userId: string,
  signal: AbortSignal,
): Promise<{ entry: UserCalls; waited: boolean } | null> {
  let entry = calls.get(userId);
  if (!entry) {
    entry = { running: 0, waiting: [] };
    calls.set(userId, entry);
  }
  const mine = entry;
  if (signal.aborted) {
    dropIfIdle(userId, mine);
    return Promise.resolve(null);
  }
  if (mine.running < USER_CALL_CAP && mine.waiting.length === 0) {
    mine.running++;
    return Promise.resolve({ entry: mine, waited: false });
  }
  return new Promise<{ entry: UserCalls; waited: boolean } | null>((resolve) => {
    const grant = () => {
      signal.removeEventListener("abort", leave);
      resolve({ entry: mine, waited: true });
    };
    const leave = () => {
      const at = mine.waiting.indexOf(grant);
      if (at !== -1) mine.waiting.splice(at, 1);
      dropIfIdle(userId, mine);
      resolve(null);
    };
    mine.waiting.push(grant);
    signal.addEventListener("abort", leave, { once: true });
  });
}

/**
 * Run `fn` holding one of `userId`'s USER_CALL_CAP slots, waiting FIFO for one
 * when they are all taken. `fn` is told whether the call waited, so the door
 * can check again what it checked before the wait. Returns false, without
 * running `fn`, when `signal` aborts first (a client that hung up while its
 * call waited). The slot is released however `fn` ends, a throw included.
 */
export async function runWithUserCallSlot(
  userId: string,
  signal: AbortSignal,
  fn: (waited: boolean) => Promise<void>,
): Promise<boolean> {
  const granted = await acquireSlot(userId, signal);
  if (granted === null) return false;
  const { entry, waited } = granted;
  // Released into the entry it was taken from, never one looked up again.
  const release = () => releaseSlot(userId, entry);
  // Granted in the same turn the client hung up: the call must still not run.
  if (signal.aborted) {
    release();
    return false;
  }
  try {
    await fn(waited);
  } finally {
    release();
  }
  return true;
}

// ─── The 429 pause ──────────────────────────────────────────────────────────
//
// What it does NOT cover: anonymous FamilySearch calls carry no principal, so
// `utils/place-api.ts`, `utils/memories.ts`'s unauthenticated lookups and
// `tools/external-links-search.ts` stay under the process-wide budget only.
//
// "Per user" assumes FamilySearch rate-limits per token. That is UNVERIFIED: if
// its 429s are per IP address, every connector user shares this server's one
// address and pausing one user protects nobody else.

/** When each paused user's pause ends, on the `monotonicNow()` clock. */
let pausedUntil = new Map<string, number>();

/**
 * Record a 429 for `userId`: paused for `retryAfterMs`, or DEFAULT_FS_PAUSE_MS
 * when the header was absent or unparseable (`retryAfterMs` null). A shorter
 * pause never cuts a longer one short. Never throws.
 */
export function recordFsPause(userId: string, retryAfterMs: number | null, now: number = monotonicNow()): void {
  // Expired entries go here, the one place the map grows.
  for (const [user, until] of pausedUntil) if (until <= now) pausedUntil.delete(user);
  const until = now + (retryAfterMs ?? DEFAULT_FS_PAUSE_MS);
  if (until <= now) return;
  const current = pausedUntil.get(userId);
  if (current === undefined || until > current) pausedUntil.set(userId, until);
}

function pausedError(waitMs: number): Error {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  return markFsRefusal(
    new Error(
      `FamilySearch asked this account to wait; try again in about ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
    ),
  );
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Before a FamilySearch call from `userId`: return at once when not paused;
 * wait the pause out when it ends within `budgetMs`; otherwise throw, before
 * any network I/O, a refusal marked for `isFsBudgetExhausted`, so both retry
 * loops (`fetchWithRetry`, `place-resolver.ts`'s `withRetry`) rethrow it rather
 * than retry it.
 *
 * Waiting past the budget was rejected (issue #3999, "Decided (review-ready,
 * 2026-11-05)"): a 300 s `Retry-After` would outlast Claude's per-call timeout
 * and look like a hang. The deadline is fixed on entry, so a pause another call
 * extends mid-wait cannot buy a second full budget.
 */
export async function awaitFsPause(
  userId: string,
  budgetMs: number,
  clock: () => number = monotonicNow,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  const deadline = clock() + budgetMs;
  for (;;) {
    const until = pausedUntil.get(userId);
    if (until === undefined) return;
    const now = clock();
    if (until <= now) {
      if (pausedUntil.get(userId) === until) pausedUntil.delete(userId);
      return;
    }
    if (until > deadline) throw pausedError(until - now);
    await sleep(until - now);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

/** Test-only reset (a restart, as far as the limits can tell). */
export function __resetUserLimitsForTests(): void {
  calls = new Map();
  pausedUntil = new Map();
}

/** Test-only view: how many users the slot map tracks, one user's running and
 *  waiting counts, and how many users are paused. */
export function __userLimitsStateForTests(userId?: string): {
  users: number;
  running: number;
  waiting: number;
  pausedUsers: number;
} {
  const entry = userId === undefined ? undefined : calls.get(userId);
  return {
    users: calls.size,
    running: entry?.running ?? 0,
    waiting: entry?.waiting.length ?? 0,
    pausedUsers: pausedUntil.size,
  };
}
