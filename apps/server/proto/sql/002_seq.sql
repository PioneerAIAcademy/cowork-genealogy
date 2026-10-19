-- Per-session event sequence. One UPDATE ... RETURNING upsert on session_seq per call,
-- never a Postgres sequence: a sequence is global and gap-prone under rollback, and
-- session_events needs a dense per-session seq so a client can say "give me
-- everything after N" and get exactly what it missed.
--
-- The row lock the UPDATE takes serialises concurrent callers for the same session;
-- different sessions never contend.

CREATE OR REPLACE FUNCTION next_session_seq(p_session_id text)
RETURNS bigint
LANGUAGE sql
AS $$
    INSERT INTO session_seq (session_id, last)
    VALUES (p_session_id, 1)
    ON CONFLICT (session_id) DO UPDATE
        SET last = session_seq.last + 1
    RETURNING last;
$$;
