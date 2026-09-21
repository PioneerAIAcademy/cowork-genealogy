-- D9-10 worker (docs/plan/search-agent-prototype.md, "Week 2"): what the real worker
-- records that the D3 stub did not. Additive and idempotent like 001-003 -- applied by
-- initdb on an empty volume AND by the worker at start (proto/worker/worker.py), so a
-- volume that predates this file gets the columns without a `make proto-down`.
--
-- sessions.sdk_session_id: the Agent SDK's session id, CHOSEN by the worker when the
-- session's first turn is claimed (one COALESCE write, before the CLI spawns) and
-- passed to the CLI as --session-id; every later turn on the session resumes it.
-- turns.cost_usd / num_turns / duration_ms: the completing attempt's ResultMessage.
-- turns.entries_seq_before: the session_entries high-water mark at the turn's FIRST
-- claim; turns.input_tokens / cache_creation_tokens / cache_read_tokens /
-- output_tokens: the usage summed over the assistant entries above it, one per API
-- message -- so a killed attempt's spend is on the row, which cost_usd is not.
-- tool_calls.tool_use_id: the CLI's id for the call, so the PostToolUse hook can stamp
-- the row the PreToolUse hook wrote with its duration (acceptance criterion 4).
-- turns.nudges (D18): how many times the worker's Stop hook vetoed the model's voluntary
-- yield on the completing attempt (AUTONOMOUS_MAX_NUDGES); 0 when the arm is off.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sdk_session_id        text;
ALTER TABLE turns    ADD COLUMN IF NOT EXISTS cost_usd              numeric;
ALTER TABLE turns    ADD COLUMN IF NOT EXISTS num_turns             int;
ALTER TABLE turns    ADD COLUMN IF NOT EXISTS duration_ms           int;
ALTER TABLE turns    ADD COLUMN IF NOT EXISTS nudges                int;
ALTER TABLE turns    ADD COLUMN IF NOT EXISTS entries_seq_before    bigint;
ALTER TABLE turns    ADD COLUMN IF NOT EXISTS input_tokens          bigint;
ALTER TABLE turns    ADD COLUMN IF NOT EXISTS cache_creation_tokens bigint;
ALTER TABLE turns    ADD COLUMN IF NOT EXISTS cache_read_tokens     bigint;
ALTER TABLE turns    ADD COLUMN IF NOT EXISTS output_tokens         bigint;
ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS tool_use_id         text;
