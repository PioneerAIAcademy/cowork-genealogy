-- U2: patron sign-in and project ownership (docs/plan/u2-patron-sign-in.md).
-- Idempotent like every file here: the web tier and the worker apply sql/*.sql at each
-- start (until U9), and initdb applies it once.
--
-- projects.owner_id is NULLABLE on purpose: the engine creates projects with the id
-- alone (PgS3ProjectStore.touchProject), so a NOT NULL owner would fail every engine
-- write. A NULL owner means the project is visible to NOBODY, not to everybody -- the
-- web tier's owner check compares it with the caller and NULL never matches.
--
-- familysearch_tokens is keyed by user so U3 has one row per patron to lock, and
-- granted_at is set at sign-in and never on refresh: it is U3's 24 h clock. The alpha's
-- expires_at moves on every refresh, so it cannot serve. Both token columns hold
-- Fernet ciphertext only (web/auth.py encrypts before the store sees the value).

CREATE TABLE IF NOT EXISTS users (
    id                   text        PRIMARY KEY,
    email                text        NOT NULL UNIQUE,
    familysearch_id      text,
    sessions_revoked_at  timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allowed_emails (
    email  text  PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS familysearch_tokens (
    user_id            text        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token_enc   text        NOT NULL,
    refresh_token_enc  text,
    expires_at         timestamptz NOT NULL,
    granted_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id text REFERENCES users(id);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (owner_id);
