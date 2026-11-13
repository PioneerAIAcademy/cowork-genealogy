// Whether FamilySearch still accepts a CONNECTOR caller's session (self-hosted
// beta E3). `project_context` and `auth_status` ask, so the sign-in link reaches
// the user at the start of the next turn even when an agent's summary dropped
// the tool error that first carried it.
//
// One `GET /platform/users/current`, remembered briefly per user so a turn that
// reads the project several times asks FamilySearch once. Only the status is
// read: the body carries account details nothing here needs.

import { createHash } from "node:crypto";
import type { Principal } from "../auth/principal.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fsFetchWithTimeout } from "./fs-fetch.js";

const CURRENT_USER_URL = "https://api.familysearch.org/platform/users/current";
/** How long one answer stands for a user. Short: signing in again must show at once
 *  (a new token is a new question anyway), and an ended session within a minute. */
export const SESSION_CHECK_TTL_MS = 60_000;
/** The check must never hold up the answer it rides on. */
const SESSION_CHECK_TIMEOUT_MS = 5_000;
/** One entry per user; past this the oldest goes. */
const MAX_REMEMBERED = 1_000;

export type SessionVerdict = "live" | "ended";

const remembered = new Map<string, { tokenSha256: string; verdict: SessionVerdict; at: number }>();

/**
 * `"ended"` when FamilySearch answers 401 for this caller's token, `"live"`
 * when it answers 200, and `undefined` when nothing was learned: any caller
 * but a connector, another status, a timeout, a spent budget or a network
 * failure. Never throws, and never reports `"ended"` on anything but a 401, so
 * an outage cannot send a signed-in user to sign in again.
 */
export async function connectorSession(
  principal: Principal,
  now: () => number = Date.now,
): Promise<SessionVerdict | undefined> {
  if (principal.kind !== "bearer" || principal.surface !== "connector" || principal.userId === undefined) {
    return undefined;
  }
  if (!principal.accessToken) return "ended";
  const tokenSha256 = createHash("sha256").update(principal.accessToken, "utf8").digest("hex");
  const known = remembered.get(principal.userId);
  if (known && known.tokenSha256 === tokenSha256 && now() - known.at < SESSION_CHECK_TTL_MS) {
    return known.verdict;
  }
  let verdict: SessionVerdict | undefined;
  try {
    const response = await fsFetchWithTimeout(
      principal,
      CURRENT_USER_URL,
      { headers: { Accept: "application/x-fs-v1+json", "User-Agent": BROWSER_USER_AGENT } },
      SESSION_CHECK_TIMEOUT_MS,
    );
    await response.body?.cancel().catch(() => undefined);
    verdict = response.status === 401 ? "ended" : response.ok ? "live" : undefined;
  } catch {
    verdict = undefined;
  }
  if (verdict !== undefined) {
    remembered.delete(principal.userId);
    if (remembered.size >= MAX_REMEMBERED) {
      const oldest = remembered.keys().next().value;
      if (oldest !== undefined) remembered.delete(oldest);
    }
    remembered.set(principal.userId, { tokenSha256, verdict, at: now() });
  }
  return verdict;
}

/** Forget every remembered answer (tests). */
export function __resetSessionChecksForTests(): void {
  remembered.clear();
}
