-- U6: the index PgSessionStore.append's uuid dedupe probes. The SDK retries a failed
-- append (3 attempts, sequentially) and asks adapters to treat entry["uuid"] as an
-- idempotency key, so a batch that committed while its client saw an error is skipped
-- on the retry rather than stored twice. The append's NOT EXISTS spells the expression
-- `entry->>'uuid'` exactly as below, under the same leading key columns.
--
-- Non-unique on purpose: a database whose mirror already stored a duplicate must still
-- build it, and entries without a uuid (titles, tags, mode markers) repeat legitimately.
-- Plain CREATE INDEX, not CONCURRENTLY: migrate.py runs each file in a transaction.
-- Its lock_timeout bounds only the wait to take SHARE; once held, transcript appends
-- (and, through the fenced append's FOR SHARE, that turn's close or re-claim) wait for
-- the whole build -- seconds at prototype scale, under the SDK's 60 s append timeout (as 007).
-- Additive and idempotent like 001-010.

CREATE INDEX IF NOT EXISTS session_entries_uuid_idx
    ON session_entries (project_key, session_id, subpath, (entry->>'uuid'));
