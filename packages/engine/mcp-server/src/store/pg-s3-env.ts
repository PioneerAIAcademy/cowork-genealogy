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

export interface PgS3Env {
  backendOptions: PgS3BackendOptions;
  /** The one `projectPath` the tools pass for a project (`GENEALOGY_ANCHOR_PATH`). */
  anchorPath: string;
  /** Required variables that are unset or empty, plus the unset partner when
   *  exactly one of the two S3 keys is set. `backendOptions` is not usable
   *  unless this is empty; the caller decides how to report it. */
  missing: string[];
  /** Variables that are set to a value they may not take
   *  (`GENEALOGY_S3_FORCE_PATH_STYLE` other than `true`/`false`). Unusable
   *  unless empty, like `missing`. */
  invalid: string[];
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
    missing,
    invalid,
  };
}
