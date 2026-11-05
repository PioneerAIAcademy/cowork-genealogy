// The process-wide tool-server limits as the hosted entrypoint receives them:
// the long-lived HTTP server's process environment (self-hosted beta E4). Read
// once in `src/http.ts` beside `readPgS3Env` and handed to each module's
// `configure*`; no getter reads `process.env`. These are PROCESS settings, not
// per-user config — they do not belong on `AppConfig`, which is read through a
// `Principal`. No `fs`.
//
// Every setting is off unless set, so `src/index.ts` (the `.mcpb`), which never
// calls this, behaves exactly as it does today.

// Module-private: nothing outside this file needs them, and they resolve to
// bare primitives, so exporting them would widen the surface for nothing.
/** Unset or empty. Kept distinct from `null` so an invalid value cannot read
 *  as "off" and skip the exit-2 branch. */
type Unset = undefined;
/** Set to something it may not be. */
type Invalid = null;

import { FS_BUDGET_MAX_PER_MINUTE } from "../utils/fs-budget.js";

/** Concurrent transcriptions is bounded by what one host can usefully run at
 *  once; the ceiling only stops an absurd value, as the budget's does. */
export const MAX_TRANSCRIPTIONS_CEILING = 1_000;

export interface LimitsEnv {
  /** Sliding-60s FamilySearch request budget for the whole process.
   *  `undefined` is off; **`null` is INVALID** and the caller must not pass it
   *  to `configureFsBudget` -- it is named in `invalid` and belongs on the
   *  exit-2 path. The union is deliberate: collapsing `null` to `undefined`
   *  here would make a typo read as "off" to any caller that forgets to check
   *  `invalid`, which is the one failure this parser exists to prevent. */
  fsCallsPerMinute: number | Unset | Invalid;
  /** Concurrent transcriptions across the process; same three states. */
  maxTranscriptions: number | Unset | Invalid;
  /** One collections catalog for the process (`GENEALOGY_SHARED_COLLECTIONS_CACHE`)
   *  rather than one slot per token. `true`/`false`, as
   *  `GENEALOGY_S3_FORCE_PATH_STYLE` takes; same three states. */
  sharedCollectionsCache: boolean | Unset | Invalid;
  /** Variables set to a value they may not take. Unusable unless empty — the
   *  caller decides how to report it, as it does for `PgS3Env.invalid`. */
  invalid: string[];
}

/** A whole number at or above `min`, `undefined` when unset or empty, `null`
 *  when it is anything else.
 *
 *  Three states, not two: `pg-s3-env.ts`'s `seconds()` folds "unset" into its
 *  default, which is right for a variable with one, and wrong here — both of
 *  these are off when unset, so a shared sentinel would make `abc` read as
 *  "off" and never reach the exit-2 branch.
 *
 *  `Number.isInteger` over a digits-only regex, not `parseInt`: "1e3", "2.5",
 *  "abc" and "NaN" are refused rather than read as something else, and a NaN
 *  never reaches a comparison that is false for it. */
function wholeNumber(
  raw: string | undefined,
  min: number,
  max: number,
): number | Unset | Invalid {
  if (raw === undefined || raw.trim() === "") return undefined;
  if (!/^\s*\d+\s*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** `true` or `false` exactly, `undefined` when unset or empty, `null` when it is
 *  anything else -- so "yes", "1" or "TRUE" exits 2 rather than reading as off. */
function flag(raw: string | undefined): boolean | Unset | Invalid {
  if (raw === undefined || raw.trim() === "") return undefined;
  if (raw.trim() === "true") return true;
  if (raw.trim() === "false") return false;
  return null;
}

export function readLimitsEnv(env: NodeJS.ProcessEnv): LimitsEnv {
  const invalid: string[] = [];

  const fsCallsPerMinute = wholeNumber(
    env.GENEALOGY_FS_CALLS_PER_MINUTE,
    1,
    FS_BUDGET_MAX_PER_MINUTE,
  );
  if (fsCallsPerMinute === null) invalid.push("GENEALOGY_FS_CALLS_PER_MINUTE");

  const maxTranscriptions = wholeNumber(
    env.GENEALOGY_MAX_TRANSCRIPTIONS,
    1,
    MAX_TRANSCRIPTIONS_CEILING,
  );
  if (maxTranscriptions === null) invalid.push("GENEALOGY_MAX_TRANSCRIPTIONS");

  const sharedCollectionsCache = flag(env.GENEALOGY_SHARED_COLLECTIONS_CACHE);
  if (sharedCollectionsCache === null) invalid.push("GENEALOGY_SHARED_COLLECTIONS_CACHE");

  // The union is returned as-is: `null` reaches the caller, which must send it
  // to the exit-2 branch rather than to a `configure*` call.
  return { fsCallsPerMinute, maxTranscriptions, sharedCollectionsCache, invalid };
}
