-- #3992: the index the sign-in state's cleanup reads (docs/plan/self-hosted-mcp-beta.md, W2).
--
-- With the chat off, every GET /auth/familysearch/login inserts one signin_states row and,
-- in the same transaction, deletes the rows older than the state cookie's ten minutes
-- (PgStore.create_signin_state). That route takes no cookie, and 017 gave the table only its
-- primary key, so without this the DELETE scans every row a flood of logins has written.
--
-- Expand-only and idempotent for migrate.py's baseline (U9): one index, no backfill.
CREATE INDEX IF NOT EXISTS signin_states_created_at_idx ON signin_states (created_at);
