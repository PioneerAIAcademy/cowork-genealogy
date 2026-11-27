-- #4791: the host's automatic "Keep going." reply is retired. "Continue." is the only way
-- forward, a typed "keep going" runs one step like any other message, and no plane sends
-- a reply for the researcher.
--
-- A reply the chain queued and nothing has claimed yet (`message.auto`, held as `queued`)
-- is closed `superseded`, as the researcher's own message used to close one. This build's
-- claim no longer tells a host reply from a typed message, so a held one left open would
-- be released ahead of the researcher's next message, or out of a session they stopped.
-- Then the chain's run state and the index its previous-step query read are dropped.
-- Idempotent: a second run matches no row and drops nothing.
UPDATE turns SET outcome = 'superseded', completed_at = now()
 WHERE outcome = 'queued' AND completed_at IS NULL
   AND COALESCE((message ->> 'auto') = 'true', false);

DROP INDEX IF EXISTS turns_session_step_idx;

ALTER TABLE sessions DROP COLUMN IF EXISTS auto_reply;
