// The shape a project id must have. It is the S3 key prefix in the Pg/S3
// backend and the value of the `X-Genealogy-Project-Id` request header, so it
// lives here on its own — free of `pg`/`@aws-sdk` — for the HTTP entrypoint to
// validate a header without loading a backend.

/** `[A-Za-z0-9._-]` with a leading letter or digit: a `/` would let two
 *  projects share an S3 key. */
export const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
