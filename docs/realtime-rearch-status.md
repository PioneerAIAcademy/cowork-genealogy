# Realtime re-architecture — build status & morning run guide

**Where the code is:** **merged to `main`.** The `hosted-web-workbench` branch
this was written on no longer exists — `apps/server`, `apps/web`, and
`packages/{schema,viewer-ui}` are all on `main`.
**What this is:** the "sandbox IS the
per-session server" build (docs/realtime-architecture.md). The browser
opens ONE authenticated WSS directly to the E2B sandbox; the control plane is out
of the streaming path (affinity-free).

## Checkpoint status
- **C1 ✅ in-sandbox WS server** (`apps/server/app/sandbox_server.py`) — HMAC token
  auth at handshake, spawns `agent_runner`, pumps stdout↔ws + ws→stdin, `/project`
  poll-watch → viewer deltas, snapshot on connect, multi-socket fan-out. Tested
  with the real `agent_runner` (mock agent). Commit `7f0840c`.
- **C2 ✅ E2B image** (`genealogy-agent`, id `29srhf18wfleun0yezuk`) — built + pushed
  via the CLI + Docker path (`bash apps/server/sandbox/build-image.sh` with
  `E2B_API_KEY` + `E2B_ACCESS_TOKEN`). Dockerfile: `apps/server/sandbox/e2b.Dockerfile`
  (added `websockets`; single-line `ENV`s — the v2 SDK remote build mangled
  multi-line ones). The api-key SDK remote build was flaky (ENV spacing → COPY
  dest → apt exit 100); CLI+Docker is the reliable path. Commit `7b73132`.
- **C3 ✅ wiring** — `/connect` returns `{wssUrl, token}` for E2B; `E2BProvider.create`
  boots the in-sandbox WS server + injects the agent env + a derived per-sandbox
  token (`WS_TOKEN_SECRET = HMAC(ws_signing_key, sandbox_id)`); client
  `WsSessionConnection` connects direct. Suite 28/28. Commit `2edbb77`.
- **C4 ✅ real-agent E2E on E2B** — VERIFIED on a real microVM: `provider.create` →
  WS server boots → token-authed WSS connect → real `claude-agent-sdk` + genealogy
  MCP run IN E2B → `agent_event` stream + `turn_done`. The `/connect` HTTP endpoint
  was also smoke-tested through the running server (returns a live `wss://…e2b.app`
  + token). Commit `7b73132`. **One gotcha fixed:** E2B `commands.run` does NOT
  inherit the image `ENV`, so the WS-server launch passes `PYTHONPATH`/`ENGINE_*`/
  `HOME` explicitly.
- **C5 ✅ cleanup done** — Ably and the old control-plane relay are gone from
  `apps/server/app`: no `ws.py`, no `realtime/`, no `live_session`, no
  `_idle_suspend_loop`, no capability-token endpoint, and no Ably import
  anywhere (the only surviving mentions are two historical comments, in
  `sandbox/e2b.py` and `tests/conftest.py`). LocalProvider is unified onto the
  same in-sandbox WS server — it launches `python -m app.sandbox_server` as a
  subprocess, so local dev and E2B now run identical streaming code.
  **One loose end:** `ably>=3.1.2` is still a declared dependency in
  `apps/server/pyproject.toml` (and `uv.lock`) with nothing importing it —
  drop it on the next dependency pass.

## Morning run — client + server + E2B
Prereqs in `apps/server/.env`: `E2B_API_KEY`, `E2B_ACCESS_TOKEN`,
`ANTHROPIC_API_KEY`, `FAMILYSEARCH_WEB_ENABLED=true`, a stable `SESSION_SECRET`,
and — for anything but local dev — a real `WS_SIGNING_KEY`. The
`genealogy-agent` image built (C2).

1. **Terminal A:** `make server-e2b`  (control plane on `127.0.0.1:1837`,
   `SANDBOX_PROVIDER=e2b`, `AGENT_MODE=real`).
2. **Terminal B:** `make web`  (Vite proxied at `:1837`).
3. Open **http://127.0.0.1:5173** → **Sign in with FamilySearch** → create a
   research session. That provisions an E2B sandbox from `genealogy-agent`, boots
   its WS server; the browser connects **directly** to the sandbox's
   `wss://…e2b.app` for chat + the live viewer.

> **Login changed after this was written, verified 2026-08-02.** FamilySearch is
> now the **single front door** (`apps/server/app/auth.py`): one OAuth round-trip
> both gates app access via the email allowlist *and* persists the data token
> every sandbox-create injects. There is **no Google sign-in** and **no
> per-session "Connect FamilySearch" step** — both are gone, along with
> `GOOGLE_CLIENT_ID`/`SECRET`. There is also no `make web-oauth` target; the
> FamilySearch path is `make web` (`:1837`). With `FAMILYSEARCH_WEB_ENABLED` off,
> a **dev-login** (allowlisted email, no round-trip) stands in and the agent runs
> in mock mode — pair that with `make server-dev` / `make server-mock` on `:8000`
> and `make web-dev`. Full target matrix: `DEVELOPMENT.md` → "Running the hosted
> web workbench locally".

### How a turn flows
`/connect` (E2B branch, `sessions.py`) → `provider.resume(sandbox)` +
`expose_port(8080)` + `mint_token(sandbox_id)` → `{wssUrl, token}`. Browser →
`wss://{port}-{id}.e2b.app/?token=…` → the in-sandbox WS server verifies the
token, spawns `agent_runner`, streams `agent_event`s + `/project` deltas. The
control plane only does auth + `/connect` + file reads (`/state`, `/status`,
sidecar, feedback) — never the stream.

## Deferred / known gaps (none block the live-test)
- **`ably>=3.1.2` is still declared** in `apps/server/pyproject.toml` even though
  the C5 cleanup removed every import. Dead weight in the image, not a behavior
  gap.
- **FamilySearch token** is not auto-injected into E2B — dev/real connect writes it.
- ~~**Wiki tools** need the pre-crawled markdown corpus baked into the image
  (`wikiMarkdownDir`).~~ **Obsolete, not pending (verified 2026-08-02).**
  `wiki_read` and `wiki_place_page` are now HTTP clients against the hosted
  `wiki-query-api`, the same as `wiki_search` — there is no corpus to bake and no
  `wikiMarkdownDir`. All three work in the sandbox wherever the API is reachable.
- **1h Hobby cap:** a continuously-active session force-pauses at ~1h (resumes in
  ~1s; a mid-turn pause breaks that turn). Proactive between-turn pause deferred.
- **Delete-janitor** (abandoned-sandbox GC) deferred — use the explicit DELETE.
- `ws_signing_key` defaults to a dev value; set a real one for prod.

## Rebuilding the image
`cd <repo> && E2B_API_KEY=… E2B_ACCESS_TOKEN=… bash apps/server/sandbox/build-image.sh`
(both creds needed: API key for the SDK/sandboxes, access token for the CLI).
