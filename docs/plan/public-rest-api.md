# Plan: Public `/v1` REST chat API for an external chatbot team

> **Status:** Proposed — for review.
> **Scope:** `apps/server/` only. The engine (`packages/engine/mcp-server/` + `packages/engine/plugin/`) and its
> `.mcpb`/plugin CI are untouched.

## Context

Another team wants to drive our server from a simple chatbot over plain REST.
They asked for three things: create a session, send a message and get the reply
back, and (later) send a message and stream the reply. They do **not** want our
browser machinery — WebSockets, Ably tokens, subscribe-only channels, viewer
state, sidecars.

The blocker is architectural: today chat is **fire-and-forget**. The browser
sends `{type:"user_msg"}` over a WebSocket (or `POST /api/sessions/{id}/message`
→ `202` for the Ably backend), and the agent's reply streams back *out of band*
as `agent_event` frames over a realtime channel (`apps/server/app/live_session.py`
→ `realtime.publish`), terminated by `{"kind":"turn_done"}`. **There is no
synchronous "send and get the reply in the HTTP response" path.** This plan adds
one cleanly, plus an SSE variant, behind a dedicated, versioned, bearer-auth
public surface — reusing the existing per-session agent process (and therefore
its cross-turn memory) untouched.

Design decisions (confirmed):
- **One message endpoint** with an OpenAI-style `stream` flag (sync → JSON,
  stream → SSE), not two endpoints.
- **Dedicated `/v1/*` surface** with lean shapes that hide internal fields.
- **Bearer API keys** (env-configured), not the browser cookie.

## Recommended design (the short version)

The reply isn't in the HTTP response today, so a sync endpoint must *observe one
turn's agent-event stream and detect `turn_done`*. The clean seam is an
**in-process listener fanout on `LiveSession`**, added at the single `_publish`
chokepoint (`LiveSession._publish`). It feeds the existing browser path
(`realtime.publish`) and a new REST consumer from the same call — and crucially
**touches none of the realtime backends** (`realtime/base.py`, `local_ws.py`,
`ably.py`), so the new API works regardless of which backend is deployed. On top
of that: a per-session **turn lock** for correctness, a thin **`/v1` router**,
**bearer-key auth** reusing the existing user model, and a shared
**`create_project(...)`** service so session creation isn't duplicated.

```
external client                          our server (apps/server)
───────────────                          ────────────────────────
POST /v1/sessions ───────────────────▶  create_project()  →  Project + sandbox
POST /v1/.../messages {stream?} ─────▶  ┌─ acquire per-session turn lock
                                         ├─ SessionManager.ensure()  (resume + agent)
                                         ├─ LiveSession.run_turn():
   (sync)  ◀── JSON {text,…} ───────────┤    add_listener() BEFORE send_input
   (stream) ◀── SSE delta…done ─────────┤    yield agent_events until turn_done
                                         └─ release lock
                          (browser viewers, if any, keep getting the same frames
                           via realtime.publish — unchanged)
```

## API contract (`/v1`, bearer-only)

All requests carry `Authorization: Bearer <key>`. All errors use one envelope:
`{"error": {"code": "...", "message": "..."}}` with stable codes (`unauthorized`
401, `session_not_found` 404, `session_busy` 409, `validation_error` 422,
`turn_timeout` 504, `internal_error` 500). Every response echoes `session_id`.

Delivering this envelope for **every** code requires an **app-level** handler, not
a router-scoped one: `401 unauthorized` is raised inside the bearer dependency and
`422 validation_error` is FastAPI's `RequestValidationError` — both fire before or
outside a router's `exception_handlers` and would otherwise return FastAPI's
default `{"detail": …}`. The handler keys on `request.url.path.startswith("/v1")`
so `/api/*` error shapes are untouched (see §5).

### `POST /v1/sessions` → create — `201`
```jsonc
// req
{ "title": "Cork research", "model": "claude-sonnet-4-6" }   // both optional
// res 201
{ "session_id": "prj_…", "title": "Cork research",
  "model": "claude-sonnet-4-6", "created_at": "2026-06-06T18:30:00Z" }
```
Lean `SessionOut` — no `sandbox_id`, `agent_session_id`, or `status`. (The
internal `sample` seed flag is **not** exposed.)

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
  `tool_use`/`tool_result` summaries (secondary; a simple chatbot ignores them).
  `thinking` events are dropped from the public surface.
- On an agent `error` event: `finish_reason:"error"`, include the message in an
  `error` field, still `200` (the turn completed). Sync turns are capped by a
  timeout → `504 turn_timeout` as a plain error envelope (**no** partial text: the
  agent keeps running, so the turn isn't actually done — steer long turns to
  streaming). The cap is the only way a sync call ends without a `turn_done`, since
  the runner emits `turn_done` even on agent error.

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
`turn_done→done`. The terminal `done` carries the full assembled text, so a
client that ignores deltas still gets the whole answer — making sync and stream
genuinely equivalent. Emit a `: keep-alive` SSE comment every ~15s during long
tool runs so proxies don't drop the connection.

### `DELETE /v1/sessions/{session_id}` → cleanup — `200`
```jsonc
{ "deleted": true, "session_id": "prj_…" }
```
Thin wrapper over the existing delete logic (`provider.delete` + row delete).
Lets the team release sandbox resources promptly instead of waiting on the
30-min idle-suspend reaper.

## Implementation

Smallest clean change set. New file: `apps/server/app/v1.py`.

### 1. `apps/server/app/live_session.py` — in-process turn observation
- `LiveSession.__init__`: add `self._listeners: set[asyncio.Queue[dict]] = set()`.
- Add `add_listener() -> asyncio.Queue` / `remove_listener(q)`.
- `LiveSession._publish`: fan out to listeners **before** the realtime publish,
  using `put_nowait` so the browser path is never blocked or starved by a slow REST
  consumer:
  ```python
  async def _publish(self, msg: dict) -> None:
      for q in self._listeners:
          try:
              q.put_nowait(msg)
          except asyncio.QueueFull:
              pass  # stalled consumer: drop rather than grow unbounded
      await self.realtime.publish(self.session_id, msg)
  ```
  Use a **bounded** queue (`maxsize`, e.g. 256), not an unbounded one. A client that
  opens an SSE stream and stops reading otherwise stalls `StreamingResponse` writes
  and lets its queue grow without bound — a memory-exhaustion vector on a public
  surface. On overflow, drop frames (the terminal `done` still carries the full
  assembled text) or, stricter, drop the listener and close the stream.
- Add `run_turn(msg_type, text, timeout_s)` async generator — register the
  listener **before** `send_input` (so the first frame can't be lost), then yield
  inner `event` dicts of `type=="agent_event"` frames until `kind=="turn_done"`,
  with a shrinking per-`get` deadline; `finally: remove_listener(q)` (leak-proof
  on timeout *and* client disconnect). Frames that aren't `agent_event` (status,
  viewer deltas) are skipped.
- **Turn integrity (drain-owns-the-lock).** The turn lock must stay held until the
  agent emits `turn_done`, *independent of the client*. The runner is sequential —
  it won't read the next stdin message until the current `handle_turn` finishes — so
  if the client times out or disconnects, the agent is still mid-turn. Run the drain
  in a task that owns the lock and consumes `run_turn` to `turn_done`; the HTTP
  handler tees frames off a queue the drain feeds. On disconnect/timeout the drain
  keeps going to `turn_done`, *then* releases. Without this the lock releases early
  (the `async with` unwinds on raise/cancel), a retry's `send_input` buffers behind
  the unfinished turn, and the old turn's trailing frames — *and its `turn_done`* —
  are mis-read as the new turn's reply. Full trace under Lifecycle → Turn integrity.
- `SessionManager.__init__`: add `self._turn_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)` and `def turn_lock(self, sid) -> asyncio.Lock`.
  This is **separate** from the existing `_locks` — reusing those would block
  `ensure`/`dispose`/idle-suspend for the whole minutes-long turn. Clean up
  `_turn_locks.pop(session_id, None)` in `dispose`/delete so the dict doesn't grow
  unbounded under a high-volume API caller (the existing `_locks` has the same
  latent leak).

### 2. `apps/server/app/config.py` — settings
- `api_keys: str = ""` (comma-separated `key:email` pairs) + an `api_key_map`
  property that parses to `{key: email}`.
- `v1_turn_timeout_seconds: int = 120` (sync timeout; streaming relies on
  heartbeats instead of a hard cap).

### 3. `apps/server/app/auth.py` — bearer dependency
- Add `get_api_client(creds = Security(HTTPBearer(auto_error=False)), session = Depends(get_session)) -> User`:
  reject non-bearer (`401 unauthorized`), `hmac.compare_digest` the credential
  against each configured key (constant-time), resolve to its email, and return
  `_upsert_user(session, email)` — so a key maps to the **same** `User` row the
  browser path would create. `/v1` is bearer-**only**; the browser keeps `/api/*`.
- **Authz decision (explicit):** the browser login path gates on `_is_allowed(email)`
  *before* `_upsert_user`; `get_api_client` deliberately does **not**. API keys are
  operator-granted (set in env), so presence in `api_key_map` *is* the grant; the
  `_is_allowed` allowlist governs self-service login only. A key can therefore mint a
  `User` for an email the allowlist would reject — intended, but state it so a
  reviewer doesn't read it as an accidental bypass.

### 4. `apps/server/app/sessions.py` — extract shared service
- Factor the body of `create_session` into
  `async def create_project(*, session, provider, user, title=None, model=None, sample=False) -> Project`.
- Repoint `create_session` at it; `/v1` calls it with `sample` defaulted off.
- Reuse `_owned(session, user, session_id)` for ownership in `/v1`.

### 5. `apps/server/app/v1.py` — NEW router
- `APIRouter(prefix="/v1", tags=["public-api"])`, all routes
  `Depends(get_api_client)`.
- Models: `SessionOut`, `CreateBody {title?, model?}`, `MessageBody {message, stream=False}`.
- A shared `_drive_turn(manager, session_id, project, body)` that:
  1. acquires the turn lock **non-blocking** and returns `409 session_busy` on
     failure — `acquired = await asyncio.wait_for(lock.acquire(), 0)` (or an
     equivalent try-acquire). Do **not** check `.locked()` then `async with`: that is
     check-then-act, and a concurrent caller would silently *queue* on the
     `async with` instead of getting `409`, contradicting the contract;
  2. with the lock held, `live = await manager.ensure(session_id, project)` (ensure
     **inside** the lock so the session can't be disposed mid-turn), and hold the
     lock until the agent's `turn_done` (drain-owns-the-lock, §1);
  3. bumps `project.last_active` (so idle-suspend won't reap an active session);
  4. `async for ev in live.run_turn(...)`: collect (sync) or format SSE (stream).
- Sync handler returns `SessionOut`-style JSON; stream handler returns
  `StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})`.
  **Bump `last_active` before streaming starts** (the request-scoped DB session
  may close before a long stream ends — don't touch it inside the generator).
- Register **app-level** exception handlers (in `main.py`) for `HTTPException` and
  `RequestValidationError` that emit the `{"error":{code,message}}` envelope when
  `request.url.path.startswith("/v1")` and otherwise fall through to FastAPI's
  default — a router-scoped handler can't catch the dependency-raised `401` or the
  framework-level `422` (see API contract above).

### 6. `apps/server/app/main.py` — wire it
- `from . import v1` and `app.include_router(v1.router)` after the existing
  `include_router` calls. Add the app-level `/v1` exception handlers here (§5).

### Lifecycle / edge cases
- **Keep-alive after a turn**: the `LiveSession` (and its long-lived agent
  process) stays up → cross-turn memory works for the team automatically as long
  as they reuse the `session_id`. Idle-suspend reclaims REST-only sessions:
  `has_local_subscribers` is `False` for them, so after `idle_suspend_seconds` it
  disposes + suspends; the next message re-`ensure`s (resumes the sandbox + agent).
  The headline promise is that memory survives this dispose/resume cycle — that
  path must be **tested**, not assumed (see Verification).
- **Client disconnect mid-stream / sync timeout**: `run_turn`'s `finally` removes
  the listener (no leak), but the drain task keeps consuming to `turn_done` while
  holding the turn lock (drain-owns-the-lock, §1). The agent finishes its turn; its
  frames are dropped for the gone client and still reach any browser viewer. Memory
  is preserved.
- **Turn integrity (was "known limitation").** This is a correctness requirement,
  not a follow-up. If the lock released when `run_turn` exits (on raise/cancel)
  rather than at `turn_done`: (1) turn A times out at 120s but the agent runs to
  ~180s; (2) the client retries with B at ~130s — the lock is free, so
  `send_input(B)` buffers behind A (the runner hasn't read it yet); (3) at ~180s A
  finishes and its trailing frames **plus `turn_done(A)`** flow to B's listener, so
  B returns A's leftover text and B's real answer is lost. Drain-owns-the-lock fixes
  it: the lock is held until `turn_done(A)`, so the retry correctly gets `409` until
  A truly finishes. Implementing `interrupt` in the runner (`agent/runner.py`
  currently ignores non-`user_msg`) is an alternative that *aborts* A on timeout
  instead of waiting it out — cleaner, larger, optional.

## Suggested changes to their request

What we'd push back on or improve vs. their stated 3-endpoint design, to keep the
architecture clean and the DX excellent:

1. **Two send-endpoints → one** `POST /v1/sessions/{id}/messages` with
   `stream:true`. Same OpenAI mental model, half the surface, no handler drift.
2. **Don't return our session object.** Create returns `{session_id, title,
   model, created_at}`; their client depends only on `session_id`. We hide
   `sandbox_id`/`agent_session_id`/`status` behind `/v1`.
3. **Bearer keys, not cookies** — the right fit for a server-to-server caller
   (no login flow, no CSRF surface).
4. **Steer to streaming for real turns.** Genealogy turns invoke tools and can
   run tens of seconds; sync is capped (`504`) and best for short Q&A. Streaming
   (continuous bytes + heartbeat) sidesteps client/proxy idle timeouts.
5. **One message at a time per session** (single long-lived agent process):
   overlapping turns get `409 session_busy`. The natural chatbot pattern
   (await the reply, then send the next) already satisfies this; tell the team to
   treat `409` as "retry after a short backoff" — it can also appear briefly after a
   timed-out turn while the prior turn drains (see Turn integrity).
6. **We add `DELETE /v1/sessions/{id}`** (not in their list) for prompt resource
   cleanup.
7. **Consistent `{error:{code,message}}` envelope** so their client branches on
   `error.code`, not prose.

Explicitly **not** building now (over-engineering for a POC): DB-backed key table
/ hashing / rotation / scopes / rate limits, message-history endpoints,
idempotency keys, `include_thinking`, a second (WebSocket) streaming transport.

## Verification

Runs fully on mocks (`agent_mode=mock`, `realtime=local_ws`, `sandbox=local`) —
no Anthropic/Ably/E2B needed.

1. **Unit/integration tests** (pytest, `apps/server/`), using `MockRealtime` +
   the mock agent — mirror the existing `test_ably_flow.py` style:
   - sync: assembled `text` equals concatenated mock `text` events; `finish_reason:"stop"`.
   - stream: SSE frames parse; the terminal `done` payload's `text` equals the sync text.
   - `409 session_busy` when a second turn starts while one holds the turn lock.
   - **turn integrity**: time out (or disconnect) turn A while the mock agent is
     mid-turn, immediately send turn B, and assert B's reply is B's — not A's
     trailing text. Guards the drain-owns-the-lock fix (§1); the test most likely to
     fail without it.
   - **memory across idle-suspend**: with a short `idle_suspend_seconds`, send a
     turn, let the session dispose + suspend, then send a follow-up that references
     the first and assert the resumed agent still has context. This is the doc's
     headline DX promise.
   - auth: missing/invalid bearer → `401`; valid key → `200` and a `Project`
     owned by the mapped user. Error bodies use the `{"error":{code,message}}`
     envelope (assert it for `401` and for a `422` from a malformed body).
   - `DELETE` removes the row and calls `provider.delete`.
2. **Live smoke** with `API_KEYS=sk_dev:dallan@gmail.com make server`:
   ```bash
   K="Authorization: Bearer sk_dev"
   SID=$(curl -s -H "$K" -XPOST localhost:8000/v1/sessions \
         -d '{"title":"t"}' | jq -r .session_id)
   curl -s -H "$K" -XPOST localhost:8000/v1/sessions/$SID/messages \
        -d '{"message":"hello"}' | jq          # sync JSON
   curl -N -H "$K" -XPOST localhost:8000/v1/sessions/$SID/messages \
        -d '{"message":"hello","stream":true}' # SSE stream
   ```
   Confirm cross-turn memory by sending a second message that references the
   first. Confirm `make test` passes (server-only changes).

### Critical files
- `apps/server/app/live_session.py` — listener fanout + `run_turn` + turn lock
- `apps/server/app/v1.py` — NEW router (create / messages / delete, SSE)
- `apps/server/app/auth.py` — `get_api_client` bearer dependency
- `apps/server/app/sessions.py` — extract `create_project(...)`
- `apps/server/app/config.py` — `api_keys` / `api_key_map` / `v1_turn_timeout_seconds`
- `apps/server/app/main.py` — register `v1.router`
```
