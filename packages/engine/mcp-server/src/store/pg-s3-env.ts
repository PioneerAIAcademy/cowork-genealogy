// The Pg/S3 store's configuration as the hosted entrypoint receives it: the
// long-lived HTTP server's process environment. This reads the store variables
// only; a project id is per request (the `X-Genealogy-Project-Id` header) and
// never part of it. No `fs`.
//
// The S3 keys are an optional pair: both set signs with them, neither set
// leaves `credentials` off the client so the AWS SDK default chain (the
// environment, `~/.aws` shared config/SSO, web identity, then ECS/EC2 instance
// metadata) supplies them. An unset
// optional value is omitted from `backendOptions`, never passed as `""`: the
// SDK signs with empty keys and resolves `endpoint: ""` to real AWS.

import type { PgS3BackendOptions } from "./pg-s3-project-store.js";

export const PG_S3_REQUIRED_ENV = ["GENEALOGY_PG_DSN", "GENEALOGY_S3_BUCKET"] as const;

export const DEFAULT_ANCHOR_PATH = "/project";
export const DEFAULT_S3_REGION = "us-east-1";

/** The orphan sweep (s3-orphan-sweep.ts): hourly, deleting what has been
 *  unreferenced for a day. The grace may not go under an hour, above the
 *  worker's 1,800 s MCP call timeout, so a value meant in minutes cannot delete
 *  the objects of a tool call still in flight. */
export const DEFAULT_ORPHAN_SWEEP_INTERVAL_S = 3600;
export const DEFAULT_ORPHAN_GRACE_S = 86_400;
export const ORPHAN_GRACE_FLOOR_S = 3600;
/** The longest interval `setTimeout` can wait: past 2^31 - 1 ms it fires after 1 ms, which
 *  would run full-bucket passes back to back. */
export const ORPHAN_SWEEP_INTERVAL_MAX_S = Math.floor((2 ** 31 - 1) / 1000);

export interface PgS3Env {
  backendOptions: PgS3BackendOptions;
  /** The one `projectPath` the tools pass for a project (`GENEALOGY_ANCHOR_PATH`). */
  anchorPath: string;
  /** Required variables that are unset or empty, plus the unset partner when
   *  exactly one of the two S3 keys is set. `backendOptions` is not usable
   *  unless this is empty; the caller decides how to report it. */
  missing: string[];
  /** The orphan sweep's schedule (s3-orphan-sweep.ts): `intervalS` 0 is off. */
  orphanSweep: { intervalS: number; graceS: number };
  /** Variables that are set to a value they may not take
   *  (`GENEALOGY_S3_FORCE_PATH_STYLE` other than `true`/`false`; an orphan
   *  sweep variable that is not a whole number of seconds, a grace under
   *  `ORPHAN_GRACE_FLOOR_S`, or an interval over `ORPHAN_SWEEP_INTERVAL_MAX_S`). Unusable unless empty, like `missing`. */
  invalid: string[];
}

/** A whole number of seconds at or above `floor`, the default when unset or
 *  empty, or null. `Number.isInteger`, not `parseInt`: "1e3", "3600.5", "abc"
 *  and "NaN" are refused rather than read as something else, and a NaN never
 *  reaches a comparison that is false for it. */
function seconds(
  raw: string | undefined,
  fallback: number,
  floor: number,
  ceiling = Number.MAX_SAFE_INTEGER,
): number | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\s*\d+\s*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= floor && n <= ceiling ? n : null;
}

export function readPgS3Env(env: NodeJS.ProcessEnv): PgS3Env {
  const missing: string[] = PG_S3_REQUIRED_ENV.filter((name) => !env[name]);
  const invalid: string[] = [];

  const accessKeyId = env.GENEALOGY_S3_ACCESS_KEY || undefined;
  const secretAccessKey = env.GENEALOGY_S3_SECRET_KEY || undefined;
  // A half-configured pair is a mistake; falling back to the instance role
  // would hide it.
  if (accessKeyId && !secretAccessKey) missing.push("GENEALOGY_S3_SECRET_KEY");
  if (secretAccessKey && !accessKeyId) missing.push("GENEALOGY_S3_ACCESS_KEY");

  const endpoint = env.GENEALOGY_S3_ENDPOINT || undefined;
  // Path style by default wherever an endpoint is set (MinIO on compose DNS has
  // no virtual-hosted names); AWS's own virtual-hosted style otherwise.
  let forcePathStyle = endpoint !== undefined;
  const pathStyle = env.GENEALOGY_S3_FORCE_PATH_STYLE;
  if (pathStyle === "true") forcePathStyle = true;
  else if (pathStyle === "false") forcePathStyle = false;
  else if (pathStyle) invalid.push("GENEALOGY_S3_FORCE_PATH_STYLE");

  // 0 turns the sweep off; the grace has no off, only its floor.
  const intervalS = seconds(
    env.GENEALOGY_ORPHAN_SWEEP_INTERVAL_S,
    DEFAULT_ORPHAN_SWEEP_INTERVAL_S,
    0,
    ORPHAN_SWEEP_INTERVAL_MAX_S,
  );
  if (intervalS === null) invalid.push("GENEALOGY_ORPHAN_SWEEP_INTERVAL_S");
  const graceS = seconds(env.GENEALOGY_ORPHAN_GRACE_S, DEFAULT_ORPHAN_GRACE_S, ORPHAN_GRACE_FLOOR_S);
  if (graceS === null) invalid.push("GENEALOGY_ORPHAN_GRACE_S");

  return {
    backendOptions: {
      dsn: env.GENEALOGY_PG_DSN ?? "",
      s3: {
        bucket: env.GENEALOGY_S3_BUCKET ?? "",
        region: env.GENEALOGY_S3_REGION || DEFAULT_S3_REGION,
        forcePathStyle,
        ...(endpoint ? { endpoint } : {}),
        ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
      },
    },
    anchorPath: env.GENEALOGY_ANCHOR_PATH || DEFAULT_ANCHOR_PATH,
    orphanSweep: { intervalS: intervalS ?? 0, graceS: graceS ?? DEFAULT_ORPHAN_GRACE_S },
    missing,
    invalid,
  };
}
