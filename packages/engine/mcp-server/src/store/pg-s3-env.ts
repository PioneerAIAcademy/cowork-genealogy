// The Pg/S3 store's configuration as the hosted entrypoints receive it: the
// worker puts it in the environment (per-turn stdio fork, or the long-lived
// HTTP server's process). This reads the store variables only; a project id is
// per turn (`GENEALOGY_PROJECT_ID`, hosted-stdio) or per request (the
// `X-Genealogy-Project-Id` header, http) and never part of it. No `fs`.

import type { PgS3BackendOptions } from "./pg-s3-project-store.js";

export const PG_S3_REQUIRED_ENV = [
  "GENEALOGY_PG_DSN",
  "GENEALOGY_S3_ENDPOINT",
  "GENEALOGY_S3_BUCKET",
  "GENEALOGY_S3_ACCESS_KEY",
  "GENEALOGY_S3_SECRET_KEY",
] as const;

export const DEFAULT_ANCHOR_PATH = "/project";

export interface PgS3Env {
  backendOptions: PgS3BackendOptions;
  /** The one `projectPath` the tools pass for a project (`GENEALOGY_ANCHOR_PATH`). */
  anchorPath: string;
  /** Required variables that are unset or empty. `backendOptions` is not
   *  usable unless this is empty; the caller decides how to report it. */
  missing: string[];
}

export function readPgS3Env(env: NodeJS.ProcessEnv): PgS3Env {
  const missing = PG_S3_REQUIRED_ENV.filter((name) => !env[name]);
  const get = (name: (typeof PG_S3_REQUIRED_ENV)[number]): string => env[name] ?? "";
  return {
    backendOptions: {
      dsn: get("GENEALOGY_PG_DSN"),
      s3: {
        endpoint: get("GENEALOGY_S3_ENDPOINT"),
        bucket: get("GENEALOGY_S3_BUCKET"),
        accessKeyId: get("GENEALOGY_S3_ACCESS_KEY"),
        secretAccessKey: get("GENEALOGY_S3_SECRET_KEY"),
        forcePathStyle: true,
      },
    },
    anchorPath: env.GENEALOGY_ANCHOR_PATH || DEFAULT_ANCHOR_PATH,
    missing: [...missing],
  };
}
