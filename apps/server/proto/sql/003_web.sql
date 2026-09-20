-- D11-13 web tier (docs/plan/search-agent-prototype.md, "Week 3"): the three columns the
-- reused SPA renders on a session and did not exist in the D3 schema. Additive and
-- idempotent like 001/002 -- applied by initdb on an empty volume AND by the web tier's
-- startup (proto/web/app.py, PgStore.apply_schema), so a volume that predates this file
-- gets the columns without a `make proto-down`.
--
-- NOT NULL DEFAULT, not nullable: SessionList.tsx calls `s.model.replace(...)` and
-- SessionView.tsx gates the agent-naming PATCH on the title still being the default.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title      text        NOT NULL DEFAULT 'New research session';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS model      text        NOT NULL DEFAULT 'claude-sonnet-4-6';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
