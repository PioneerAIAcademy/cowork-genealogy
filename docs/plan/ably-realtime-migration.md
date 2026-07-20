# Realtime architecture — the sandbox *is* the per-session server

**Status:** **Re-architected.** This supersedes the earlier Ably direction in
this same doc. The shipped **Ably Option A** (server publishes fanout to Ably,
browser subscribes, chat input via REST) and the planned **Ably Option B** (an
in-sandbox *bridge* holding a persistent Ably connection, plus a presence webhook
and a scheduled idle-suspend reaper) were both machinery to work around one thing:
**control-plane session affinity** on AWS with no sticky routing. E2B's
persistence model makes almost all of that machinery unnecessary.

**New direction:** the **E2B sandbox is the per-session server**; the control
plane is a thin, stateless auth + lifecycle layer; **Ably is removed entirely.**
Long-term, research is uploaded to the user's FamilySearch tree — FamilySearch is
the eventual durable system-of-record (see §6).

**Branch:** `hosted-web-workbench`.
**Filename note:** kept as `ably-realtime-migration.md` for cross-reference
continuity even though the conclusion is to *drop* Ably; rename can happen
separately.
**Read with:** `realtime-rearch-status.md` (current architecture),
`sandbox-provider-interface.md`,
`neon-postgres-plan.md` (its `count > 1` DB work still applies; its affinity-fix
references were updated to point here), `fly-deploy-plan.md` (likewise).
**Reviewers:** Dallan + eng reviewer.

---

## 1. The problem this solves — control-plane session affinity

Today the browser holds one WebSocket to the control plane (`apps/server/app/ws.py`)
at `/ws/sessions/{id}`. On that socket the control plane multiplexes outbound
viewer deltas (from watching `/project`) + chat frames (the `agent_runner` stdout
pump) and inbound `user_msg`/`interrupt`. The per-session state — the agent
`Process`, the `/project` watch, the stdout pump — lives in memory in a
`LiveSession` on **one** control-plane instance (`live_session.py`, created by
`SessionManager.ensure()`).

Production runs on **AWS behind a standard load balancer with no session
stickiness** (AWS IT will not allow sticky routing). With `count > 1` and no
stickiness, `/connect` can land on instance A (agent + watch spawn there) and the
next `/message` on instance B, where `manager.ensure()` spawns a **second** agent
+ watch for the same session — two agents writing the same `/project`. That
double-spawn is the affinity bug, and it is the real `count > 1` blocker that
`neon-postgres-plan.md` names.

The earlier Ably work removed the browser-facing relay *socket* (Option A,
shipped) and then proposed relocating `LiveSession` into the sandbox behind an
Ably bridge (Option B). The bridge was the right instinct — put the single
per-session pump where there is exactly one of it (the sandbox) — but it dragged
in a broker, a persistent in-sandbox realtime connection, token self-refresh, a
presence webhook, and a scheduled reaper. The insight below removes nearly all of
it.

### The insight — E2B already gives us what the broker was for

Verified against the E2B docs:

- `lifecycle:{ onTimeout: 'pause' }` makes a sandbox **pause** on idle (default
  5-min timeout, persistent — it re-pauses after each resume). Pause stops compute
  billing and preserves filesystem **and** memory **and** running processes.
- `Sandbox.connect(sandboxId)` **auto-resumes a paused sandbox in ~1 second** and
  is idempotent on a running one.
- Paused sandboxes are kept **indefinitely** (no TTL); resume is **same host**;
  clients are **disconnected on pause and reconnect on resume** — E2B's own
  prescribed pattern, not a workaround.
- Plan caps continuous session length: **Hobby 1h** (3,600,000 ms), **Pro 24h** —
  a hard ceiling you cannot extend past (see §5).

So the durable, always-available thing the broker was supposed to provide is
provided by E2B + the browser's own connection. We do not need Ably to fan out,
to survive a pause, or to detect liveness.

---

## 2. Target architecture

```
                 ┌──────────── control plane (FastAPI, stateless, affinity-free) ────────────┐
                 │  login · list sessions · create · connect(id)→resume · mint token · {url}  │
                 └──────▲──────────────────────────────────────────────────────────▲─────────┘
   browser ────────────┘ 1. POST /connect → { wssUrl, token }                       │ lifecycle only
      │                                                                       (NO per-session state)
      │  2. open ONE WSS to its OWN sandbox  (chat-in + chat-out + file deltas, all of it)
      ▼
   ┌──────────── E2B sandbox = the per-session server ────────────┐
   │  thin WS server  ==  today's ws.py relay, relocated          │
   │     ├─ verifies the CP-minted token at handshake             │
   │     ├─ spawns agent_runner   (stdio, UNCHANGED)              │
   │     ├─ stdout → out · in → stdin · /project watch → out      │
   │     └─ extends its own E2B timeout while busy/connected      │
   └──────────────────────────────────────────────────────────────┘
```

- **Control plane** is run-state-stateless: it always `provider.connect(sandbox_id)`
  (idempotent auto-resume) before returning a URL. It holds **no** `Process`,
  watch, or per-session connection. Any instance serves any request; killing an
  instance mid-session never touches the browser↔sandbox link, because the control
  plane is not in the data path. That is the affinity fix — affinity removed, not
  routed around.
- **Sandbox = the per-session server.** Today's relay (`ws.py` +
  `live_session.py` + the `local.py:195` `rglob`-mtime `/project` watch) is
  **relocated** to run inside the sandbox as its boot command, exposing one
  authenticated WSS port. Inside the sandbox the relay is *simpler* than on the
  control plane: no `SandboxProvider` indirection, `/project` is local, and a
  single ordered WS carries everything (no cross-process ordering hazard).
- **Browser** reuses the existing `WsSessionConnection` (`apps/web/src/transport/`),
  pointed at `wssUrl` instead of the control plane. No Ably, no
  `AblySessionConnection`, no capability-token fetch. The `viewer-ui`
  `ResearchTransport` (`packages/viewer-ui/src/transport.ts`) is socket-agnostic
  and untouched.

### Why one bidirectional WSS, not a broker

Chat output and file deltas are the same kind of thing — both are *agent → browser*
streams — so they ride one connection, exactly as the relay multiplexes them
today. Input rides the same socket back. A broker would add a hop, a vendor, a
64 KB message cap, per-channel rate limits, and (in the bridge variant) a
persistent in-sandbox connection with token self-refresh — to buy fanout,
presence, and pause-resilience that E2B + the browser connection already provide.
Multiple tabs fan out at the sandbox WS server (as `local_ws` multi-socket does
today); reconnect re-syncs via `GET /state`.

---

## 3. Lifecycle — two separated timers, no reaper

- **idle → pause** (compute billing stops): E2B `lifecycle:{ onTimeout:'pause' }`
  at create. No control-plane sweep, cron, or advisory lock. This replaces the
  `_idle_suspend_loop` (`main.py`) and the scheduled-reaper idea outright — the
  platform does it.
- **abandoned → delete** (storage reclaimed): a low-frequency janitor —
  `SELECT Project WHERE last_active < now − retention_days → provider.delete(sandbox_id)
  → mark deleted`. Keyed on the DB timestamp the schema already has
  (`Project.last_active`, `Project.sandbox_id`); uses a margin so it can **never**
  delete a session a user is in. `retention_days` default 30. It runs daily-ish,
  not per-session, so it is **not** the per-session reaper we removed — and for
  alpha it can be a manual or in-process job.
- The control plane is run-state-stateless: it always `connect(sandbox_id)`
  (idempotent auto-resume) before handing out a URL, so it never needs to track
  running-vs-paused.

---

## 4. The client seam — unchanged shape

`WsSessionConnection`, `makeSessionConnection`, and the socket-agnostic
`ResearchTransport` already exist and stay. The only changes:

- `makeSessionConnection(sessionId)` calls `POST /connect`, gets `{ wssUrl, token }`,
  and constructs `new WsSessionConnection(wssUrl, token)` — the same class, a
  different URL. `AblySessionConnection`, the capability-token fetch, and the 30 s
  `/ping` timer are removed.
- **Reconnect-on-resume:** on socket close (a pause), the client re-`POST /connect`
  (which auto-resumes in ~1 s) and reconnects, showing a brief "resuming…" state.
  This is E2B's prescribed reconnect pattern, not an error path.
- `SessionView.tsx` already constructs the connection async; shape unchanged.
  `ChatPane` and `WsResearchTransport` consume the `SessionConnection` interface
  and are untouched.

---

## 5. The Hobby 1-hour cap (alpha)

Hobby caps continuous session length at 1 hour; you can extend the timeout only
*up to* that ceiling, never past it. So even a continuously-active session is
force-paused at ~1 h, then resumed. With `onTimeout:'pause'`, that ceiling
**pauses** (state preserved) rather than kills, and the next action resumes in
~1 s — a sub-second blip. **Tell alpha users sessions cap at 1 h.**

- *Optional, alpha-skippable:* the sandbox server pauses proactively **between
  turns** near ~55 min so the forced pause never lands mid-turn. Resume restores
  processes but **not** their open sockets, so a mid-turn pause drops the agent's
  Anthropic-API and MCP connections and breaks that turn.
- **Hobby → Pro later = a plan upgrade + a one-line timeout bump (1h → 24h), zero
  rework.** Auto-pause-on-idle and reconnect-on-resume are wanted on Pro too; only
  the cap number changes.

---

## 6. Durability (alpha posture)

Durability splits in two; only one half is deferred.

- *A durable store / backup* — **deferred.** Paused sandboxes keep the filesystem
  indefinitely, and the long-term durable home is **FamilySearch upload** (the
  product goal: push the user's work up to their FamilySearch tree), so building
  interim external storage now would be throwaway. The sandbox FS is the source of
  truth for alpha; an E2B-side loss is an accepted, communicated risk.
- *Not destroying data with our own code* — **kept** (this is correctness, ~free,
  not a feature): (1) `onTimeout:'pause'`, never kill-at-cap, so the 1 h ceiling
  preserves state; (2) the delete-janitor keys on `last_active` with margin so it
  can never delete a live session. The line to hold: E2B occasionally losing data
  is acceptable in alpha; *us* deleting a tester's tree is not — genealogists never
  forgive lost work.

---

## 7. What changes

**Server (control plane)**
- `sessions.py`: `/connect` = `provider.connect(sandbox_id)` + mint a signed
  session token + return `{ wssUrl, token }`. Remove `/message` and `/ping` for the
  hosted path (input + liveness move onto the sandbox WS).
- `main.py`: remove `_idle_suspend_loop` for hosted (E2B `onTimeout` replaces it);
  add the `retention_days` delete-janitor.
- `realtime/`: remove the Ably backends (`ably.py`) + the capability-token endpoint
  **after** the sandbox-WSS path lands and clears the spike; keep `local_ws.py` for
  local dev.
- New: a signed session-token mint + verify helper, shared with the sandbox server.

**Sandbox**
- A thin WSS server (reuse `ws.py` + `live_session.py` + the `local.py:195` watch),
  set as the sandbox boot command (`apps/server/sandbox/e2b.Dockerfile` `CMD`).
  Verifies the token at handshake. **No Ably SDK** — no broker.
- `app/agent/runner.py`: implement `interrupt` (currently ignored at `runner.py:65`)
  — a priority path that cancels the in-flight `ClaudeSDKClient` turn.

**Client (`apps/web`)**
- `makeSessionConnection` points `WsSessionConnection` at `wssUrl`; reconnect-on-
  resume; drop `AblySessionConnection`, the capability-token fetch, and `/ping`.

**Provider**
- `app/sandbox/e2b.py`: implement `create` (with `onTimeout:'pause'`, boot = WSS
  server), `connect` (resume), `delete`, and expose-port / get-URL. Add expose-port
  / get-URL to `app/sandbox/base.py` if missing.
- Local dev unchanged: no E2B, no sandbox WSS server — dev keeps the control-plane
  WS relay (`local_ws` + `ws.py` + `live_session.py`).

**Config**
- `realtime` collapses to `local_ws` (dev) vs `sandbox_ws` (hosted); drop `ably` /
  `ably_mock` and `ably_api_key`. Add `retention_days` (30) and a token signing key.

---

## 8. Gating spike — ~half a day, before building §7

1. Can a running sandbox expose a **stable, TLS-terminated, authenticatable WSS
   port** the browser can hold? (the architecture turns on this)
2. `create` with `onTimeout:'pause'` pauses on idle; `connect(id)` auto-resumes in
   ~1 s; the agent process resumes usable (re-establishes its sockets).
3. The 1 h cap **pauses** (not kills); the browser reconnects cleanly.

If (1) fails or the port is insecure/unstable → fall back to the **Ably-broker**
design (the connectionless variant: sandbox REST-publishes outbound, input via the
control plane). Keep the shipped Ably code as the parachute until the spike clears.

---

## 8.1 Spike results — VALIDATED on real E2B (2026-06-06)

Ran against a live E2B sandbox (token-authed WebSocket echo server on an exposed
port, driven from the host). **All gating questions passed, and the result is
*simpler* than the design assumed.**

| Check | Result |
|---|---|
| Token-authed **WSS over an E2B-exposed port** (`wss://{port}-{id}.e2b.app`, TLS) | ✅ echo round-trip |
| **Streaming** (burst of frames, in order) | ✅ |
| **Token auth** at handshake (the port is public) | ✅ bad token → rejected |
| **Idle hold** ~60 s (client auto-ping) | ✅ still alive |
| **Genuine pause → resume → reconnect** | ✅ (proof below) |

**Pause/resume was verified to be real, not a no-op:** after `await sb.pause()`,
E2B's API reported `state == "paused"` *and* the exposed port became unreachable
(`InvalidStatus`); after `await AsyncSandbox.connect(id)` (resume), `state ==
"running"` and the port served again.

**Headline finding — the listen socket survives pause/resume.** Post-resume,
`:8080` was still listening and the browser reconnected to the **same URL with
zero server-side intervention**. So the **"reclaim/restart the WS server on
`/connect`" mechanism is NOT needed.** This simplifies the design further than
§2–§4:

- **`/connect` = `connect(id)` (resume) + `expose_port` + mint token.** No
  re-launch, no reclaim, no resume-detection. The WS server is the sandbox **boot
  command**, started once at `create`, and survives every pause/resume.
- **"Seamless recovery" is ~free** — only the browser's client socket drops on
  pause; the server stays up, so reconnect-on-close lands on a live server right
  after the ~1 s resume.
- **The in-sandbox server is the *pump*, not `SessionManager`.** One session per
  sandbox ⇒ drop the multiplexing/`_locks`/`ensure`/`dispose`/`active_sessions`
  and the `_idle_suspend_loop`; keep only the watch + agent stdout→ws + ws→stdin +
  multi-socket fan-out (for tabs).
- **The CP never pumps process stdio** — the browser streams directly to the
  sandbox WS server. So `E2BProcess.stdout()/write_stdin()` (the deferred §3.3
  line-reassembly) is **obsolete, delete the concept**; the CP only needs the WS
  server as a boot CMD + `expose_port`.
- **Per-sandbox token secret**, not a shared CP key: generate a random secret at
  `create`, inject it like `ANTHROPIC_API_KEY`; the CP mints `HMAC(secret,
  session_id+exp)`, the sandbox verifies with its own secret. A compromised
  sandbox can forge a token only for itself. **Never** inject the CP's
  `session_secret` (it signs login cookies).

**Alpha scope cuts agreed:** defer the delete-janitor (the explicit `DELETE`
endpoint covers cleanup; paused sandboxes are cheap for a few testers); defer
`interrupt`; skip active per-activity `set_timeout` extension in favor of one
generous idle timeout (~30 min, under the 1 h Hobby cap).

**Not spiked (rely on E2B docs / smoke later):** the real relay+`agent_runner`
streaming (the echo server stood in for it); a multi-minute *no-ping* idle; the
1 h continuous cap; the real `genealogy-agent` image (ran on `base`).

**Conclusion: the Ably parachute can be dropped** once the sandbox-WS path lands.

---

## 9. What already exists / reuse

- `WsSessionConnection`, `makeSessionConnection` (`apps/web/src/transport`) — reused,
  just a different URL.
- `ws.py` relay + `live_session.py` + `local.py:195` watch — **relocated** into the
  sandbox, not rewritten.
- `Project.sandbox_id` + `last_active` (`apps/server/app/models.py:45,52`) — the
  janitor's keys; no new persistence.
- `local_ws` realtime + `/ws/sessions/{id}` — kept for local dev.
- `viewer-ui` `ResearchTransport` — socket-agnostic, untouched.
- E2B provider scaffold (`app/sandbox/e2b.py`).

---

## 10. NOT in scope (deferred)

- **FamilySearch upload/export** — the long-term durable home for research (the
  product's actual goal). Deferred; alpha tells users research is kept ~N days then
  deleted.
- Durable external project store (DB / object storage) — not needed: the durable
  system-of-record is FamilySearch (above), with the sandbox FS as the working
  draft. Sandbox FS is source of truth for alpha; N-day retention.
- Pro upgrade / 24 h cap (post-alpha; one config bump).
- Proactive between-turn pause near the 1 h cap (optional; alpha may accept rare
  mid-turn breaks).
- Ably (removed, not retained — unless the spike forces the fallback).
- Presence, multi-region, deletion-warning emails.

---

## 11. Failure modes

- **1 h cap mid-turn** → agent sockets drop, turn breaks. Mitigation: between-turn
  proactive pause (deferred); alpha-accept. UX: "session paused, reconnecting."
- **E2B loses a sandbox** → research lost (sandbox FS is the only copy).
  Alpha-accepted; retention policy communicated. Durable store = FamilySearch
  export (future).
- **Janitor races a live session** → guard with `last_active` margin; never delete
  a session not idle past `retention_days`.
- **Unauthenticated WSS port** → token verified at handshake; reject otherwise;
  port scoped to the one session.
- **`count > 1` resume race** → `connect(id)` is idempotent (one sandbox, one
  boot) — fine.

---

## 12. Verification

- **Local dev (`local_ws`) unchanged:** `make server` + `make web` with no E2B/Ably
  — sample project renders, onboarding runs, "search census records" logs source +
  assertion + sidecar live, resume works. (POC-status "What works" table passes.)
- **Spike** documented (the three questions in §8).
- **No affinity:** ≥2 control-plane instances behind round-robin (no stickiness) —
  `/connect` on A, next action on B → **exactly one** sandbox + one agent; kill A
  mid-session → B serves seamlessly.
- **1 h cap:** a session crossing 60 min pauses cleanly; browser reconnects in ~1 s;
  no data loss.
- **Janitor:** a session idle > `retention_days` is deleted (sandbox gone, DB
  marked); a live/recent session is never deleted.
- **`interrupt`** cancels an in-flight turn.
- **Engine untouched:** `agent_runner` stdio protocol unchanged; mock agent +
  `tests/` green; `.mcpb` + plugin `.zip` still build.

---

## 13. Phasing

Each phase leaves `main` green and `local_ws` identical.

0. **Spike** (gates everything) — §8.
1. **Sandbox WSS server** — relocate the relay into the sandbox image as the boot
   command; token verify at handshake; `agent_runner` unchanged. Test locally
   against a sandbox.
2. **Provider** — `e2b.py` `create`/`connect`/`delete` + expose-port/URL, with
   `onTimeout:'pause'`.
3. **Control plane** — `/connect` returns `{ wssUrl, token }`; remove the hosted
   `LiveSession` / `_idle_suspend_loop`; add the delete-janitor + token mint.
4. **Client** — point `WsSessionConnection` at `wssUrl`; reconnect-on-resume; drop
   Ably + `/ping`.
5. **interrupt** — `runner.py` priority cancel path.
6. **Verify no-affinity** (≥2 instances, round-robin, kill-mid-session) + the 1 h
   cap + janitor; then **remove the Ably code**.

---

## 14. What this supersedes

- **Supersedes Ably Option A and Option B** in this doc's earlier revision. Outbound
  fanout, chat input, and viewer deltas all travel one authenticated WSS between the
  browser and its sandbox; the control plane is out of the data path. Ably is removed.
- **Supersedes the sticky-routing stopgap** in `neon-postgres-plan.md`. Affinity is
  removed (the sandbox is the per-session server), which is what AWS-no-sticky
  requires; sticky routing is not used.
- **Does not change** the engine (`packages/engine/mcp-server/`, `packages/engine/plugin/`) or the `agent_runner`
  **stdio protocol** — the agent still speaks stdio to the relay; only the relay's
  *home* (control plane → sandbox) and the transport (relay socket → direct WSS)
  change.
- **`local_ws` is not removed** — it stays the dev/default backend so localhost
  works with no E2B and no Ably, reusing the same `WsSessionConnection` interface.
