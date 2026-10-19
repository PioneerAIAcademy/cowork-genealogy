import { readPgS3Env } from "../../src/store/pg-s3-env.js";
import type { PgS3BackendOptions } from "../../src/store/pg-s3-project-store.js";

// The live suites' backend options, built through the same parse build/http.js
// runs: the `PROTO_*` variables `make proto-store-test` sets become the
// `GENEALOGY_*` map `readPgS3Env` reads. The keys pass through with no default,
// so an unset pair really is keyless, and path style is left to the derived
// default. `PROTO_S3_KEYLESS=1` drops the keys whatever is exported, so the
// credentials can only come from the SDK default chain (`AWS_*`).

export const PROTO_S3_KEYLESS = process.env.PROTO_S3_KEYLESS === "1";

export function protoBackendOptions(): PgS3BackendOptions {
  const env: NodeJS.ProcessEnv = {
    GENEALOGY_PG_DSN: process.env.PROTO_PG_DSN,
    GENEALOGY_S3_ENDPOINT: process.env.PROTO_S3_ENDPOINT,
    GENEALOGY_S3_BUCKET: process.env.PROTO_S3_BUCKET ?? "projects",
  };
  if (!PROTO_S3_KEYLESS) {
    env.GENEALOGY_S3_ACCESS_KEY = process.env.PROTO_S3_ACCESS_KEY;
    env.GENEALOGY_S3_SECRET_KEY = process.env.PROTO_S3_SECRET_KEY;
  }
  const parsed = readPgS3Env(env);
  if (parsed.missing.length > 0 || parsed.invalid.length > 0) {
    throw new Error(
      `PROTO_* store environment incomplete: missing [${parsed.missing.join(", ")}], invalid [${parsed.invalid.join(", ")}]`,
    );
  }
  return parsed.backendOptions;
}
