-- D3 Postgres schema for the search-agent prototype
-- (docs/plan/search-agent-prototype.md, "Week 1" D3). Idempotent: every statement is
-- CREATE ... IF NOT EXISTS, so re-running against a populated database is a no-op.
-- Applied by the postgres container's /docker-entrypoint-initdb.d on first start.
--
-- No foreign keys, on purpose: the D3 stub worker upserts sessions/turns from a
-- message body and nothing creates projects yet. Constraints arrive with the real
-- ProjectStore (D6-8), which is also when documents/blobs/staging get their writers.
-- There is NO committed_batches table (cut 2026-09-10).

CREATE TABLE IF NOT EXISTS projects (
    project_id  text        PRIMARY KEY,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- research.json and tree.gedcomx.json live here from D6-8, one row per document.
CREATE TABLE IF NOT EXISTS documents (
    project_id  text        NOT NULL,
    name        text        NOT NULL,
    version     int         NOT NULL DEFAULT 1,
    doc         jsonb       NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS blobs (
    project_id  text        NOT NULL,
    key         text        NOT NULL,
    s3_key      text        NOT NULL,
    bytes       int         NOT NULL,
    sha256      text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, key)
);

-- The results-staging index. The plan is explicit that this must be a table, never
-- an S3 LIST.
CREATE TABLE IF NOT EXISTS staging (
    project_id  text        NOT NULL,
    staging_id  text        NOT NULL,
    log_id      text,
    s3_key      text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, staging_id)
);

-- The SDK SessionStore: one row per transcript entry, replayed in seq order. Same
-- shape the P1 cross-process resume probe proved.
CREATE TABLE IF NOT EXISTS session_entries (
    project_key text        NOT NULL DEFAULT '',
    session_id  text        NOT NULL,
    subpath     text        NOT NULL DEFAULT '',
    seq         bigserial   PRIMARY KEY,
    entry       jsonb       NOT NULL
);

CREATE INDEX IF NOT EXISTS session_entries_key_idx
    ON session_entries (project_key, session_id, subpath, seq);

CREATE TABLE IF NOT EXISTS sessions (
    session_id  text        PRIMARY KEY,
    project_id  text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per queue message. A redelivered message carries the same turn_id and the
-- claim must be granted immediately (plan "Locking") - that IS the resume path.
CREATE TABLE IF NOT EXISTS turns (
    turn_id       text        PRIMARY KEY,
    session_id    text        NOT NULL,
    project_id    text        NOT NULL,
    message       jsonb       NOT NULL,
    enqueued_at   timestamptz NOT NULL DEFAULT now(),
    claimed_at    timestamptz,
    completed_at  timestamptz,
    outcome       text,
    receive_count int         NOT NULL DEFAULT 0
);

-- Per-session event log. seq comes from next_session_seq() in 002_seq.sql
-- (UPDATE ... RETURNING on session_seq), never from a Postgres sequence, so it is
-- dense and per-session.
CREATE TABLE IF NOT EXISTS session_events (
    session_id  text        NOT NULL,
    seq         bigint      NOT NULL,
    kind        text        NOT NULL,
    payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    ts          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS session_seq (
    session_id  text        PRIMARY KEY,
    last        bigint      NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_activity (
    session_id  text        PRIMARY KEY,
    payload     jsonb       NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- D15's deny-and-log target: one row per tool call the worker saw, with the hook's
-- decision and the measured duration (the plan's "look at them" tripwire).
CREATE TABLE IF NOT EXISTS tool_calls (
    id          bigserial   PRIMARY KEY,
    turn_id     text        NOT NULL,
    session_id  text        NOT NULL,
    agent_id    text,
    agent_type  text,
    tool_name   text        NOT NULL,
    input_path  text,
    decision    text        NOT NULL,
    duration_ms int,
    ts          timestamptz NOT NULL DEFAULT now()
);
