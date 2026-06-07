# Realtime re-architecture — build status & morning run guide

**Branch:** `hosted-web-workbench`. **What this is:** the "sandbox IS the
per-session server" build (docs/plan/ably-realtime-migration.md). The browser
opens ONE authenticated WSS directly to the E2B sandbox; the control plane is out
of the streaming path (affinity-free).

## Checkpoint status
- **C1 ✅ in-sandbox WS server** (`apps/server/app/sandbox_server.py`) — HMAC token
  auth at handshake, spawns `agent_runner`, pumps stdout↔ws + ws→stdin, `/project`
  poll-watch → viewer deltas, snapshot on connect, multi-socket fan-out. Tested
  with the real `agent_runner` (mock agent). Commit `7f0840c`.
- **C2 🔧 E2B image** (`genealogy-agent`, id `29srhf18wfleun0yezuk`) — built via the
  CLI + Docker path (`bash apps/server/sandbox/build-image.sh` with `E2B_API_KEY`
  + `E2B_ACCESS_TOKEN`). Dockerfile: `apps/server/sandbox/e2b.Dockerfile` (added
  `websockets`; single-line `ENV`s — the v2 SDK remote build mangled multi-line
  ones). The api-key SDK remote build was flaky (ENV spacing → COPY dest → apt
  exit 100); the CLI+Docker build is the reliable path.
- **C3 ✅ wiring** — `/connect` returns `{wssUrl, token}` for E2B; `E2BProvider.create`
  boots the in-sandbox WS server + injects the agent env + a derived per-sandbox
  token (`WS_TOKEN_SECRET = HMAC(ws_signing_key, sandbox_id)`); client
  `WsSessionConnection` connects direct. Suite 28/28. Commit `2edbb77`.
- **C4 ⏳ real-agent E2E on E2B** — gated on the image (C2).
- **C5 (deferred)** — remove Ably + the old CP relay (`ws.py`/`live_session`/
  `realtime/`/idle-loop); unify LocalProvider onto the WS server. Kept for local
  dev + as a fallback until the E2B path is proven.

## Morning run — client + server + E2B
Prereqs in `apps/server/.env`: `E2B_API_KEY`, `E2B_ACCESS_TOKEN`,
`ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`/`SECRET`, a stable `SESSION_SECRET`. The
`genealogy-agent` image built (C2).

1. **Terminal A:** `make server-e2b`  (control plane on `127.0.0.1:1837`,
   `SANDBOX_PROVIDER=e2b`, `AGENT_MODE=real`).
2. **Terminal B:** `make web-oauth`  (Vite proxied at `:1837`).
3. Open **http://127.0.0.1:5173** → Sign in with Google → create a research
   session. That provisions an E2B sandbox from `genealogy-agent`, boots its WS
   server; the browser connects **directly** to the sandbox's `wss://…e2b.app`
   for chat + the live viewer.
4. **FamilySearch (optional):** "Connect FamilySearch" (popup) or dev-connect —
   writes the token into the E2B sandbox. Needed only for FS tools; basic agent
   turns work without it.

### How a turn flows
`/connect` (E2B branch, `sessions.py`) → `provider.resume(sandbox)` +
`expose_port(8080)` + `mint_token(sandbox_id)` → `{wssUrl, token}`. Browser →
`wss://{port}-{id}.e2b.app/?token=…` → the in-sandbox WS server verifies the
token, spawns `agent_runner`, streams `agent_event`s + `/project` deltas. The
control plane only does auth + `/connect` + file reads (`/state`, `/status`,
sidecar, feedback) — never the stream.

## Deferred / known gaps (none block the live-test)
- **C5 cleanup** not done: Ably backends, the capability-token endpoint, the old
  `/ws` relay + `live_session` + `_idle_suspend_loop` are still present (local dev
  uses them; the E2B path doesn't). LocalProvider still uses the old relay.
- **FamilySearch token** is not auto-injected into E2B — dev/real connect writes it.
- **Wiki tools** (`wiki_read`/`wiki_place_page`) need the pre-crawled markdown
  corpus baked into the image (`wikiMarkdownDir`) — not baked, so those two tools
  error; everything else (incl. `wiki_search` over the network) works.
- **1h Hobby cap:** a continuously-active session force-pauses at ~1h (resumes in
  ~1s; a mid-turn pause breaks that turn). Proactive between-turn pause deferred.
- **Delete-janitor** (abandoned-sandbox GC) deferred — use the explicit DELETE.
- `ws_signing_key` defaults to a dev value; set a real one for prod.

## Rebuilding the image
`cd <repo> && E2B_API_KEY=… E2B_ACCESS_TOKEN=… bash apps/server/sandbox/build-image.sh`
(both creds needed: API key for the SDK/sandboxes, access token for the CLI).
