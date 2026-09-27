-- research-as-a-job 1b and 1c: Stop, and the message typed while a turn runs.
-- Additive and idempotent like 001-005 -- applied by initdb on an empty volume AND by the
-- worker and the web tier at start, so a volume that predates this file gets the column
-- without a `make proto-down`.
--
-- sessions.stop_requested_at (1c): the control-plane row Stop writes. Set by
-- POST /api/sessions/{id}/interrupt, read on the turn's own connection by BOTH worker
-- hooks -- the PreToolUse one, which fires on every tool call (a median of 2.6 s apart)
-- and is what actually halts the turn, and the Stop hook, whose `stopped()` clause keeps
-- it from immediately vetoing that halt. Cleared when the session's next message is
-- enqueued, which is what makes "a later message resumes it" true; a flag that outlived
-- the turn would wedge the session.
--
-- Why a column and not a table: one flag, one row per session, read twice per tool call
-- on a connection that already exists. A table would need its own id space and a join
-- for no gain at n=1.
--
-- The OTHER control-plane row 1b needs is NOT here: a message typed mid-turn is held as
-- an ordinary `turns` row carrying outcome = 'queued'. It IS a turn -- same id space,
-- same message jsonb, same session and project columns -- and the only thing separating
-- it from a live one is that it has not been enqueued yet. A second table would
-- duplicate turn identity and need its own promotion path. The cost, paid explicitly:
-- `turn_active` has to exclude it (completed_at IS NULL is true of a held row too), or
-- the very first held message would latch the hold on forever.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS stop_requested_at timestamptz;

-- The held-turn lookup runs once per completed turn and once per SSE poll.
CREATE INDEX IF NOT EXISTS turns_queued_idx ON turns (session_id) WHERE outcome = 'queued';
