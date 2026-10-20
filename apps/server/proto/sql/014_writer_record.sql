-- What a write wrote, so "what changed this session" is answerable.
--
-- `tool_calls` stored tool_name and input_path and no payload, so the structured
-- table could not say what any write touched -- the captured session made 173 writes
-- and not one was recoverable. Change review, the highest-value item in the phase-3
-- plan, is blocked on exactly this.
--
-- The SHAPE of the write, never the payload: section, operation, the ids touched.
-- Storing whole entries would put every record body in the call log.
ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS wrote jsonb;

-- The review reads "writes in this session, newest first"; without this it scans
-- every call the session ever made.
CREATE INDEX IF NOT EXISTS tool_calls_wrote_idx
    ON tool_calls (session_id, id DESC) WHERE wrote IS NOT NULL;
