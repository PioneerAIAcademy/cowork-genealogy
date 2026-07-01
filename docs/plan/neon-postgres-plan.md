# Neon Postgres on Fly, SQLite locally — DB backend plan

**Date:** 2026-06-06. **Branch:** `hosted-web-workbench`. **Read with:**
`fly-deploy-plan.md` (the deploy this amends), `hosted-web-workbench-POC-status.md`
(current state). **Touches:** `apps/server/app/{config,db,models,main}.py`,
`apps/server/pyproject.toml`, `deploy/fly.toml`.

> **Status: implemented** (the code changes below + `apps/server/uv.lock`,
> `apps/server/tests/conftest.py`). Verified locally on **SQLite** (`make
> server-test`, 30 green) and against a **live Postgres** (throwaway Docker pg):
> `/api/health` → `db:"postgres"`, `create_all()` builds all four tables, and a
> `/v1` create → message → delete round-trip works (the message exercises the
> turn-lock guarded `UPDATE` on native `timestamptz`). **Still manual** (deploy
> ops, no code): create the Neon project, `fly secrets set DATABASE_URL=…`,
> deploy, then `fly volumes destroy workbench_data`. The Docker image build
> (verification §4) was not run — low risk (psycopg ships a manylinux wheel and
> `uv lock` resolved it). The "What this does and doesn't unblock" section below
> is **superseded**: the `LiveSession`/`session_manager` pin it describes is gone
> (sandbox-as-server already shipped), and the `/v1` turn lock is already
> DB-backed — so the only remaining `count > 1` prerequisite in code terms is the
> `init_db` `release_command` (still out of scope here).

---

## Context

The control plane (`apps/server/`, FastAPI) stores all persisted state in
**SQLite** — users, the email allowlist, FamilySearch tokens, and the
session/project list. The engine is hardcoded in `apps/server/app/db.py`:

```python
_engine = create_engine(
    f"sqlite:///{_settings.db_path}",
    connect_args={"check_same_thread": False},
)
```

SQLite-on-a-Fly-volume is what keeps the DB on the local disk. Two other things
that wrote to that volume are already gone: the per-delta backup mirror (commit
`7d5abad`, *"anti-scaling, redundant"*) and feedback uploads (commit `079355f` —
`feedback.py` now POSTs to the Google Drive endpoint the Electron app uses, no
`DATA_DIR` write, `backup_dir` removed). Moving the DB to managed Postgres is the
remaining writer; once it lands, **nothing persistent remains on `DATA_DIR`** and
the volume can be destroyed.

(Removing the volume frees the DB pin — but it is **not** the whole multi-Machine
story; the per-session `LiveSession` is still held on one Machine. See "What this
does and doesn't unblock" below.)

**Goal:** make the DB backend environment-driven — **SQLite when running locally**
(zero-setup `make server`, unchanged) and **Neon Postgres when deployed on Fly**.

The change is small and surgical. The schema is pure SQLModel with **no
SQLite-specific SQL** (no `INSERT OR REPLACE`, `PRAGMA`, `json_extract`,
`AUTOINCREMENT`), so every `select/exec/get` query ports to Postgres unchanged.
The work is the engine wiring, one dependency, and a datetime-type hardening.

## Decisions (confirmed)

- **Keep `SQLModel.metadata.create_all()` on boot — no Alembic.** Matches POC
  posture; tables auto-create against Neon exactly as they do against SQLite.
- **Start fresh on Neon — no data migration** from the SQLite volume. The
  allowlist re-seeds from `ALLOWED_EMAILS`; users re-login and re-connect FS.
- **Neon direct connection endpoint** (not the PgBouncer `-pooler`). One
  always-on Fly Machine + SQLAlchemy's own pool; avoids transaction-pooling
  prepared-statement gotchas. Neon is the **POC** DB — when we actually scale we
  move to **RDS**, which (because the backend is env-driven `DATABASE_URL`) is a
  secret swap with **zero code change**.
- **Drop the Fly volume.** With the mirror and feedback already off the volume and
  the DB on Neon, nothing persistent remains on `DATA_DIR`.

## How the backend is selected

A single env var, `DATABASE_URL` (12-factor; no Fly-specific coupling):

- **Set** (Neon URL, provided as a Fly secret) → Postgres.
- **Unset** (local dev) → `sqlite:///{DATA_DIR}/workbench.db`, exactly as today.

---

## Changes

### 1. `config.py` — add the URL setting + resolver

```python
# ── Database ─────────────────────────────────────────────────
# Unset → SQLite under DATA_DIR (local dev). Set → Postgres (Neon on Fly),
# provided as a Fly secret. Neon hands out postgresql://… ; we pin psycopg3.
database_url: str | None = None
```

```python
@property
def sqlalchemy_url(self) -> str:
    url = self.database_url
    if not url:
        return f"sqlite:///{self.db_path}"
    # Neon connection strings are postgresql:// (sometimes postgres://).
    # SQLAlchemy needs the explicit psycopg(3) driver.
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url

@property
def is_sqlite(self) -> bool:
    return not self.database_url
```

### 2. `db.py` — branch the engine

Resolve the URL, apply SQLite's thread arg only for SQLite, and add Neon-friendly
pool settings. **No changes to `init_db()`, `get_session()`, or any query** —
`create_all()` and all SQLModel calls work identically on Postgres.

```python
_settings = get_settings()
_url = _settings.sqlalchemy_url

if _settings.is_sqlite:
    _engine = create_engine(_url, connect_args={"check_same_thread": False})
else:
    # Neon auto-suspends idle connections (scale-to-zero); pre_ping discards
    # dead pooled connections and recycle caps connection age.
    _engine = create_engine(_url, pool_pre_ping=True, pool_recycle=300)
```

`pool_pre_ping` + `pool_recycle` keep the pool **correct** after Neon auto-suspends
(scale-to-zero) — they discard dead connections, they do **not** mask the
first-query **latency** when Neon resumes (hundreds of ms to seconds). For an
alpha control plane that occasional cold hit is an accepted trade for keeping Neon
autosuspend on (cheap); do **not** disable autosuspend just to avoid it.

### 3. `models.py` — make datetime columns timezone-aware

The models build values with `datetime.now(timezone.utc)` (tz-aware). On Postgres
the default column type is `TIMESTAMP WITHOUT TIME ZONE`, which silently strips
tzinfo and returns **naive** datetimes — a latent `TypeError` the day any code
compares a read-back value to an aware `utcnow()`.

Nothing breaks **today**: the only live comparison — `Project.last_active < cutoff`
(`main.py:36`) — runs in **SQL** (bound param), and the `FamilySearchToken` table
(whose `expires_at` would be the obvious comparison site) is **defined but
entirely unused** — the FS token actually lives on the sandbox disk at
`~/.familysearch-mcp/tokens.json` (`familysearch.py`, "option (a)"), never in the
DB. So this is **correctness/consistency hardening + future-proofing**, not a fix
for a current bug. Declare the datetime columns as `TIMESTAMP WITH TIME ZONE`:

```python
from datetime import datetime, timezone
from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel

# none of the datetime fields are PK/indexed, so sa_type is clean:
created: datetime = Field(default_factory=utcnow, sa_type=DateTime(timezone=True))
```

Apply to all six datetime columns: `User.created`, `FamilySearchToken.expires_at`,
`FamilySearchToken.updated`, `Project.created`, `Project.updated`,
`Project.last_active`. SQLite behavior is unchanged (it round-trips the offset).

### 4. `pyproject.toml` — add the Postgres driver

```toml
"psycopg[binary]>=3.2",
```

`psycopg[binary]` bundles libpq, so **no Dockerfile/apt change** on the
`python:3.12-slim` base. After editing, regenerate and commit the lockfile:
`cd apps/server && uv lock` — the Dockerfile builds with `uv sync --frozen`, so
`apps/server/uv.lock` must reflect the new dependency.

### 5. `main.py` — surface the backend in `/api/health`

Add `"db": "postgres" if not _settings.is_sqlite else "sqlite"` to the health
payload (alongside `agentMode`/`provider`/`realtime`). One `curl` then confirms
Fly is on Neon and local is on SQLite.

---

## Deploy / provisioning

1. **Create the Neon project/database** (region near `iad`); copy the **direct**
   (non-`-pooler`) connection string — it already includes `?sslmode=require`.
2. **Set it as a Fly secret** (it carries the password → must not go in
   `fly.toml` `[env]`):
   ```bash
   fly secrets set DATABASE_URL="postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/DBNAME?sslmode=require"
   ```
3. **Deploy.** On boot, `init_db()` runs `create_all()` against Neon (fresh
   schema) and re-seeds the allowlist from `ALLOWED_EMAILS`.

### `deploy/fly.toml` edits

- **Remove the `[mounts]` block** (the `workbench_data` volume) — the DB is on
  Neon and the mirror + feedback are already off the volume, so nothing persistent
  remains on `DATA_DIR`. Destroy the volume after a clean deploy
  (`fly volumes destroy …`).
- **Realtime stays `local_ws` for the Fly alpha** (this container relays `/ws`).
  The affinity-free hosted path is `REALTIME=sandbox_ws` — the relay moves *into*
  the sandbox (see `ably-realtime-migration.md`); Ably is no longer used.

## What this does and doesn't unblock

**Does:** removes the **DB pin**. With the volume destroyed and the DB on Neon,
DB state no longer ties the app to one Machine.

**Doesn't (yet):** multi-Machine **chat/viewer**. Today the control plane still
holds the per-session `LiveSession` — the agent process + the `/project` watch — in
`app.state.session_manager` on the Machine that handled `/connect`/`/message`. So on
`fly scale count 2` **without sticky routing**, a session's `/connect` can land on
Machine A (agent + watch spawn on A) and its next `/message` on Machine B, where
`manager.ensure()` spawns a **second** agent + watch for the same session — two
agents writing the same `/project`. That is a correctness bug, not just waste.

So `fly scale count > 1` needs one more piece beyond this plan:

- **The sandbox becomes the per-session server** — today's relay (the agent
  `Process` + `/project` watch + pump) moves *into* the sandbox, which exposes one
  authenticated WSS the browser connects to directly; `agent_runner`'s stdio
  protocol is unchanged. The control plane holds **zero** per-session state, so any
  instance serves any request. Ably is dropped. **This is the committed fix** — see
  `ably-realtime-migration.md`.
- ~~**Fly session-sticky routing** as a stopgap~~ — **superseded.** Production
  runs on AWS behind a standard load balancer with **no sticky routing**
  allowed, so affinity must be removed, not routed around. Do not rely on sticky
  sessions.

**Also before count > 1:** move `init_db()` (`create_all()` + the allowlist seed)
off the per-boot path to a **one-time Fly `release_command`**. Two Machines booting
together otherwise race — both pass `create_all`'s existence check then both
`CREATE TABLE`, and both see an allowlist email absent then both `INSERT` the same
PK (`IntegrityError`) — crashing a boot. Harmless at count = 1; a `release_command`
runs the schema+seed once, before any Machine starts.

Then `auto_stop_machines` / `min_machines_running` / concurrency limits are retuned
for multi-Machine. Update `fly-deploy-plan.md`'s "Horizontal-scaling caveat": the
**DB** blocker is cleared by this plan; the `LiveSession` pin (the
sandbox-as-server fix in `ably-realtime-migration.md`) is the real remaining one.

---

## Verification

1. **Local SQLite (unchanged):** `make server` (no `DATABASE_URL`) boots;
   `curl localhost:8000/api/health` → `ok:true`, `db:"sqlite"`. DB at
   `.workbench-data/workbench.db`; create/list a session works.
2. **Local Postgres path:** exercise the branch without deploying, against a
   throwaway Docker Postgres or the Neon dev URL:
   ```bash
   cd apps/server && DATABASE_URL="postgresql://…?sslmode=require" \
     uv run uvicorn app.main:app --port 8000
   ```
   Confirm `init_db()` creates the 4 tables (`\dt`), health reports
   `db:"postgres"`, and a session create→list→delete round-trips.
3. **Tests:** `make server-test` stays green (runs on the SQLite default).
4. **Image:** `docker build -f deploy/Dockerfile -t workbench .` succeeds with the
   new lockfile (psycopg binary wheel installs cleanly).
5. **Deploy smoke test:** run `fly-deploy-plan.md` §"Smoke-test"; additionally
   confirm the session list survives `fly machine restart` (now persisted in Neon,
   no volume). **Stay at count = 1** — do *not* `fly scale count 2` yet; that needs
   the `release_command` + the sandbox-as-server fix above (sticky routing is **not**
   an option — production is AWS-no-sticky), else duplicate agents corrupt `/project`.

## Out of scope

Alembic/migrations; migrating existing SQLite data; the `REALTIME=sandbox_ws`
cutover (tracked separately); **the sandbox-as-server fix for the `LiveSession`
pin** (the real `count > 1` gate, out of scope here, called out above; sticky
routing is rejected for AWS-no-sticky production) and the
`init_db` `release_command`; multi-Machine tuning of `fly.toml`; the eventual
Neon → RDS move (a `DATABASE_URL` swap). The unused
`FamilySearchToken` table is left in place — whether to ever store the FS token in
the DB (and encrypt it at rest) is a separate POC follow-up.

*(The feedback off-Fly sink — once a co-condition for dropping the volume — already
shipped in `079355f`.)*
