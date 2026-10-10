-- U6 (R8): the claim's fencing token. Minted by every claim of an OPEN turn
-- (worker.CLAIM_TURN_SQL), bumped by an epoch-less close (the sweep; the web tier's
-- fail_turn), and matched by every write a superseded attempt could still make:
-- complete()/close_turn, the zero-progress counter, the transcript mirror
-- (PgSessionStore.append), and the tool server's commit
-- (PgS3ProjectStore.runTransaction). 0 = never claimed. A constant
-- default, so the ADD is metadata-only on PG >= 11.
ALTER TABLE turns ADD COLUMN IF NOT EXISTS claim_epoch bigint NOT NULL DEFAULT 0;
