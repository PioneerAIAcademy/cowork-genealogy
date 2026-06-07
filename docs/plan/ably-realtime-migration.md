# Ably realtime migration — moving fanout off the server WS relay

**Status:** **Option A is shipped** (Phases 1–3 below are implemented: the
`Realtime` seam in `apps/server/app/realtime/`, `SessionManager`+`LiveSession`
in `live_session.py`, the REST `/connect`·`/message`·`/ping`·`/token`
endpoints, and the client `SessionConnection`+`AblySessionConnection`+
`makeSessionConnection`). **Option B is now the active design** — it is the
**affinity fix** required to run the control plane on AWS behind a standard load
balancer with **no sticky routing** (see §2). **Branch context:**
`hosted-web-workbench`.
**Read with:** `hosted-web-workbench-POC-status.md` (current architecture),
`sandbox-provider-interface.md` (the layer below; **unchanged by Option A**,
extended by Option B's in-sandbox bridge), `neon-postgres-plan.md` (its
"sticky-routing stopgap" is **superseded** by Option B here),
`fly-deploy-plan.md` (alpha runs single-Machine; production is AWS-no-sticky).
**Reviewers:** Dallan + eng reviewer.

This plan covers **realtime fanout** — how outbound view/chat frames get from
the agent to the browser, and how chat input gets back.

- **Option A (shipped)** does **not** touch the engine (`mcp-server/`,
  `plugin/`) or the sandbox layer (`SandboxProvider` / `agent_runner` stdio).
  The control plane still owns the sandbox: it holds the `Process`, runs the
  `/project` watch, and mints tokens. The high-volume browser↔control-plane
  WebSocket is replaced by Ably fanout + REST input.
- **Option B (this design)** keeps `agent_runner`'s stdio protocol **unchanged**
  but moves the `Process` + `/project` watch + fanout off the control plane and
  into a thin **bridge process inside the sandbox**, so **no control-plane
  instance owns any per-session state**. That is what makes the control plane
  affinity-free behind a plain load balancer.

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
the always-on control plane for every active session. **Option A (shipped)**
already removed that socket: outbound frames are published to Ably and the
browser subscribes directly; chat input is REST. The seam exists and is live —
`config.realtime = "local_ws"` (default) | `"ably"` | `"ably_mock"`
(`apps/server/app/config.py`), with `LocalWsRealtime`/`AblyRealtime`
implementations and a client `SessionConnection` interface that branches on the
minted token's `backend`.

**But Option A did not make the control plane affinity-free, and that is now the
problem to solve.** Production runs on **AWS behind a standard load balancer
with no session stickiness** (AWS IT will not allow sticky routing). Outbound
fanout is already multi-instance-safe — any instance that holds the agent
`Process` can `realtime.publish(...)` and Ably fans out regardless of which
instance published. What is *not* safe is that the per-session `LiveSession`
(the `Process` handle, the `/project` watch, and the stdout pump) lives **in
memory on one instance** (`live_session.py:82`, created by `manager.ensure()`).
On `count > 1` with no stickiness, `/connect` can land on instance A (agent +
watch spawn there) and the next `/message` on instance B, where
`manager.ensure()` spawns a **second** agent + watch for the same session — two
agents writing the same `/project`, double-publishing to one channel. That is a
correctness bug, and it is exactly the bug `neon-postgres-plan.md` names and
proposes to paper over with sticky routing.

**Option B (this design) eliminates the affinity instead of routing around it**
— see §2. The end state is a control plane that is stateless per request (any
instance serves any request behind a plain load balancer) plus one scheduled
reaper, with no per-session state held anywhere on the control plane.

---

## 2. Options

### Option A — server publishes, browser subscribes; chat input via REST (✅ SHIPPED)

> **Status: shipped.** Phases 1–3 are implemented. This is the current behavior
> under `REALTIME=ably`. It removed the browser-facing relay socket but left the
> per-session `LiveSession` pinned to one control-plane instance (the affinity
> bug §1 describes). Option A is correct at `count = 1`; Option B is what makes
> it correct at `count > 1` with no sticky routing.

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

### Option B — a bridge process in the sandbox owns fanout; the control plane owns nothing per-session (the affinity fix)

The root cause of the affinity bug (§1) is that the agent `Process`, the
`/project` watch, and the stdout pump live in **per-instance in-memory
`LiveSession`**, *spawned by a control-plane instance* via
`start_agent_process()`. Two instances ⇒ two agents. Sticky routing only forces
every request for a session onto the one instance holding its `LiveSession` —
the exact affinity AWS IT forbids.

Option B removes the affinity instead of routing around it: **make no
control-plane instance own anything.** A thin **bridge process runs inside the
sandbox as the sandbox's boot command** and owns all Ably I/O plus the
`/project` watch. It spawns `agent_runner` as its child over an ordinary stdio
pipe. **`agent_runner`'s stdio JSON-line protocol is unchanged** — the mock
agent, the test suite, and `local_ws` local dev are byte-identical.

```
Browser (Ably JS SDK)
  │  subscribe ◄──────────────  Ably  session:{id}        ◄── publish ── bridge (in sandbox)
  │  REST POST /api/sessions/{id}/message ─► control plane ── publish ─► session:{id}:input ─► bridge subscribe
  ▼                                          (validates, then publishes)                         │ stdin
FastAPI control plane: create/resume/suspend + GET token + GET snapshot + presence webhook       ▼
        (stateless per request — holds NO Process, NO watch, NO LiveSession)        agent_runner (stdio, UNCHANGED)
                                                                                     └─ /project writes
```

**The bridge is `LiveSession` relocated into the sandbox.** It does exactly what
`live_session.py:104–130` does today, one sandbox at a time:

| `LiveSession` today (per control-plane instance) | Bridge (in sandbox, started once at boot) |
|---|---|
| `start_agent_process()` holds a `Process` | spawns `python -m app.agent.runner` as its child; owns the pipe |
| `pump_agent()`: stdout line → `realtime.publish` | reads agent stdout → Ably `publish("agent_event", …)` on `session:{id}` |
| `send_input()`: write to `Process.stdin` | subscribes `session:{id}:input` → writes agent stdin |
| `pump_changes()`: `sandbox.watch_project()` | polls `/project` (the `rglob`-mtime loop from `local.py:195`) → publishes `research_updated`/`gedcomx_updated`/`sidecar_updated` |

- **The invariant that kills the double-spawn bug:** exactly one bridge per
  sandbox, because there is one sandbox and the bridge is its boot command.
  `provider.resume(sandbox_id)` is idempotent — resuming a running sandbox does
  not start a second bridge — so no control-plane instance ever spawns an agent.
  `start_agent_process()` and the control-plane `LiveSession` are **removed for
  the `ably` backend** (kept for `local_ws`).
- **Input stays over REST; the control plane publishes it (the browser does
  not).** `POST /api/sessions/{id}/message` (already built) stops writing to a
  local `Process` and instead **validates** (`MessageBody`) and calls
  `realtime.publish_input(id, msg)` → publishes to `session:{id}:input`, which
  the bridge subscribes to. This is still affinity-free (any instance can
  REST-publish to Ably), it **keeps the server-side validation/audit/rate-limit
  chokepoint**, and it keeps the **browser token `subscribe`-only** — only the
  bridge (a server-minted token) gets `publish`. The browser never publishes.
- **File-delta detection does NOT move into `agent_runner`.** The bridge polls
  `/project` with the existing loop, so the dependency on
  `sandbox-provider-interface.md` decision #4 ("agent emits deltas") is dropped.
  *(Optional later optimization: `agent_runner` emits a
  `{"type":"file_dirty","paths":[…]}` stdout hint after it writes — additive,
  still stdio-pure, still mockable — so the bridge publishes without the 700 ms
  poll latency.)*
- **Costs:** the Ably **Python** SDK runs inside the sandbox (one line in the
  sandbox image; a one-time bootstrap bearer + initial Ably token delivered via
  the secrets file at create, after which the bridge **self-refreshes** its own
  token — *not* re-injected on each resume, since E2B sandboxes are persistent;
  see §8); liveness moves to **Ably presence + a scheduled reaper** (§6); and the
  MCP per-session token refactor (decision #8 / §8) lands in the same change
  since the bridge owns the per-session creds.

**Recommendation: do Option B now.** It is not a "later, when we want
serverless" nicety — it is the **required** fix to run on AWS with no sticky
routing, which `neon-postgres-plan.md` correctly identifies as the real
`count > 1` blocker. The shipped `Realtime` seam means the control-plane side is
small: remove the `ably` `LiveSession`, add `publish_input`, add a presence
webhook, move the reaper to a scheduled job. The new component is the bridge —
contained, testable against `ably_mock`, and the only place the persistent
in-sandbox Ably connection lives.

---

## 3. The server seam — `Realtime`

A thin interface, mirroring how `SandboxProvider` is config-selected. **Shipped**
module `apps/server/app/realtime/` (`base.py`, `local_ws.py`, `ably.py`,
`ably_mock.py`, `factory.py`). Option B adds one method — `publish_input` — for
the validated-REST→input-channel path (§2); everything else below already
exists.

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

    # Option B: outbound fanout (publish) leaves the control plane and moves to
    # the in-sandbox bridge. The control plane keeps only the inbound seam —
    # validated chat input forwarded to the bridge's input sub-channel.
    async def publish_input(self, session_id: str, message: dict) -> None:
        # default: publish to f"session:{session_id}:input"
        return await self.publish(f"{session_id}:input", message)

    async def aclose(self) -> None:  # symmetry with SandboxProvider.aclose
        return None
```

> Under Option B, `publish()` from the control plane is no longer used for
> per-session fanout (the bridge publishes instead); the control plane calls
> only `publish_input()` and `mint_token()`. `local_ws` keeps using `publish()`
> as today.

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

## 4. REST endpoints

All live in the control plane and require the session cookie + ownership check
(`get_current_user` + the existing `_owned(...)` helper in `sessions.py`).
`GET /api/realtime/token`, `POST /api/sessions/{id}/message`, `/connect`, and
`/ping` are **shipped (Option A)**. Option B changes what `/message` *does*
(publish to the bridge's input channel instead of writing a local `Process`),
adds a **presence webhook**, and **removes `/ping`** (presence replaces it) —
see the per-endpoint notes below and §6.

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
- **Option A (shipped) effect:** look up the live `LiveSession` for this session
  (`manager.ensure(...)`) and `await live.send_input(raw)` — writes the agent
  `Process` stdin on the instance that holds it. (This is the affinity-bound
  path: only the owning instance can write that stdin.)
- **Option B effect:** **validate** the body (`MessageBody`), then
  `await realtime.publish_input(session_id, {"type", "text"})` → publishes to
  `session:{id}:input`; the in-sandbox **bridge** subscribes and writes agent
  stdin. **No `Process` lookup, no `LiveSession`** — any instance can serve it,
  because any instance can REST-publish to Ably. If the sandbox is cold, the
  same request first does `provider.resume(sandbox_id)` (idempotent; boots the
  bridge) before publishing. Validation here is the input chokepoint the browser
  would lose if it published to Ably directly — so the browser does **not**
  publish; it always POSTs here.
- Returns `202 Accepted`. The agent's reply streams back **over Ably**, not in
  this response.

### `POST /api/realtime/presence` — Ably presence webhook (Option B, new)

Replaces the `/ping` heartbeat. Ably fires a presence webhook on enter/leave for
`session:{id}`; this endpoint bumps `Project.last_active` on enter and stamps a
"left at" on leave, so the scheduled reaper (§6) suspends only sessions with no
present browser. Authenticated as an Ably webhook (shared secret / signature),
not the user cookie. With this in place, `POST /api/sessions/{id}/ping` and the
client's 30 s ping timer are removed.

> Use `authUrl` (not a static token) in the Ably JS client config so token
> renewal is transparent and tokens stay short-lived. The endpoint already has
> the cookie, so renewal is a normal authenticated GET. (The **bridge's** token
> refresh is different — it has no cookie; see §8.)

---

## 5. The client seam — `SessionConnection`

> **Status: shipped, and Option B barely touches it.** The
> `SessionConnection` interface, `WsSessionConnection`, `AblySessionConnection`,
> and `makeSessionConnection` all exist. `AblySessionConnection` already
> subscribes to `session:{id}` and sends input via `POST /message` (it does
> **not** publish to Ably). Under Option B the only client changes are: **enter
> Ably presence** on `connect()` (so the server's presence webhook drives
> liveness), and **remove the 30 s `/ping` timer** (presence replaces it). The
> browser token stays subscribe-only; nothing about input changes.

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

The relay socket was load-bearing for liveness in three places. **Option A
(shipped)** replaced it with the per-session `LiveSession` manager + a browser
`/ping` heartbeat (points 1–3 below — accurate as-built). **Option B replaces
points 1 and 2 with presence + a scheduled reaper + the in-sandbox bridge**, so
the control plane holds no per-session state; point 3 (snapshot over REST) is
unchanged, with one correctness fix that applies to both options. The Option B
end-state is summarized after the three points.

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
     deltas.

     > **Ordering fix (applies to A *and* B — current text is wrong).** Deltas
     > are full-document replacements, but "last write wins" does **not** make a
     > late snapshot and a late delta converge: a slow `GET /state` can return
     > `v1` *after* a `v2` delta has already been applied, clobbering newer
     > state with older. Under Option B it is worse — the publisher (bridge) and
     > the snapshot source (control plane reading sandbox FS) are different
     > processes with no shared clock. **Fix: stamp every delta and the snapshot
     > with the file `mtime`** (`sidecar_updated` already carries `mtime`; add it
     > to `research_updated` and `gedcomx_updated`, and include it in the
     > `GET /state` payload), and have the client **drop any frame or snapshot
     > whose `mtime` is ≤ the highest already applied** for that document. Cheap,
     > and it removes the only data-correctness hazard in the migration.
   - **(b) Publish snapshot to the channel on connect.** Re-implements
     `push_full_snapshot` as N `publish()` calls. Avoid — it duplicates the REST
     snapshot and reintroduces an ordering question (subscribe must precede the
     publish). (a) is strictly simpler given the existing read API.

### Option B end-state — liveness without any per-instance session state

Option B moves points 1 and 2 off the control plane entirely:

- **Watch + agent pump → the bridge.** The `/project` poll and the agent-stdout
  pump run in the sandbox bridge (§2), publishing to Ably directly. No
  control-plane instance holds a `Process`, a watch task, or a `LiveSession` for
  the `ably` backend.
- **"Is this session active?" → Ably presence.** The browser enters presence on
  `session:{id}`; Ably's presence webhook (§4) hits the control plane, which
  bumps `Project.last_active` on enter and stamps "left" on leave. This replaces
  the `/ping` heartbeat. (Bridge presence can also be tracked for observability.)
- **Suspend → a scheduled reaper, not an in-process loop.** The current
  `_idle_suspend_loop` (`main.py:28`) runs in-process and assumes a single
  instance — it races on `count > 1` (two instances both sweeping/suspending).
  Move the sweep to a **single scheduled job** (AWS EventBridge Scheduler →
  Lambda, or an ECS scheduled task; Fly: a scheduled Machine) that runs the same
  query — `select Project where last_active < cutoff and presence empty` →
  `provider.suspend(sandbox_id)`. It is a singleton cron keyed on DB state, with
  no per-session pinning, so it needs no stickiness and is exactly the kind of
  job AWS IT is fine with.

> **Net:** under Option B the control plane is **stateless per request** — any
> instance behind a plain (no-stickiness) load balancer serves `/connect`,
> `/message`, `/state`, `/token`, lifecycle, and the presence webhook, because
> none of them hold per-session memory. The **only** always-on component is the
> scheduled reaper. This is *stateless per request + one reaper* — not literally
> "scale to zero" (the reaper must run somewhere), and the sandboxes themselves
> are still billed while live. But it removes session affinity completely, which
> is the property AWS (no sticky routing) actually requires.

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
- **Capability scoping — the browser stays subscribe-only in *both* options.**
  Browser token → `{ "session:{id}": ["subscribe"] }` only; the browser can
  **never** publish to Ably. Chat input always goes over `POST /message`, which
  the control plane validates and then publishes server-side. This deliberately
  rejects the earlier "browser publishes input directly" idea — it would have
  forced a `publish` capability into the browser and bypassed server validation
  for no real gain (input is low-volume; the extra hop is negligible). The
  **bridge** holds a separate, server-minted token scoped to
  `{ "session:{id}": ["publish"], "session:{id}:input": ["subscribe"] }` — it
  publishes fanout and reads input, and that token never leaves the sandbox.
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

- **Server (shipped):** `ably` (Python) in `apps/server` deps (`AblyRealtime`
  REST publish + token minting). Setting `ably_api_key: str | None = None` (env
  `ABLY_API_KEY`); only `REALTIME=ably` requires it (enforced in
  `make_realtime`).
- **Web (shipped):** `ably` (JS) in `apps/web` deps (`AblySessionConnection`).
- **Sandbox (Option B, new):** add `ably` (Python) to the **sandbox image** —
  one line in `apps/server/sandbox/e2b.Dockerfile`
  (`pip install --break-system-packages ably`) — and ship the bridge module +
  set it as the sandbox's boot command. The bridge holds a persistent Ably
  **realtime** connection (not just REST) to subscribe to `session:{id}:input`
  and enter presence.
- **Bridge token — self-refresh, not re-injection.** E2B sandboxes are
  **persistent** (paused indefinitely, resumed by id any time; a session can run
  continuously up to 24 h before auto-pause). An Ably token has a TTL far shorter
  than that, so the bridge's connection **will** outlive its token. Do **not**
  solve this by rewriting the token into the secrets file on every resume — that
  is the "token re-injection on every connect" pattern this project explicitly
  rejects for persistent sandboxes (the FS token lives in the sandbox and the MCP
  self-refreshes; mirror that). Instead: the secrets file delivers a **one-time
  bootstrap** at create — a per-session **bearer** (and the initial Ably token).
  The bridge **self-refreshes its own Ably token** via an `authCallback` to a
  control-plane token endpoint, presenting that bearer (not a cookie). The
  endpoint is stateless — any instance mints with `ABLY_API_KEY` after checking
  the bearer — so it stays affinity-free and survives the 24 h continuous-run
  window and any pause/resume. The Ably root key never enters the sandbox.
- **MCP per-session token (decision #8).** The bridge owns the per-session creds
  in the secrets file, so the FamilySearch-token-via-env refactor for the MCP
  server lands in the same change (`agent_runner` injects it via
  `mcp_servers[...].env`).
- **Message volume / cost (Option B, and A).** Every `agent_event` becomes a
  billed Ably message published from the sandbox — streaming token + tool deltas
  can be thousands per turn, against Ably's ~64 KB message cap and per-channel
  rate limits. The bridge should **coalesce streamed text deltas** (flush every
  ~50–100 ms or on a tool boundary) before publishing. Note the billing model
  when sizing.
- **Defaults stay local-first:** `realtime` default remains `"local_ws"`; with
  no `ABLY_API_KEY`, `make server` / `make web` behave exactly as today. Ably is
  opt-in per deployment via `REALTIME=ably` + `ABLY_API_KEY`; `ably_mock`
  exercises the bridge in CI with no account.

---

## 9. Phased implementation

Each phase leaves `main` green and `local_ws` behaving identically; Ably is dark
until Phase 4 flips it per-deploy. **Phases 0–4 are shipped (Option A).** The
remaining work is the spike (4.5) and Option B (5), which is the affinity fix —
now on the critical path for AWS, not "later."

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

**Phase 4.5 — E2B spike (gates Phase 5).** We already know (verified against E2B
docs) sandboxes are **persistent**: paused indefinitely, resumed by id any time,
filesystem preserved, never reaped (24 h continuous-run cap, pause resets it;
create must set auto-pause-on-timeout). The remaining unknowns the spike must
answer: **(a) does a *running process* resume executing after pause/resume (vs.
needing a restart), and (b) does the Ably *realtime* connection cleanly
reconnect after the network gap a pause introduces?** Spike: start a sandbox
running a background process + an Ably realtime subscriber, `pause`, then
`resume`, and observe.
- If the process keeps running and the Ably SDK reconnects: the bridge just
  self-refreshes its token (§8) on reconnect. Done.
- If the process must be restarted on resume: the sandbox init starts the bridge
  **idempotently** (lockfile / supervisor that exits if one is already running)
  so two concurrent `provider.resume()` calls can't double-start it.
~half a day with the E2B SDK + an Ably trial key. (This replaces the earlier
"can we reattach to a control-plane-spawned process cross-instance?" question —
under the bridge there is no control-plane-spawned process to reattach to.)

**Phase 5 — Option B: move `LiveSession` into the sandbox bridge.** The affinity
fix. Decomposed so each step leaves `main` green and `local_ws` identical:

- **5a — build the bridge against `ably_mock`.** New bridge module in the
  sandbox image that spawns `python -m app.agent.runner`, pumps its stdout →
  publish, subscribes `session:{id}:input` → agent stdin, and polls `/project`
  (reuse the `local.py:195` `rglob`-mtime loop) → publishes deltas (with the
  `mtime` stamp from §6). Add `publish_input` to the `Realtime` seam. `agent_runner`
  is **unchanged**; the mock agent and `tests/` are untouched. Control plane
  still owns liveness in this step.
- **5b — liveness off the control plane.** Add the Ably presence webhook
  (`POST /api/realtime/presence`), move the idle-suspend sweep to a scheduled
  job, drop `/ping` + the client ping timer, and **remove the `ably`-backend
  `LiveSession` / `start_agent_process`** from the control plane (it no longer
  spawns or pumps anything for `ably`). `/message` switches to `publish_input`.
- **5c — flip `ably` to bridge-mode + verify no-affinity.** Set the bridge as
  the sandbox boot command in the image; land the bridge token **self-refresh**
  (§8 — bootstrap bearer via secrets at create, then `authCallback`; no
  re-injection on resume) and the MCP per-session token (decision #8). Then
  **verify multi-instance with no stickiness:** run ≥2 control-plane instances
  behind round-robin; `/connect` on one and `/message` on another must yield
  **exactly one** agent + one channel; **kill the instance that served
  `/connect`** mid-session → another instance serves the next request seamlessly.

Prerequisite carried by 5a/5c: **`interrupt` must actually work** — `runner.py`
currently ignores it; the bridge delivers it out-of-band (priority read path,
not behind a queued `user_msg`) and the agent cancels the in-flight
`ClaudeSDKClient` turn.

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

### Option B additions

- [ ] **No affinity / no stickiness:** with ≥2 control-plane instances behind a
      round-robin (non-sticky) load balancer, `/connect` on instance A and the
      next `/message` on instance B yield **exactly one** agent and one channel
      (no double-spawn); killing the instance that served `/connect` mid-session,
      the next request is served by another instance seamlessly.
- [ ] **`agent_runner` truly unchanged:** the bridge runs against `ably_mock` in
      CI; the mock agent and the full `tests/` suite pass with no edits to
      `runner.py`/`mock_agent.py`.
- [ ] **Presence-driven suspend:** an open session holds presence and is **not**
      suspended; closing the tab fires a presence-leave webhook → after
      `idle_suspend_seconds` the **scheduled reaper** suspends it; reopening
      resumes (sandbox + bridge + channel) cleanly. No `/ping` involved.
- [ ] **Bridge token survives a long session:** a session running past the Ably
      token TTL (and across a pause/resume) stays connected — the bridge
      self-refreshes via its `authCallback`; no token re-injection on resume.
- [ ] **Ordering under races:** a delta and a slower `GET /state` arriving
      out of order converge correctly — the client drops the one with the older
      `mtime`; no stale clobber.
- [ ] **Input chokepoint intact:** the browser token is `subscribe`-only (it
      cannot publish to Ably); malformed/oversized input is rejected at
      `POST /message` validation before it reaches the bridge.

---

## 11. What this supersedes (and what it does not)

- **Supersedes** the WS relay **for fanout** — `ws.py`'s role as the
  browser-facing realtime multiplexer, and `SessionConnection.ts` as the sole
  client transport. Under `REALTIME=ably`, outbound fanout is Ably and chat
  input is REST.
- **Supersedes the sticky-routing stopgap** proposed in `neon-postgres-plan.md`
  for the `count > 1` `LiveSession` pin. Option B removes the affinity instead
  of routing around it; production (AWS, no sticky routing) requires that.
- **Does not change** the engine (`mcp-server/`, `plugin/`) or the
  `agent_runner` **stdio protocol** — under Option B the agent still speaks
  stdio to the bridge; only the bridge (a new in-sandbox process) and the
  control-plane edge change. Option A leaves the `SandboxProvider` contract and
  the control plane's sandbox orchestration intact; **Option B** keeps the
  `SandboxProvider` contract but moves the `Process` + watch + fanout into the
  sandbox bridge, so the control plane does **lifecycle + token + snapshot +
  presence only** and holds no per-session state.
- **`local_ws` is not removed** — it remains the dev/default backend so
  localhost works with no Ably account. `local_ws` keeps the `LiveSession` +
  one `publish` path and the same client `SessionConnection` interface, so the
  backends can't silently drift.
