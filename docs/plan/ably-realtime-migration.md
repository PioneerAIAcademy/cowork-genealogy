# Ably realtime migration — moving fanout off the server WS relay

**Status:** plan (no app code yet). **Branch context:** `hosted-web-workbench`.
**Read with:** `hosted-web-workbench-POC-status.md` (current architecture),
`sandbox-provider-interface.md` (the layer below this, **unchanged**).
**Reviewers:** Dallan + eng reviewer. Dallan is creating an Ably account today;
this is the doc to review before/while it lands.

This plan covers **realtime fanout only** — how outbound view/chat frames get
from the control plane to the browser, and how chat input gets back. It does
**not** touch the engine (`mcp-server/`, `plugin/`) or the sandbox layer
(`SandboxProvider` / `agent_runner` stdio). The control plane still owns the
sandbox: it holds the `Process`, runs the `/project` watch, and mints tokens.
What changes is that the high-volume browser↔control-plane WebSocket goes away.

---

## 1. Why move off the local WS relay

Today (`apps/server/app/ws.py`) the browser holds **one** WebSocket to the
control plane at `/ws/sessions/{id}`. On that socket the control plane
multiplexes two outbound streams and one inbound:

- **viewer deltas** — from watching `/project` (`research_updated`,
  `gedcomx_updated`, `sidecar_updated`, plus `status` and `error`);
- **chat frames** — `agent_event` lines pumped verbatim from the
  `agent_runner`'s stdout (`apps/server/app/chat.py`);
- **inbound** — `user_msg` / `interrupt` from the browser, forwarded to the
  agent's stdin.

This works for the local POC, but it pins a long-lived, high-volume socket to
the always-on control plane for every active session. That is the one thing
standing between us and a **stateless / serverless-friendly** control plane
(Amplify / Lightsail / Lambda-style). It also means the control plane is the
single fanout point — no managed presence, no reconnect/resume, no edge
delivery. Moving fanout to **Ably** removes the relay socket while keeping the
control plane as the (stateless-per-request) orchestrator.

The seam already exists: `config.realtime = "local_ws"` (default) | `"ably"`
(`apps/server/app/config.py`), and the client comment in
`SessionConnection.ts` already names the swap ("swapping to Ably/Pusher would
replace this class, nothing else"). This plan makes that real.

---

## 2. Options

### Option A — server publishes, browser subscribes; chat input via REST (recommended for alpha)

The control plane keeps orchestrating the sandbox (holds the `Process`, runs the
`/project` watch) but **publishes** every outbound frame to a per-session Ably
channel instead of writing it to a relay socket. The browser **subscribes**
directly to that channel via the Ably JS SDK, using a short-lived capability
token minted by the server. Chat **input** flows over REST.

```
Browser (Ably JS SDK)
  │  subscribe ◄──────────────  Ably channel  session:{id}  ◄── publish ── control plane
  │                                                                          ├─ /project watch → viewer deltas
  │  REST  GET  /api/realtime/token   (mint capability token, this channel only)
  │  REST  POST /api/sessions/{id}/message  {type:user_msg|interrupt} ──────► agent_runner stdin
  ▼
FastAPI control plane (still holds the sandbox Process + watch; no relay WS)
        │  start_process / write_stdin / stdout() / watch_project   (UNCHANGED)
        ▼
  agent_runner (stdio JSON lines, UNCHANGED) → /project writes
```

- **Outbound:** control plane → Ably → browser. The watch loop and the
  `agent_runner` stdout pump are unchanged in *what* they produce; they just
  call `realtime.publish(session_id, msg)` instead of `ws.send_text(...)`.
- **Inbound:** browser → `POST /api/sessions/{id}/message` → control plane →
  `Process.write_stdin(...)`. Same payloads (`user_msg`, `interrupt`) as today,
  now an HTTP request instead of a WS frame.
- **Sandbox layer untouched.** The agent still speaks stdio; the control plane
  still pumps it. Ably is bolted onto the *control-plane edge*, nowhere else.

**Why A for alpha:** smallest diff that kills the relay socket. The
`agent_runner` and the whole `SandboxProvider` contract are unchanged — no Ably
SDK in the sandbox, no E2B image rebuild, no token plumbing into the microVM.
The control plane keeps the watch + stdin/stdout pump it already has; it just
fans out through Ably. It is **not yet** fully stateless (the control plane
still holds the live `Process` + watch task per active session), but it removes
the browser-facing socket, which is the part that matters first.

### Option B — agent_runner publishes/subscribes; control plane does lifecycle only (later)

The `agent_runner` itself gets the Ably SDK: it publishes `agent_event` (and,
if we move file-delta detection into the sandbox, the file deltas) to the
session channel and subscribes to the channel for `user_msg` / `interrupt`. The
control plane shrinks to **session lifecycle + token minting + the initial
snapshot**. Session liveness moves to **Ably presence** + an idle timer rather
than "is a WebSocket open."

```
Browser (Ably JS SDK) ◄── pub/sub ──► Ably channel session:{id} ◄── pub/sub ──► agent_runner (Ably Python SDK, in sandbox)
                                                                                  └─ /project writes + (own) deltas
FastAPI control plane: create/resume/suspend + GET /api/realtime/token + initial snapshot only
```

- **This is the path to a genuinely stateless/serverless control plane** — the
  control plane no longer holds a live `Process` pump or a watch task per
  session; the sandbox talks to the browser through Ably directly.
- **Costs more:** the Ably **Python** SDK must run inside the sandbox (image
  rebuild + per-session Ably token injected into the sandbox via the existing
  secrets-file mechanism, `sandbox-provider-interface.md` decision #2); the
  browser **publishes** input (so the capability token needs publish on an
  input sub-channel, tightening the security model); file-delta detection must
  move into the sandbox (today it comes from the control-plane `/project`
  watch — see `sandbox-provider-interface.md` decision #4, which already
  anticipates the agent emitting deltas); and **liveness is re-architected**
  around presence + idle timer instead of socket lifecycle.

**Recommendation: A now, B later.** Ship A for alpha — it removes the relay
socket with a contained, sandbox-agnostic change. Adopt B when we want the
control plane to be truly stateless (serverless deploy), which is also when the
sandbox-provider doc's "agent emits file deltas" decision (#4) and the MCP
per-session token refactor (decision #8 / §8) are being done anyway. The
`Realtime` seam below is designed so A→B is an adapter change plus moving the
`publish` call site from the control plane into `agent_runner`, not a rewrite.

---

## 3. The server seam — `Realtime`

A thin interface, mirroring how `SandboxProvider` is config-selected. New
module `apps/server/app/realtime/` (`base.py`, `local_ws.py`, `ably.py`,
`factory.py`).

```python
# apps/server/app/realtime/base.py
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class RealtimeToken:
    """What the browser needs to subscribe. Shape is adapter-specific but the
    fields below are the union the client cares about; unused ones are None."""
    backend: str                 # "local_ws" | "ably"
    channel: str                 # e.g. "session:prj_abc123"
    token: str | None = None     # Ably token request / signed token (None for local_ws)
    ttl_seconds: int | None = None


class Realtime(ABC):
    """Outbound fanout for one control plane. publish() sends a frame to all
    subscribers of a session; mint_token() returns what a browser needs to
    subscribe to exactly that session and nothing else."""

    @abstractmethod
    async def publish(self, session_id: str, message: dict) -> None: ...

    @abstractmethod
    async def mint_token(self, session_id: str) -> RealtimeToken: ...

    async def aclose(self) -> None:  # symmetry with SandboxProvider.aclose
        return None
```

`message` is the same dict the relay sends today (`{"type": "research_updated",
"data": {...}}`, `{"type": "agent_event", "event": {...}}`, `status`, `error`,
`sidecar_updated`). Nothing about the frame schema changes — only the wire it
travels on. This keeps the viewer-ui transport contract intact (§5).

### `LocalWsRealtime` — keeps localhost working with no Ably account

`local_ws` stays the default so `make server` + `make web` work today with zero
external setup. There is no Ably key, no network call to mint a token. The
adapter holds the per-session set of connected `WebSocket`s and fans out to
them — i.e. it owns the relay that `ws.py` currently inlines.

```python
# apps/server/app/realtime/local_ws.py  (sketch)
class LocalWsRealtime(Realtime):
    def __init__(self) -> None:
        self._subs: dict[str, set[WebSocket]] = defaultdict(set)

    def attach(self, session_id: str, ws: WebSocket) -> None:
        self._subs[session_id].add(ws)

    def detach(self, session_id: str, ws: WebSocket) -> None:
        self._subs[session_id].discard(ws)

    async def publish(self, session_id: str, message: dict) -> None:
        dead = []
        for ws in list(self._subs.get(session_id, ())):
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.detach(session_id, ws)

    async def mint_token(self, session_id: str) -> RealtimeToken:
        # No token needed: the client opens /ws/sessions/{id} as it does today.
        return RealtimeToken(backend="local_ws", channel=f"session:{session_id}")
```

The existing `/ws/sessions/{id}` endpoint stays for `local_ws`: it `attach`es
the socket, runs the watch + agent pump as today, and (the one refactor) routes
its outbound sends through `realtime.publish(...)` instead of `_send(ws, ...)`.
That keeps a single fanout path so the two backends can't drift. The inbound
receive loop (user_msg/interrupt → stdin) stays on the socket for `local_ws`.
(Equivalently, `local_ws` can keep the inline `_send` — but routing through
`publish` is the cleaner seam and is what lets the watch/pump code be backend-
agnostic.)

### `AblyRealtime` — Option A

```python
# apps/server/app/realtime/ably.py  (sketch — verify against ably-python)
from ably import AblyRest

class AblyRealtime(Realtime):
    def __init__(self, api_key: str) -> None:
        self._rest = AblyRest(api_key)        # REST is enough to publish + mint tokens

    def _channel(self, session_id: str) -> str:
        return f"session:{session_id}"

    async def publish(self, session_id: str, message: dict) -> None:
        ch = self._rest.channels.get(self._channel(session_id))
        await ch.publish(message["type"], message)   # name = frame type, data = full frame

    async def mint_token(self, session_id: str) -> RealtimeToken:
        chan = self._channel(session_id)
        token_request = await self._rest.auth.create_token_request({
            "capability": {chan: ["subscribe"]},     # subscribe-only, this channel only
            "ttl": 60 * 60 * 1000,                    # 1h ms; client re-mints on expiry
            "client_id": session_id,                  # ties the token to the session
        })
        return RealtimeToken(
            backend="ably",
            channel=chan,
            token=json.dumps(token_request),
            ttl_seconds=60 * 60,
        )
```

Publishing from the control plane uses the Ably **REST** client (no persistent
connection needed to publish); the **browser** uses the Ably **Realtime** JS
client to subscribe. The server never opens a realtime connection in Option A.

> **Frame name vs. data.** Publish with the frame's `type` as the Ably message
> `name` and the whole frame as `data`. The browser can then either filter by
> name or read `data.type` — both map cleanly onto the existing
> `switch (msg.type)` in `WsResearchTransport.subscribe` and `ChatPane`.

### `factory.py`

```python
def make_realtime() -> Realtime:
    s = get_settings()
    if s.realtime == "ably":
        if not s.ably_api_key:
            raise RuntimeError("REALTIME=ably requires ABLY_API_KEY")
        return AblyRealtime(s.ably_api_key)
    return LocalWsRealtime()
```

Wired in `main.py` lifespan as `app.state.realtime = make_realtime()` next to
`app.state.provider`, and `aclose()`d on shutdown. `/api/health` already
reports `realtime`; leave it.

---

## 4. New REST endpoints (Option A)

Both live in the control plane, both require the session cookie + ownership
check (`get_current_user` + the existing `_owned(...)` helper in
`sessions.py`).

### `GET /api/realtime/token?sessionId={id}`

Mints a capability token scoped to that session's channel only.

- Auth: cookie → `get_current_user`; verify the user owns `sessionId`
  (`_owned`), else 404. **The ownership check is the security boundary** — the
  Ably root key never leaves the server; the browser only ever holds a
  per-session, subscribe-only token.
- Returns the `RealtimeToken` (JSON). For `local_ws` it returns
  `{backend:"local_ws", channel:...}` and the client falls back to the WS path
  (so the same client code drives both backends — see §5).
- TTL ~1h; the client re-fetches on `token` expiry (Ably JS has an `authUrl`
  hook that does this automatically — point it at this endpoint).

### `POST /api/sessions/{id}/message`

Chat input, replacing the inbound half of the relay socket.

- Body: `{"type": "user_msg", "text": "..."}` or `{"type": "interrupt"}` —
  identical to the frames the browser sends today.
- Auth + ownership as above.
- Effect: look up the live `Process` for this session (see §6 on liveness) and
  `await proc.write_stdin(raw + "\n")` — exactly what `ws.py`'s receive loop
  does now. If no live agent process exists for the session (suspended /
  cold), this endpoint is what **triggers connect** (resume sandbox + start
  agent process) before writing stdin (§6).
- Returns `202 Accepted` (or `{ok:true}`). The agent's reply streams back
  **over Ably**, not in this response.

> Use `authUrl` (not a static token) in the Ably JS client config so token
> renewal is transparent and tokens stay short-lived. The endpoint already has
> the cookie, so renewal is a normal authenticated GET.

---

## 5. The client seam — `SessionConnection`

Today `SessionConnection` is the one WebSocket; `WsResearchTransport` and
`ChatPane` both attach listeners via `conn.on(...)` and send via `conn.send(...)`.
**The viewer-ui transport contract is unaffected**: `ResearchTransport`
(`packages/viewer-ui/src/transport.ts`) already abstracts `subscribe(handlers)`
and never reaches for a socket directly. `WsResearchTransport.subscribe` just
forwards `conn.on(...)`. So the swap is below the transport: introduce a
`SessionConnection` interface with two implementations.

```ts
// apps/web/src/transport/SessionConnection.ts  (interface)
export type WsMessage = { type: string; [k: string]: unknown }
export interface SessionConnection {
  connect(): void
  on(listener: (msg: WsMessage) => void): () => void
  send(obj: WsMessage): void           // user_msg / interrupt
  close(): void
}
```

- **`WsSessionConnection`** — today's class, unchanged behavior: one WS for both
  directions. Used when the minted token reports `backend === "local_ws"`.
- **`AblySessionConnection`** — `connect()` fetches `GET /api/realtime/token`,
  constructs an Ably `Realtime` client with `{ authUrl, clientId }`, subscribes
  to `session:{id}`, and routes each inbound Ably message to `on(...)`
  listeners (unwrapping to the same `{type, ...}` shape the relay produced).
  `send(obj)` does **not** publish to Ably — it `POST`s to
  `/api/sessions/{id}/message`. `close()` detaches the Ably channel + closes
  the client.

A small factory picks the implementation. To keep the first paint simple, the
client can read `VITE_REALTIME` (build-time) **or**, better, call
`/api/realtime/token` first and branch on `backend` (single source of truth =
the server's config). Recommend the latter so a deploy flips backends without a
web rebuild.

```ts
// apps/web/src/transport/makeSessionConnection.ts (sketch)
export async function makeSessionConnection(sessionId: string): Promise<SessionConnection> {
  const tok = await fetch(`/api/realtime/token?sessionId=${sessionId}`, {
    credentials: 'include'
  }).then(r => r.json())
  return tok.backend === 'ably'
    ? new AblySessionConnection(sessionId, tok)
    : new WsSessionConnection(sessionId)
}
```

`SessionView.tsx` is the only call-site change: it currently does
`new SessionConnection(sessionId)` synchronously; it becomes an async
`makeSessionConnection(...)` resolved in the existing mount `useEffect`
(it already awaits `api.resumeSession`). `ChatPane` and `WsResearchTransport`
are untouched — they consume the `SessionConnection` interface, which both
implementations satisfy.

**Dep:** `ably` (JS) in `apps/web`. It is tree-shakeable; import only the
realtime client.

---

## 6. Session liveness & lifecycle without the relay socket

The relay socket is currently load-bearing for liveness in three places; each
needs a replacement under Option A.

1. **"Is this session active?" (idle-suspend guard).** Today
   `app.state.active_sessions` is populated on WS accept and discarded on
   disconnect; `_idle_suspend_loop` (`main.py`) never suspends a session in
   that set, and `last_active` is bumped on WS connect. Without the relay
   socket:
   - **Connect** is triggered by the **first** `POST /api/sessions/{id}/message`
     (or by the browser calling a lightweight `POST /api/sessions/{id}/connect`
     on mount, before any message — recommended, so the viewer's live channel is
     hot before the user types). Connect = `provider.resume(sandbox_id)`, start
     the agent `Process` if not running, start the `/project` watch, add to
     `active_sessions`, bump `last_active`.
   - **Keepalive.** Because there's no socket whose closing signals "gone," add
     a cheap heartbeat: the browser, while a session view is open, sends a
     periodic `POST /api/sessions/{id}/ping` (e.g. every 30s) that bumps
     `last_active`. The idle-suspend loop's cutoff (`idle_suspend_seconds`,
     default 1800) then does the right thing: a closed tab stops pinging →
     `last_active` ages out → suspend. This replaces "socket closed → discard
     from active_sessions" with "stopped pinging → ages out." Use **Ably
     presence** here later (Option B) instead of a ping; for A, a ping is the
     minimal change.
   - **Suspend** is unchanged: `_idle_suspend_loop` suspends sessions past the
     cutoff that aren't being kept alive. On suspend, tear down the watch + kill
     the agent `Process` and remove from `active_sessions`.

2. **The watch + agent-pump tasks** that `ws.py` owns inside the WS handler must
   move to a per-session **manager** keyed by `session_id`, owned by the app
   (not by a request). Sketch: `app.state.sessions: dict[str, LiveSession]`
   where `LiveSession` holds `{sandbox, process, watch_stop, pump_task}`.
   `connect` creates/reuses it; `message` looks up `process` and writes stdin;
   `suspend` disposes it. The watch callback and the agent-stdout pump now call
   `realtime.publish(session_id, frame)` instead of `ws.send_text`.

3. **Initial viewer snapshot.** Today `push_full_snapshot` runs on WS connect.
   Under Option A there are two clean choices; **use (a)**:
   - **(a) Snapshot over REST (recommended).** The browser already hydrates via
     `WsResearchTransport.getProjectState()` → `GET /api/sessions/{id}/state`
     (it returns research + gedcomx + sidecar pointers — exactly the snapshot).
     So the snapshot is *already* a REST call; we just lean on it and drop the
     "push snapshot on connect" duplication. Order on the client: (1)
     `getProjectState()` for the initial paint, (2) subscribe to the channel for
     deltas. Any delta published between the two is reconciled because deltas
     are full-document replacements (`research_updated` carries the whole
     `research.json`), so a late snapshot or a late delta both converge — last
     write wins, no patch ordering to get wrong.
   - **(b) Publish snapshot to the channel on connect.** Re-implements
     `push_full_snapshot` as N `publish()` calls. Avoid — it duplicates the REST
     snapshot and reintroduces an ordering question (subscribe must precede the
     publish). (a) is strictly simpler given the existing read API.

> **Net:** Option A keeps the watch + Process per active session on the control
> plane (so it is *not* stateless yet), but the **browser-facing socket is
> gone** and the snapshot is pure REST. Option B is what later moves the watch +
> Process off the control plane entirely (agent publishes; presence drives
> liveness), at which point the control plane can scale to zero between turns.

---

## 7. Security

- **Never expose the Ably root key to the browser.** The root key
  (`ABLY_API_KEY`) lives only in the control plane env. The browser receives a
  **capability token** minted per session, `subscribe`-only, scoped to
  `session:{id}` and nothing else. This is the whole reason for `mint_token`.
- **Authorization is the ownership check.** `GET /api/realtime/token` runs
  `get_current_user` + `_owned(session_id)` (same gate as every other session
  endpoint) before minting. A user can only get a token for a channel of a
  session they own.
- **Channel naming:** `session:{project_id}` (project_id is already an
  unguessable `prj_` + 16 hex, from `sessions.py`). One channel per session.
  Do not put the user id in the channel name; the capability token, not the
  name, is the boundary.
- **Capability scoping:** Option A → `{ "session:{id}": ["subscribe"] }` only.
  The browser cannot publish. (Option B, where the browser publishes input,
  would add `["publish"]` on a dedicated input sub-channel only, e.g.
  `session:{id}:input`, keeping the agent's `agent_event` channel
  subscribe-only for the browser.)
- **Token TTL:** short (≈1h) with `authUrl`-driven renewal, so a leaked token
  expires fast and renewal re-checks ownership via the cookie.
- **`client_id`:** set to the session id on the token so Ably ties the
  connection to the session (useful for presence in Option B and for abuse
  attribution now).
- **Input endpoint auth:** `POST /api/sessions/{id}/message` is cookie-authed +
  ownership-checked like the token endpoint. (Today the inbound user_msg path is
  implicitly authorized by the authed WS; REST makes that explicit and per-
  request.)
- **CORS:** the input/token endpoints are same-origin REST (already covered by
  the existing `CORSMiddleware` `web_origin` config). The Ably connection is
  browser→Ably edge, not browser→our origin, so it is outside our CORS surface.

---

## 8. Dependencies & config

- **Server:** add `ably` (Python) to `apps/server` deps (used by `AblyRealtime`
  for REST publish + token minting). New setting in `config.py`:
  `ably_api_key: str | None = None` (env `ABLY_API_KEY`). Unset is fine — only
  `REALTIME=ably` requires it (enforced in `make_realtime`).
- **Web:** add `ably` (JS) to `apps/web` deps (used by `AblySessionConnection`).
- **No sandbox change** in Option A (no Ably SDK in the sandbox, no E2B image
  rebuild). Option B would add `ably` (Python) to the **sandbox image** and
  inject a per-session Ably token via the secrets file
  (`sandbox-provider-interface.md` decision #2).
- **Defaults stay local-first:** `realtime` default remains `"local_ws"`; with
  no `ABLY_API_KEY`, `make server` / `make web` behave exactly as today. Ably is
  opt-in per deployment via `REALTIME=ably` + `ABLY_API_KEY`.

---

## 9. Phased implementation

Each phase leaves `main` green and `local_ws` behaving identically; Ably is dark
until Phase 4 flips it per-deploy.

**Phase 0 — provision (Dallan, today).** Create the Ably account; create an API
key with **publish + subscribe + (later) presence** capabilities; record it as
`ABLY_API_KEY` in the server env (not committed). No code depends on it yet.

**Phase 1 — server seam, no behavior change.** Add `apps/server/app/realtime/`
(`base.py`, `local_ws.py`, `factory.py`); wire `app.state.realtime =
make_realtime()` in `main.py` lifespan. Refactor `ws.py` so the watch callback
and agent-stdout pump call `realtime.publish(session_id, frame)` (via
`LocalWsRealtime.attach/detach` on connect/disconnect) instead of inline
`_send`. **No client change; behavior identical.** Tests: existing server
suite (incl. the chat proxy round-trip) stays green.

**Phase 2 — extract the per-session manager + REST input/token endpoints.**
Introduce `app.state.sessions: dict[str, LiveSession]` (sandbox + process +
watch + pump), with `connect(session_id)` / `disconnect(session_id)` helpers.
Add `GET /api/realtime/token` and `POST /api/sessions/{id}/message` (+ optional
`POST /connect` and `/ping`). For `local_ws`, the WS endpoint now delegates to
the manager and `attach`es its socket; the receive loop can stay on the WS *or*
also accept the REST input path — keep WS input for `local_ws` to minimize
churn. **Still no client change.**

**Phase 3 — client seam.** Turn `SessionConnection` into an interface with
`WsSessionConnection` (today's class) + `AblySessionConnection`; add
`makeSessionConnection(sessionId)` that branches on the minted token's
`backend`. Update `SessionView.tsx` to construct it async. `ChatPane` +
`WsResearchTransport` unchanged. Add `ably` (JS). With `REALTIME=local_ws` the
client picks `WsSessionConnection` → identical behavior. Add the `ably` (Python)
dep + `AblyRealtime` + `ably_api_key` setting now (still inert under
`local_ws`).

**Phase 4 — flip Ably on (staging deploy).** Set `REALTIME=ably` +
`ABLY_API_KEY` on a staging control plane. Browser now subscribes via Ably and
sends input via REST. Verify the checklist below end-to-end. `local_ws` remains
the local/dev default.

**Phase 5 (later) — Option B.** Move `publish` into `agent_runner` (Ably Python
SDK in the sandbox + per-session token via secrets file), move file-delta
emission into the sandbox (decision #4), switch liveness to Ably presence +
idle timer, and shrink the control plane to lifecycle + token + snapshot. Out
of scope for alpha; the `Realtime` seam + the per-session manager from Phases
1–2 are the foundation.

---

## 10. Verification checklist

Run with `REALTIME=local_ws` first (must be a no-op vs. today), then
`REALTIME=ably`.

- [ ] **local_ws unchanged:** `make server` + `make web` with no `ABLY_API_KEY`
      behaves exactly as today — sample project renders, new session onboarding
      runs, "search for census records" logs source + assertion + sidecar live,
      resume works. (POC-status "What works" table still passes.)
- [ ] **`/api/health`** reports `realtime: "local_ws"` then `"ably"` per config.
- [ ] **Token scoping:** `GET /api/realtime/token` for a session you own returns
      a subscribe-only token for `session:{id}`; for a session you don't own →
      404; with no cookie → 401.
- [ ] **Root key never on the wire:** inspect the browser → it holds only the
      capability token, never `ABLY_API_KEY`. Decode the token request → its
      capability is `{session:{id}: [subscribe]}` only.
- [ ] **Outbound fanout (Ably):** editing `/project` (or the agent writing it)
      pushes `research_updated` / `gedcomx_updated` / `sidecar_updated` to the
      browser via Ably; the viewer updates ~1s, same as the WS path.
- [ ] **Chat over REST + Ably:** `user_msg` via `POST /message` reaches the
      agent; `agent_event` frames stream back over Ably; tool chips render;
      `interrupt` works; sequential turns work.
- [ ] **Initial snapshot:** on session open, the viewer paints from
      `GET /state` (REST) and then receives deltas over Ably — no missing first
      frame, no duplicate, no ordering glitch (full-document replacement
      converges).
- [ ] **Liveness:** an open session pings and is **not** idle-suspended; closing
      the tab stops pings → after `idle_suspend_seconds` the session is
      suspended; reopening resumes (sandbox + agent + channel) cleanly.
- [ ] **Token renewal:** force a short TTL → `authUrl` renews transparently
      mid-session; subscription survives.
- [ ] **Transport contract:** `assertTransportContract` still passes against
      `WsResearchTransport` (it is unchanged); the viewer-ui suite (99 tests) is
      green.
- [ ] **No sandbox change:** `.mcpb` + plugin `.zip` still build; the
      `agent_runner` stdio protocol is untouched (Option A).

---

## 11. What this supersedes (and what it does not)

- **Supersedes** the WS relay **for fanout only** — `ws.py`'s role as the
  browser-facing realtime multiplexer, and `SessionConnection.ts` as the sole
  client transport. Under `REALTIME=ably`, outbound fanout is Ably and chat
  input is REST.
- **Does not change** the engine (`mcp-server/`, `plugin/`), the
  `SandboxProvider` contract, or the `agent_runner` stdio protocol
  (`sandbox-provider-interface.md` stays current). The control plane still
  orchestrates the sandbox.
- **`local_ws` is not removed** — it remains the dev/default backend so
  localhost works with no Ably account. The two backends share one `publish`
  path and one client `SessionConnection` interface, so they can't silently
  drift.
