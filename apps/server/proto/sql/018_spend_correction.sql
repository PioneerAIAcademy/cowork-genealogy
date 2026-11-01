-- The spend cap's view of compaction (U24, 2026-10-31).
--
-- session_spend_usd prices the session's transcript, and a compaction's summary call is
-- not in the transcript: on the gateway 5 of 5 summary calls were missing from
-- session_entries, $0.42 of a $2.27 session. The CLI's ResultMessage does count them.
--
--   spend_correction_usd  the sum, over this turn's attempts that returned a
--                         ResultMessage, of that attempt's total_cost_usd minus its
--                         transcript priced as the cap prices it, minus the per-compaction
--                         estimate the cap already adds for that attempt. With it, a
--                         completed attempt counts at the CLI's own figure, and an attempt
--                         killed before its result keeps the estimate.
--
-- Expand-only: one column, default 0, no backfill, and one index. A turn written before this reads 0,
-- which is what the cap counted for it then.
ALTER TABLE turns ADD COLUMN IF NOT EXISTS spend_correction_usd double precision NOT NULL DEFAULT 0;

-- The cap sums the corrections once per tool call (the PreToolUse halt check), reaching
-- turns through sessions.sdk_session_id, which had no index: without this, every tool
-- call scans sessions, as 007 found for session_entries.
CREATE INDEX IF NOT EXISTS sessions_sdk_session_idx ON sessions (sdk_session_id);
