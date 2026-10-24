-- Step mode (decision 25, docs/plan/research-step-mode.md): what a turn is DOING.
--
-- The worker's PreToolUse enforces one step per turn, and its hook is rebuilt on every
-- attempt. Redelivery is the normal resume path, so without these two columns a
-- redelivered attempt starts with an empty step list, believes it is opening the turn,
-- and lets a SECOND step through -- the exact failure the boundary exists to stop.
--
--   step  the agent this turn OPENED with, bare (no plugin prefix). NULL for a turn
--         that ran no step: a question answered from the project, an upload, a turn
--         that ended before spawning anything. `next_auto_reply` reads prev_step from
--         the last closed turn with a NON-NULL step, so such a turn is skipped rather
--         than resetting the chain (section J).
--   mode  `step`, `job` or `wrapup`, from `step_mode(text)` of the turn's own message.
--         Stored rather than recomputed because the message is not on the turn row.
--
-- Expand-only: two nullable columns, no backfill. Every turn written before this reads
-- NULL for both, which is what a turn that ran no step reads anyway, so nothing has to
-- distinguish "before step mode" from "ran no step" -- neither is a step to continue.
ALTER TABLE turns ADD COLUMN IF NOT EXISTS step text;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS mode text;

-- `prev_step` is "the session's last closed turn with a non-null step", which is the
-- only query these columns add. Partial, so it indexes just the rows that answer it.
CREATE INDEX IF NOT EXISTS turns_session_step_idx
    ON turns (session_id, completed_at DESC)
    WHERE step IS NOT NULL;

-- The "Keep going" run state (section A2). `next_auto_reply` is pure: it is handed the
-- state, returns the next one, and the host persists it. The run spans turns, so the
-- state cannot live in the worker process -- the turn that writes it and the turn that
-- reads it are different attempts, often on different machines.
--
--   auto_reply  {"replies": int, "planning_rounds": int, "answered": [[step, offer]]}
--               while a run is in flight, NULL otherwise. Cleared the moment a run ends,
--               so the researcher's next "Keep going." starts from an empty budget
--               rather than inheriting a spent one.
--
-- On `sessions`, not `turns`: it is a property of the run, and a turn row is written
-- before anyone knows whether a reply will follow it.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auto_reply jsonb;
