// The FamilySearch session's "current tree".
//
// Some tree endpoints take no tree parameter and answer from whichever tree the
// session has selected: `POST /service/tree/links/sources/attachments` ignores
// `?treeId=` and returns Family Tree attachments until the session is switched
// to a researcher tree, then returns that tree's (probed live 2026-10-21, issue
// #3408). The selection is per session, not per request, so it is visible to
// everything else on the session — the user's open browser tabs included — and
// two calls for different trees on one session would see each other's switch.
// `withSessionTree` switches, runs, and always restores, one caller at a time
// per principal. The lock is in-process only: two processes sharing a session
// can still interleave.

import type { Principal } from "../auth/principal.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fsFetch } from "./fs-fetch.js";

export const SESSION_TREE_URL =
  "https://www.familysearch.org/service/tree/tree-data/user/CURRENT/tree/session";

const HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent": BROWSER_USER_AGENT,
};

const locks = new Map<string, Promise<unknown>>();

const lockKey = (principal: Principal) => (principal.kind === "bearer" ? `bearer:${principal.accessToken}` : "local");

const switched = new Map<string, () => Promise<void>>();

/** Undo any switch still in flight; for a SIGINT handler about to exit. */
export async function restoreSwitchedSessionTrees(): Promise<void> {
  await Promise.allSettled([...switched.values()].map((restore) => restore()));
}

export async function getSessionTree(principal: Principal): Promise<string> {
  const res = await fsFetch(principal, SESSION_TREE_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`Could not read the FamilySearch session's current tree: ${res.status} ${res.statusText}.`);
  const body = (await res.json()) as { treeId?: unknown };
  if (typeof body.treeId !== "string" || body.treeId === "") {
    throw new Error("FamilySearch returned no current tree for the session.");
  }
  return body.treeId;
}

export async function setSessionTree(principal: Principal, treeId: string): Promise<void> {
  const res = await fsFetch(principal, SESSION_TREE_URL, { method: "POST", headers: HEADERS, body: JSON.stringify({ treeId }) });
  if (!res.ok) throw new Error(`Could not set the FamilySearch session's current tree to ${treeId}: ${res.status} ${res.statusText}.`);
}

/** Run `fn` with the session switched to `treeId`, then switch back. */
export async function withSessionTree<T>(principal: Principal, treeId: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(principal);
  const prior = locks.get(key) ?? Promise.resolve();
  const run = prior.catch(() => undefined).then(async () => {
    const original = await getSessionTree(principal);
    if (original === treeId) return fn();
    await setSessionTree(principal, treeId);
    switched.set(key, () => setSessionTree(principal, original));
    let result: T;
    try {
      result = await fn();
    } catch (e) {
      switched.delete(key);
      try {
        await setSessionTree(principal, original);
      } catch (restore) {
        const msg = (x: unknown) => (x instanceof Error ? x.message : String(x));
        throw new Error(`${msg(e)} Restoring the session's current tree also failed: ${msg(restore)}`);
      }
      throw e;
    }
    switched.delete(key);
    await setSessionTree(principal, original);
    return result;
  });
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}
