-- S1: beta users by FamilySearch id (docs/plan/self-hosted-mcp-beta.md, S1).
-- Expand-only, no backfill: terms_accepted_at is NULL until acceptance is recorded,
-- blocked_at is NULL for an unblocked user, and openrouter_key_enc is NULL until linked.
-- Every statement is idempotent for migrate.py's unledgered baseline (U9).

-- NULLs do not collide, so dev-login users with no id are unaffected. On a populated
-- database two rows already sharing an id make this file's transaction fail; find them first:
-- SELECT familysearch_id, count(*) FROM users WHERE familysearch_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS users_familysearch_id_key ON users (familysearch_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
-- Fernet ciphertext only, like familysearch_tokens.access_token_enc.
ALTER TABLE users ADD COLUMN IF NOT EXISTS openrouter_key_enc text;
