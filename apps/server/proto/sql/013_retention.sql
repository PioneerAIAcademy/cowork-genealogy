-- U19: retention keyed on session inactivity (docs/plan/familysearch-handoff.md, U19).
-- A session idle past RETENTION_SESSION_IDLE_S, with no open turn, has its transcript,
-- events and tool calls purged by the worker's retention thread and is marked here, so
-- the web tier refuses a new message (410) rather than resume a transcript that is gone
-- and restart its spend cap at zero. Expand-only: one nullable column and four indexes.
-- Plain CREATE INDEX, as 007 and 011: each build holds SHARE on its table for its length,
-- seconds at prototype scale.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retired_at timestamptz;

-- The retention candidate scan, oldest first, over sessions not yet retired.
CREATE INDEX IF NOT EXISTS sessions_idle_idx ON sessions (updated_at) WHERE retired_at IS NULL;
-- "No turn open or completed inside the window" per candidate session.
CREATE INDEX IF NOT EXISTS turns_session_idx ON turns (session_id, completed_at);
-- tool_calls ageing per row, and the per-session purge (delete_session's too).
CREATE INDEX IF NOT EXISTS tool_calls_ts_idx ON tool_calls (ts);
CREATE INDEX IF NOT EXISTS tool_calls_session_idx ON tool_calls (session_id);
