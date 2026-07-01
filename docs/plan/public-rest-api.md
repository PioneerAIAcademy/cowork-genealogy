# Plan: Public `/v1` REST chat API for an external chatbot team

> **Status:** Implemented in `apps/server/app/v1.py` (+ small hooks in
> `config.py`, `auth.py`, `sessions.py`, `main.py`). Server-only; the engine
> (`packages/engine/`) and its `.mcpb`/plugin CI are untouched.
>
> **History:** the original proposal targeted a control-plane `LiveSession`
> with an in-process `_publish` listener fanout over pluggable `realtime`
> backends. That architecture was removed by the realtime re-architecture
> (`ably-realtime-migration.md` / `realtime-rearch-status.md`): **the agent
> stream now lives inside the sandbox** (`app/sandbox_server.py`'s `Hub`), and
> the browser connects a WebSocket straight to it — the control plane is out of
> the streaming path. This doc has been rewritten to match what shipped.

## Context

Another team wanted to drive our server from a simple chatbot over plain REST:
create a session, send a message and get the reply, and (later) stream the reply.
They do **not** want our browser machinery (WebSockets, viewer state, sidecars).

The relevant architectural fact: there is no synchronous "send and get the reply
in the HTTP response" path for the browser, because the agent's reply streams over
a WebSocket **from inside the sandbox** to the browser; the control plane never
sees an `agent_event`. So a sync/SSE REST endpoint must observe one turn's stream
some other way.

Design decisions (confirmed with the requester):
- **One message endpoint** with an OpenAI-style `stream` flag (sync → JSON,
  stream → SSE), not two endpoints.
- **Dedicated `/v1/*` surface** with lean shapes that hide internal fields.
- **Bearer API keys** (env-configured), not the browser cookie.
- **Isolated bearer-only sessions, horizontally-scalable control plane:** one turn
  at a time per session, enforced by a **DB-backed lock** (correct across instances),
  not in-process state.

## As-built design (the short version)

To "send a message and get the reply," the `/v1` handler **becomes a WebSocket
client of the sandbox** — it does exactly what the browser does:

1. Reuse the `/connect` plumbing: `provider.resume(sandbox_id)` +
   `sandbox.expose_port(SANDBOX_WS_PORT)` + `mint_token(sandbox_id)` →
   a `ws(s)://…/?token=…` URL (Local → `ws://127.0.0.1:port`, E2B → `wss://…e2b.app`).
2. Open the socket, **drain the snapshot/history replay burst** the `Hub` sends on
   connect (read until the socket goes idle), then `send({type:"user_msg"})`.
3. Read `agent_event` frames until `kind:"turn_done"`, assembling the reply (sync)
   or relaying it as SSE (stream).

This touches none of the in-sandbox protocol and works for both providers (the CP
already ships the `websockets` client). A per-session **DB-backed turn lock** (a
guarded `UPDATE` on `Project.turn_locked_at`) gives `409 session_busy` for overlapping
turns and stays correct across control-plane instances; **ownership** (`_owned`)
isolates one client's sessions from another's; a **bearer-key dependency** maps a key
to the same `User` the browser path would create.

### Why the turn lock is in the DB (horizontal scaling)

The control plane runs **N instances** (Fly `count > 1`, AWS-no-sticky), so requests
for one session land on any instance — an in-memory lock wouldn't be shared. The
sandbox-as-server re-arch already removed all *other* per-session state from the
control plane; this lock was the last piece. It lives as one nullable, tz-aware
column on the `Project` row, claimed by an atomic guarded write:

```sql
UPDATE projects SET turn_locked_at = :now, last_active = :now
WHERE id = :sid AND (turn_locked_at IS NULL OR turn_locked_at < :stale_before)
-- rowcount == 1 → acquired;  rowcount == 0 → 409 session_busy
```

The DB serializes the conditional write, so exactly one caller wins (a true
test-and-set, not check-then-act). It is **pooler-safe** (no session-level state —
Postgres advisory locks would break behind Neon's pooler), **self-heals** via the
`stale_before` clause (`v1_turn_lock_stale_seconds`, default 600s — a crashed
instance's lock is reclaimed), and uses only portable SQLModel/SQLAlchemy. It is
correct on **SQLite today** (SQLite serializes writes globally) and on **Neon
Postgres later** with zero changes, riding the `neon-postgres-plan.md` migration
cleanly: `create_all()` auto-adds the column (no Alembic, per that plan's decision),
and the column is declared `DateTime(timezone=True)` to match the datetime-hardening
that plan applies to the other columns. Release is a guarded `UPDATE … SET
turn_locked_at = NULL WHERE turn_locked_at = :token` (only if we still hold it, so a
staleness takeover isn't clobbered), run on a fresh session since a streaming turn
releases after the request-scoped session closes.

> The bulk `UPDATE` is issued with `synchronize_session=False`: the comparison must
> happen in SQL only. SQLite reads a tz-aware column back **naive**, so the default
> Python-side WHERE re-evaluation against the loaded `Project` would compare naive vs
> aware and `TypeError`. We capture `sandbox_id` before acquiring and never reuse the
> in-session object, so SQL-only sync is correct.

**Prerequisite for `count > 1` (not this PR):** the shared-DB migration
(`neon-postgres-plan.md`) must land first — today's SQLite-on-a-Fly-volume is
per-machine, so at `count > 1` *all* control-plane state (users, allowlist, sessions,
ownership) diverges, not just this lock. That plan also calls out moving `init_db()`
to a one-time Fly `release_command` (two Machines booting otherwise race on
`create_all` + the allowlist seed). The `LiveSession` pin that plan names as the other
blocker is already resolved (it's the sandbox-as-server architecture this API builds
on).

```
external client                          control plane (apps/server)            sandbox (sandbox_server.Hub)
───────────────                          ──────────────────────────            ───────────────────────────
POST /v1/sessions ───────────────────▶  create_project() → Project + sandbox
POST /v1/.../messages {stream?} ─────▶  acquire per-session turn lock (409 if held)
                                         resume + expose_port + mint_token ──▶  (WS server listening)
                                         open WS ───────────────────────────▶  replay snapshot+history
                                         drain replay until idle
                                         send {user_msg} ───────────────────▶  spawn/feed agent_runner
   (sync)  ◀── JSON {text,…} ───────────  read agent_event … turn_done  ◀────  broadcast agent_event…turn_done
   (stream)◀── SSE delta…done ──────────  (same frames, formatted as SSE)
                                         close WS; release lock
```

**Why this is correct on retry without a "drain-owns-the-lock" task:** the in-sandbox
runner is sequential (it won't read the next `user_msg` until the current turn emits
`turn_done`). If a sync turn times out (504) and the lock releases, a retry opens a
*fresh* WS and drains-until-idle — but the prior turn is still emitting frames, so
there is no idle gap and the drain simply waits the prior turn out before sending.
The retry therefore never mis-reads the prior turn's trailing frames as its own reply.

## API contract (`/v1`, bearer-only)

All requests carry `Authorization: Bearer <key>`. All errors use one envelope:
`{"error": {"code": "...", "message": "..."}}` with stable codes (`unauthorized`
401, `session_not_found` 404, `session_busy` 409, `validation_error` 422,
`turn_timeout` 504, `internal_error` 500). Delivered by **app-level** handlers
(`main.py`) keyed on `request.url.path.startswith("/v1")` — a router-scoped handler
can't catch the dependency-raised 401 or the framework-level 422; `/api/*` shapes
fall through to FastAPI's defaults.

### `POST /v1/sessions` → create — `201`
```jsonc
// req  (all optional)
{ "title": "Cork research", "model": "claude-sonnet-4-6",
  // FamilySearch token for the in-sandbox MCP. /v1 clients have no FS app-login row,
  // so they pass it here; injected into the sandbox at create, never persisted.
  "familysearch_token": { "access_token": "…", "refresh_token": "…", "expires_in": 3600 } }
// res 201  — lean SessionOut: no sandbox_id / agent_session_id / status / sample
{ "session_id": "prj_…", "title": "Cork research",
  "model": "claude-sonnet-4-6", "created_at": "2026-06-07T23:18:14Z" }
```
- `familysearch_token` is **optional**. Omit it for an FS-tool-less session (the agent
  runs but FS-authenticated tools fail with "not logged in"). Supply it to authenticate
  FS tools. Only `access_token` is required; `expires_in` defaults to 3600s.
- **Include `refresh_token`** (OAuth `offline_access`) for any session that may outlive
  the access token: FS access tokens last ~1h, so a multi-hour session needs it. The
  token is self-refreshed **in-sandbox** by the engine's `getValidToken()` — the same
  mechanism the browser path relies on — so a single create-time injection suffices for
  the life of the sandbox. Without a refresh token the session works only until the
  access token expires. The token is injected straight into the sandbox and is **not**
  written to the `familysearch_tokens` table (so /v1 sidesteps encrypt-at-rest).

### `POST /v1/sessions/{session_id}/messages` → send + reply
```jsonc
// sync (stream omitted/false) → 200 application/json
{ "message": "search for census records" }
{ "session_id": "prj_…", "role": "assistant",
  "text": "Found a strong census match…",
  "tool_calls": [{ "tool": "record_search", "summary": "…" }],
  "finish_reason": "stop" }        // "stop" | "error"
```
- `text` = all `kind:"text"` events concatenated. `tool_calls` = flattened
  `tool_use`/`tool_result` summaries (secondary). `thinking` is dropped.
- On an agent `error` event: `finish_reason:"error"` + an `error` field, still `200`
  (the runner emits `turn_done` even on agent error). The only way a sync call ends
  without `turn_done` is the timeout → `504 turn_timeout` (no partial text; steer
  long turns to streaming).

```jsonc
// stream (stream:true) → 200 text/event-stream
{ "message": "search for census records", "stream": true }
```
```
event: delta
data: {"type":"text","text":"Found a strong census match. "}

event: tool
data: {"type":"tool_use","tool":"record_search","summary":"…"}

event: done
data: {"session_id":"prj_…","text":"Found a strong census match. …","finish_reason":"stop"}
```
Public taxonomy: `text→delta`, `tool_use`/`tool_result→tool`, `error→error`,
`turn_done→done`. The terminal `done` carries the full assembled text (sync ≡ stream).
A `: keep-alive` comment is emitted every ~15s so proxies don't drop a long stream.

### `DELETE /v1/sessions/{session_id}` → cleanup — `200`
```jsonc
{ "deleted": true, "session_id": "prj_…" }
```
`provider.delete` + row delete (the turn lock is a column on that row → gone with it).
Lets the team release sandbox resources promptly.

## Implementation (as shipped)

- **`config.py`** — `api_keys: str` (comma-separated `key:email`) + `api_key_map`
  property; `v1_turn_timeout_seconds: int = 120` (sync cap; streaming uses heartbeats);
  `v1_turn_lock_stale_seconds: int = 600` (turn-lock staleness TTL).
- **`auth.py`** — `get_api_client(Security(HTTPBearer(auto_error=False)), …)`:
  reject non-bearer (`401`), `hmac.compare_digest` against each configured key,
  resolve email → `_upsert_user`. **Deliberately NOT gated on `_is_allowed`**: API
  keys are operator-granted, so presence in `api_key_map` *is* the grant; the Gmail
  allowlist governs self-service login only.
- **`models.py`** — `Project.turn_locked_at: datetime | None` (nullable,
  `DateTime(timezone=True)`) — the DB-backed turn lock (see above).
- **`sessions.py`** — `create_project(*, session, provider, user, title, model, sample,
  fs_token)` factored out of `create_session`; `_owned` reused for ownership/isolation.
  `fs_token` (a `FsTokenIn`) is the optional caller-supplied FamilySearch token: when
  present it is injected into the sandbox and takes precedence over the user's stored
  row (and is never persisted); when absent the browser path's DB-row lookup runs.
- **`app/v1.py`** — `APIRouter(prefix="/v1")`, all routes `Depends(get_api_client)`.
  `_acquire_turn` / `_release_turn` (the guarded-UPDATE lock), `_open_ws` (resume+
  expose+mint, with a brief connect-retry since we connect to the freshly-launched WS
  server in-process), `_drain_replay`, `_normalize`, `_collect_sync`, `_handle_sync`,
  `_handle_stream` (SSE), and the three routes.
- **`main.py`** — `include_router(v1.router)`; the two app-level `/v1` exception
  handlers.

### Concurrency / lifecycle
- **One turn at a time per session.** `_acquire_turn` (guarded `UPDATE` on
  `Project.turn_locked_at`) → `409 session_busy` on `rowcount == 0`; held until the
  turn ends (`_release_turn`), correct across control-plane instances. See "Why the
  turn lock is in the DB" above. The drain-until-idle property also keeps a retry after
  a timeout correct (it waits out a still-running prior turn).
- **Cross-turn memory** survives because the agent process stays up in the sandbox
  between turns as long as the team reuses `session_id`. Idle reclamation is the
  provider's job now (E2B auto-suspend; LocalProvider no-op) — the next message
  re-launches the server and resumes the agent.
- **Isolation.** `get_api_client` maps each key → a distinct `User`; `_owned` returns
  the same `404` for "not found" and "not yours," so a client cannot reach (or probe)
  another client's sessions even with the exact id. Session ids are already 64-bit
  random (`prj_` + `uuid4().hex[:16]`) — defense-in-depth, not the load-bearing gate.
  Operator practice: give each distinct client a distinct email in `api_keys`.

## Suggested changes to their request (kept)

1. Two send-endpoints → one with `stream:true`. 2. Don't return our session object —
lean `{session_id,title,model,created_at}`. 3. Bearer keys, not cookies. 4. Steer to
streaming for real (tool-running) turns; sync is capped (`504`). 5. One message at a
time per session (`409` → retry after a short backoff). 6. We add `DELETE`. 7.
Consistent `{error:{code,message}}` envelope.

Explicitly **not** built (over-engineering for a POC): DB-backed key table / hashing /
rotation / scopes / rate limits, message-history endpoints, idempotency keys,
`include_thinking`, a WebSocket streaming transport. (The turn lock *is*
multi-instance-correct — it's DB-backed.)

## Verification (done)

Runs fully on mocks (`agent_mode=mock`, `sandbox=local`).

- **`apps/server/tests/test_v1_api.py`** (green): sync assembled text; SSE `done` text
  equals sync; `409 session_busy` (a held DB lock); **stale lock reclaimed** (a lock
  past the TTL doesn't wedge the session); `422`/`401`/`404` envelopes; operator-granted
  key bypasses the allowlist; cross-client `404` isolation; delete releases the sandbox
  and `404`s after; **create-time FamilySearch token injection** (a supplied token lands
  in the sandbox tokens.json, is not persisted to the DB, is absent when omitted, and a
  blank `access_token` is a `422`).
- **Live smoke** (`API_KEYS=sk_dev:… uvicorn app.main:app`): create → two sequential
  sync turns on the same session that **advance the agent's conversation state** (greet
  → experience acknowledged), confirming both the long-lived agent process / cross-turn
  memory *and* that the DB lock is released between turns; SSE turn; bad key → `401`
  envelope; delete → `{deleted:true}`.

### Critical files
- `apps/server/app/v1.py` — the router + WS-client turn driver + DB turn lock (create / messages / delete, SSE)
- `apps/server/app/auth.py` — `get_api_client` bearer dependency
- `apps/server/app/sessions.py` — `create_project(...)` + `_owned`
- `apps/server/app/models.py` — `Project.turn_locked_at` (the DB lock column)
- `apps/server/app/config.py` — `api_keys` / `api_key_map` / `v1_turn_timeout_seconds` / `v1_turn_lock_stale_seconds`
- `apps/server/app/main.py` — register `v1.router` + the `/v1` error envelope handlers
