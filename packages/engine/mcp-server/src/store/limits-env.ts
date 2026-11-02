// The process-wide tool-server limits as the hosted entrypoint receives them:
// the long-lived HTTP server's process environment (self-hosted beta E4). Read
// once in `src/http.ts` beside `readPgS3Env` and handed to each module's
// `configure*`; no getter reads `process.env`. These are PROCESS settings, not
// per-user config — they do not belong on `AppConfig`, which is read through a
// `Principal`. No `fs`.
//
// Both limits are off unless set, so `src/index.ts` (the `.mcpb`), which never
// calls this, behaves exactly as it does today.

/** Unset or empty. Kept distinct from `null` so an invalid value cannot read
 *  as "off" and skip the exit-2 branch. */
export type Unset = undefined;
/** Set to something it may not be. */
export type Invalid = null;

export interface LimitsEnv {
  /** Sliding-60s FamilySearch request budget for the whole process; undefined
   *  is off. */
  fsCallsPerMinute: number | undefined;
  /** Concurrent transcriptions across the process; undefined is off. */
  maxTranscriptions: number | undefined;
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
function wholeNumber(raw: string | undefined, min: number): number | Unset | Invalid {
  if (raw === undefined || raw.trim() === "") return undefined;
  if (!/^\s*\d+\s*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : null;
}

export function readLimitsEnv(env: NodeJS.ProcessEnv): LimitsEnv {
  const invalid: string[] = [];

  const fsCallsPerMinute = wholeNumber(env.GENEALOGY_FS_CALLS_PER_MINUTE, 1);
  if (fsCallsPerMinute === null) invalid.push("GENEALOGY_FS_CALLS_PER_MINUTE");

  const maxTranscriptions = wholeNumber(env.GENEALOGY_MAX_TRANSCRIPTIONS, 1);
  if (maxTranscriptions === null) invalid.push("GENEALOGY_MAX_TRANSCRIPTIONS");

  return {
    fsCallsPerMinute: fsCallsPerMinute ?? undefined,
    maxTranscriptions: maxTranscriptions ?? undefined,
    invalid,
  };
}
