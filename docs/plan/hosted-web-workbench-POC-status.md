# Hosted Genealogy Workbench — POC build status & run guide

**Date:** 2026-06-06. **Branch:** `hosted-web-workbench`. **Read with:**
`hosted-web-workbench-spec.md` (§0.5 is the POC scope),
`hosted-web-workbench-implementation-plan.md`, `sandbox-provider-interface.md`.

This is what was built overnight: the full alpha POC (M0–M5), runnable **entirely
locally with mocks** — no E2B, no Anthropic key, no OAuth setup required to demo.
Everything is structured so swapping mocks → real is config + a provider adapter,
not a rewrite.

---

## TL;DR — try it in 90 seconds

```bash
make install          # pnpm workspace + the server venv (uv)
# terminal 1:
make server           # FastAPI control plane on :8000 (AGENT_MODE=mock)
# terminal 2:
make web              # Vite web client on :5173
```

Open **http://localhost:5173**, sign in with **dallan@gmail.com** (dev-login;
the allowlist also has `tester@example.com`), then:

- **Open a sample project** → the live viewer renders a full Patrick Flynn
  research project (all 11 sections).
- **+ New research session** → the agent interviews you (experience →
  subscriptions → objective), writes `research.json`, and you watch the viewer
  fill in live. Type **"search for census records"** → it logs a source +
  assertion + a results sidecar, live. **Connect FamilySearch** writes a mock
  token. Go back and reopen the session → the conversation resumes.

`make help` lists every target. `make test` runs the JS + server suites.

---

## What works (verified in a real browser)

| Capability | Status |
|---|---|
| Monorepo (pnpm + turbo), engine untouched | ✅ `.mcpb` + plugin `.zip` still build; packaging tests green |
| Shared `viewer-ui` in Electron **and** web via `ResearchTransport` | ✅ 99 viewer-ui tests; Electron builds + 40 tests |
| Google-allowlist app auth (dev-login; real Google scaffolded) | ✅ |
| Session list (create / sample / resume / delete; model picker) | ✅ |
| Live viewer over WebSocket (edit a file → UI updates ~1s) | ✅ |
| Chat → mock agent → `/project` writes → live viewer | ✅ |
| Conversational `init-project` onboarding (auto-started for new sessions) | ✅ |
| In-sandbox `agent_runner` subprocess + WS-port proxy (the unproven path) | ✅ proven locally |
| Suspend/resume continuity (mock state persists) | ✅ |
| FamilySearch token injection (option a; per-sandbox HOME) | ✅ mock connect |
| Local backup mirror of project files | ❌ removed — per-instance disk write that fought horizontal scaling; E2B sandboxes are durable |
| Web feedback bundle (zip of `/project` + agent log) | ✅ saved locally |
| Idle suspend (safe: never under a live socket) | ✅ (no-op for local; real for E2B) |
| Image proxy | 🟡 scaffolded (501; mock surfaces no FS images) |
| Real agent (Claude Agent SDK) | 🟡 `AGENT_MODE=real` path wired in `runner.py`; needs `claude-agent-sdk` + key (see below) |

---

## Architecture as built

```
Browser (apps/web, React+Vite)
  │  REST  (/auth, /api/sessions, /familysearch, /api/feedback)
  │  WS    (/ws/sessions/{id})  ← one socket: viewer deltas + chat
  ▼
FastAPI control plane (apps/server)
  ├─ auth (cookie + allowlist)         ├─ sessions REST + read API (/state,/sidecar)
  ├─ SandboxProvider → LocalProvider   │   (E2BProvider scaffolded)
  ├─ WS: watch /project → viewer deltas, AND pump agent_runner stdio ↔ browser
  └─ idle-suspend loop, feedback
        │  start_process → Process.stdout() / write_stdin()  (JSON lines)
        ▼
  agent_runner (subprocess; app/agent/runner.py)  ← in the sandbox
        │  clean asyncio.run stdio loop (NO in-sandbox WebSocket server)
        ├─ mock_agent (offline, scripted: init-project + research)
        └─ real_agent (Claude Agent SDK — working)
        └─ writes /project/{research.json, tree.gedcomx.json, results/*}
```

**Two decoupled paths** (per the spec): the **viewer** path is control-plane ↔
sandbox FS (watch + read), independent of chat; the **chat** path is the
browser WS ↔ control plane ↔ agent_runner **stdio** (JSON lines via the
`Process` abstraction). The agent writes files; the watch turns them into viewer
deltas — that's why the viewer updates live as the agent works.

**Realtime is behind a seam** (`config.realtime = local_ws`). Per your note, the
production shape is the agent_runner **publishing** deltas to a per-session
pub/sub channel (Ably/Pusher/Upstash) the browser subscribes to directly, with
chat *input* over REST — leaving FastAPI stateless/Lambda-friendly for
Amplify/Lightsail. That swap replaces `SessionConnection` (client) + the WS relay
(server); nothing else.

---

## Deviations from the plan (deliberate, low-risk)

1. **Engine stays at `mcp-server/` + `plugin/`** (not moved to `packages/engine`).
   It is kept *out* of the pnpm workspace and npm-managed, so the `.mcpb`/plugin
   release pipeline + CI need **zero** changes. The web/electron/viewer side
   depends on `packages/schema`, never on the engine. Moving it is cosmetic and
   can happen later.
2. **Tool count is 31, not 30**; **28 skills** confirmed (plan said 30/28).
3. **`research.json` keeps no `schema_version`** (the schema spec §7 decision),
   despite spec §11 — left as-is.
4. **Real Google/FamilySearch OAuth scaffolded, dev paths active** so the POC
   runs offline. The dev-login and FS dev-connect are disabled the moment real
   credentials are configured.
5. **Path-traversal:** sidecar log-ids are sanitized at the read API. The
   engine's `validator.ts:928` `results_ref` join is still unsanitized — a
   pre-existing bug to fix when `packages/schema` consolidates the validator.

---

## What you need to provision (and when)

Nothing is required to run the **local mock POC**. To go past mocks:

### To run the **real agent** locally — WORKING (`make server-real`)
- `claude-agent-sdk` is installed; `make server-real` runs `AGENT_MODE=real`.
- `ANTHROPIC_API_KEY` is read from `../cowork-genealogy-ui/.env` automatically
  (or export your own). Note: the bundled `claude` CLI also authenticates via
  your logged-in Claude Code session, so it works even without the key.
- Verified end-to-end in the browser: real turns complete, with accurate
  domain answers. See "Real agent" below for the architecture.

### To deploy the hosted alpha (when you wake up)
1. **E2B** — create an account, set `E2B_API_KEY`, build the sandbox template
   image (Node + Python + `claude-agent-sdk` + the genealogy MCP `build/` + the
   28 skills + `agent_runner` + the pre-crawled wiki markdown). Then implement
   `E2BProvider` (the SDK mapping is already in `sandbox/e2b.py`). Set
   `SANDBOX_PROVIDER=e2b`.
2. **Anthropic operator key** — `ANTHROPIC_API_KEY` on the server (injected per
   sandbox).
3. **Google OAuth client** — id + secret; redirect `https://<funnel>/auth/google/callback`;
   set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Wire the two TODOs in
   `auth.py` (`/google/login` + a `/google/callback`). Dev-login auto-disables.
3. **FamilySearch dev key** — register `https://<funnel>/familysearch/callback`;
   confirm the key allows a few external alpha users + the web redirect flow.
   Set `FAMILYSEARCH_WEB_ENABLED=true` and wire the `/familysearch/login` +
   callback (reuse the engine's PKCE/exchange/refresh from `mcp-server/src/auth`).
4. **Tailscale Funnel** — expose the control plane (443) **and** confirm the two
   sidecar endpoints (`malachi.taild68f1b.ts.net` wiki + pop-stats) are
   Funnel-exposed (public ingress), so E2B sandboxes can reach them.
5. **Postgres** (for >1 control-plane instance) — swap SQLite → Postgres (same
   tables). Project files live on the durable E2B sandbox FS (no object-store
   sync planned); feedback bundles would move to object storage if kept.

The env knobs the server reads are all in `apps/server/app/config.py`
(`AGENT_MODE`, `SANDBOX_PROVIDER`, `REALTIME`, `ALLOWED_EMAILS`,
`GOOGLE_CLIENT_ID`, `FAMILYSEARCH_WEB_ENABLED`, `ANTHROPIC_API_KEY`,
`PUBLIC_URL`, `IDLE_SUSPEND_SECONDS`, …).

---

## Real agent (`AGENT_MODE=real`) — WORKING end to end

`claude-agent-sdk` (0.2.93) drives the genealogy skills + stdio MCP server.
Verified in the browser: real turns complete with accurate, domain-grounded
answers (e.g. *"proof tier is probable — held back from proved by the unsearched
1870–1900 censuses, Thomas Flynn's unlocated probate, and the unresolved mother
conflict c_002"*; *"5 sources"*), tool-call chips stream, sequential turns work.

**Transport (the fix — supersedes sandbox doc decision #3 for the agent channel):**
the agent_runner does **not** run an in-sandbox WebSocket server. The SDK's anyio
subprocess transport hangs when hosted inside `websockets.serve` (and in a worker
thread — it needs the main-thread loop). Instead the agent_runner is a clean
`asyncio.run` loop speaking **JSON lines over stdio**: it reads `user_msg` from
stdin and writes `agent_event` to stdout. The control plane spawns it via
`SandboxProvider.start_process` and pumps `Process.stdout()`/`write_stdin()` to/
from the browser WS. This keeps the SDK in the context it likes, removes a whole
WS layer (`expose_port` + proxy), and maps cleanly onto E2B's
`commands.run(background, stdin=True, on_stdout=…)`. File deltas still come from
the control-plane `/project` watch, so the agent channel is chat-only and its
stdout is clean JSON.

**Two real-mode gotchas solved (documented in real_agent.py):**
- Do **not** set `skills="all"` — the SDK turns it into `--allowedTools Skill`,
  a non-empty allowlist that restricts the agent to *only* the Skill tool (no
  Read/Bash/MCP). Leave it unset; `bypassPermissions` grants everything and the
  built-in Skill tool still invokes the plugin's skills.
- Append the project location via `system_prompt` (preset+append) so the agent
  reads `research.json` from cwd, not HOME.

**Cross-turn memory (done).** `real_agent` holds a **persistent
`ClaudeSDKClient`** in the long-lived stdio runner (connect once, query per
turn), so conversation carries across turns — verified: turn 2 recalls turn 1.
For durability across a sandbox pause/resume or any runner restart, the
`ResultMessage.session_id` is persisted to `/project/.agent_session` and a
relaunched agent passes it as `resume=` — verified: a fresh runner resumed the
prior conversation from the on-disk transcript. (This also answers "can we rely
on the Agent SDK on a persistent E2B instance?" — yes, anchored to the on-disk
session transcript + `resume`, which survives E2B's FS pause, not to process
memory.) Note: on E2B / per-sandbox HOME there's no logged-in Claude session, so
the CLI authenticates via the operator `ANTHROPIC_API_KEY` (already in the
provisioning list); locally the tests used the logged-in Claude Code session.

**Minor follow-up:** tool-result chips show "running" rather than flipping to
"done" (the SDK's `ToolResultBlock` carries a tool-use id, not the name — a
cosmetic match to wire).

Mock mode (the default) is unaffected.

---

## Security notes

- ⚠️ `../cowork-genealogy-ui/.env` contains a live **Anthropic** key and a live
  **OpenAI** key. Both passed through this build session. Consider rotating the
  OpenAI one. The keys are never copied into this repo (the copied `.env` was
  deleted; `.env` is gitignored everywhere).
- POC defers PII/compliance (§13): users instructed to enter no living-person
  data. FS tokens stored unencrypted (mock); encrypt before real PII.

---

## Test surfaces

- `pnpm test` → viewer-ui (99) + Electron (40, incl. both transport contract
  tests).
- `cd apps/server && uv run pytest` → 9 server tests incl. the **chat proxy
  round-trip** (the risky WS-port path) and FS token injection.
- `make mcpb` / `make plugin` → the unchanged desktop/Cowork artifacts.
