-- S1: connector tokens, authorization codes and single-use sign-in state
-- (docs/plan/self-hosted-mcp-beta.md, S1). Idempotent for migrate.py's baseline (U9).
-- Every hash is the lowercase hex sha256 of the UTF-8 value, like turns.bearer_sha256
-- (apps/server/proto/worker/worker.py, stamp_bearer;
-- packages/engine/mcp-server/src/store/pg-s3-project-store.ts, authorizeAttempt).
-- Expiry is compared in SQL with Postgres's now(), so no host clock enters (grants.py)
-- and expiry columns are timestamptz. scopes is text[] because psycopg maps list[str]
-- directly to it. The code and token columns follow the mcp SDK's AuthorizationCode
-- and AccessToken models; the sign-in code converts at its store boundary.
-- The repo spells sign-in identifiers signin (signin_required, signin_options), hence
-- signin_states; used_at records consumption of its single-use state.

CREATE TABLE IF NOT EXISTS connector_tokens (
    token_sha256  text        PRIMARY KEY,
    user_id       text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id     text        NOT NULL,
    scopes        text[]      NOT NULL,
    resource      text,
    expires_at    timestamptz NOT NULL,
    ended_at      timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Ending every token of one user, and deleting by user, both look tokens up by user.
CREATE INDEX IF NOT EXISTS connector_tokens_user_idx ON connector_tokens (user_id);

CREATE TABLE IF NOT EXISTS authorization_codes (
    code_sha256                       text        PRIMARY KEY,
    user_id                           text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id                         text        NOT NULL,
    redirect_uri                      text        NOT NULL,
    redirect_uri_provided_explicitly  boolean     NOT NULL,
    code_challenge                    text        NOT NULL,
    scopes                            text[]      NOT NULL,
    resource                          text,
    expires_at                        timestamptz NOT NULL,
    created_at                        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signin_states (
    state_sha256  text        PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    used_at       timestamptz
);
