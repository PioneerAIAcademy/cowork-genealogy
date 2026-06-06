# Hosted Genealogy Workbench — Implementation Plan (POC / Alpha)

**Audience:** the dev team. **Read with:** `hosted-web-workbench-spec.md` (system
spec; §0.5 is the POC scope) and `sandbox-provider-interface.md` (sandbox layer).
**Date:** 2026-06-05.

This plan turns the spec into an ordered, task-level build for the alpha POC.
Each milestone lists **goal → tasks → acceptance criteria → packages touched**.
Milestones are sequenced so something runnable exists early and risk is front-loaded.

---

## A. POC scope recap (what we are building)

A single web app — **a project viewer with a chat sidebar** — for a handful of
allowlisted alpha users (no living-person data; PII work deferred). Landing screen
is a **session list**; each session is a hibernated **E2B microVM** holding one
Agent SDK session + one project. The user picks a session (resume) or starts a new
one (create + conversational `init-project`). The agent = the **existing 28 skills
+ 30-tool stdio MCP server**, run under the **Claude Agent SDK inside the sandbox**.
Everything except the sandboxes runs on **Dallan's local server**, exposed via
**Tailscale Funnel**.

**`session == project == sandbox`, 1:1.** Many sessions per user.

---

## B. Tech stack & conventions

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + turborepo |
| Shared UI | `packages/viewer-ui` (React 19, the extracted renderer) |
| Web app | `apps/web` (React 19 + Vite) |
| Electron | `apps/electron` (existing app, consumes `viewer-ui`) |
| Control plane | `apps/server` — **FastAPI (Python)** |
| Agent runtime | `agent_runner.py` (Python Agent SDK) inside the E2B sandbox |
| DB | **SQLite** (local file) via SQLModel/SQLAlchemy |
| Sandbox SDK | `e2b` Python SDK (`AsyncSandbox`) behind `SandboxProvider` (E2BProvider only for POC) |
| Auth | Google OIDC (app access) + per-user FamilySearch OAuth (data access) |
| Transport | Browser ↔ server **WebSocket** (chat + viewer deltas) + HTTP (REST) |
| Ingress | Tailscale Funnel (public HTTPS) |

Casing: web/wire = camelCase; persisted research.json/tree.gedcomx = snake_case
(unchanged from the engine).

---

## C. Environment / secrets / config (provision before M2)

- `E2B_API_KEY` (+ `E2B_DOMAIN` if self-host later) — control plane.
- `ANTHROPIC_API_KEY` (operator) — injected into each sandbox; `MODEL` per-session
  (`claude-sonnet-4-6` / `claude-opus-4-8`).
- Google OAuth client id/secret + redirect `https://<funnel>/auth/google/callback`.
- FamilySearch: bundled client id; **add redirect `https://<funnel>/familysearch/callback`**
  to the FS app; confirm dev-key allows external alpha users + web flow.
- `ALLOWED_EMAILS` seed (allowlist).
- Tailscale Funnel enabled for: the control plane (443) **and** the two sidecar
  endpoints (`/wiki`, `/pop-stats`).
- Sandbox image carries: Node + Python + `claude-agent-sdk`, the genealogy MCP
  `build/`, the 28 `.claude/skills/`, `agent_runner.py`, and the pre-crawled wiki
  markdown corpus (for `wiki_read`/`wiki_place_page`).

---

## D. Key contracts (freeze these early; everything else codes against them)

**1. `ResearchTransport`** (shared by Electron + web) — see spec §4.1.
**2. `SandboxProvider` / `Sandbox` / `Process`** — see `sandbox-provider-interface.md` §4.
**3. Browser ↔ server WebSocket** (per active session) — see spec §6.2:
```
client → server : {type:"user_msg", text} | {type:"interrupt"}
server → client : {type:"agent_event", event}            # streamed Agent SDK output
                  {type:"research_updated", data}         # from E2B files.watch_dir
                  {type:"gedcomx_updated", data}
                  {type:"sidecar_updated", logId, mtime}
                  {type:"status", state}                  # starting|ready|suspended|error
                  {type:"auth_required", provider:"familysearch"}
```
**4. SQLite tables:** `users`, `allowed_emails`, `familysearch_tokens`,
`projects(id,user_id,sandbox_id,agent_session_id,title,created,updated,last_active)`,
optional `usage`. (FS token may also live only on the sandbox FS per §0.5; keep a
DB copy if you want central refresh — decide in M4.)

---

## Milestone 0 — Monorepo bootstrap
**Goal:** one repo, both existing artifacts still build.
**Tasks:**
- Create pnpm/turborepo monorepo; move `mcp-server` + `plugin` into
  `packages/engine`; keep `scripts/build-mcpb.sh` + `scripts/package-plugin.sh`
  working (they still produce `genealogy-mcp.mcpb` + `genealogy-plugin.zip`).
- Move the Electron app in as `apps/electron`.
- Add empty `packages/viewer-ui`, `packages/schema`, `apps/web`, `apps/server`.
**Acceptance:** `.mcpb` + plugin `.zip` still build; Electron app still runs; CI
(`tests/packaging/*`) green.
**Packages:** all (scaffolding).

## Milestone 1 — Extract `viewer-ui` (transport-agnostic)
**Goal:** the renderer runs in Electron via an injected transport (no behavior change).
**Tasks:**
- Move renderer (`App`, 11 sections, shared components, `lib/*`) into
  `packages/viewer-ui`; move research/GedcomX TS types into `packages/schema`.
- Define `ResearchTransport` (contract D.1). Refactor `ResearchDataProvider` to take
  a transport prop instead of calling `window.api` directly.
- `apps/electron`: implement `IpcResearchTransport` wrapping the existing
  `window.api`; render `viewer-ui`. Keep `main/`, `preload/`, watcher, sidecar,
  feedback as-is.
**Acceptance:** Electron app behaves identically to today, but its UI is the shared
package. A `ResearchTransport` contract test passes against the IPC adapter.
**Packages:** `viewer-ui`, `schema`, `apps/electron`.

## Milestone 2 — Control-plane skeleton + auth + session list
**Goal:** a user can log in (Google + allowlist) and see/create sessions (no agent yet).
**Tasks:**
- FastAPI app; SQLite (contract D.4); Tailscale Funnel ingress.
- Google OIDC login + allowlist check → signed session cookie.
- `SandboxProvider` → **`E2BProvider`** (implement `create/get/resume/suspend/
  delete/list` + `Sandbox.read_file/write_file/list_dir/exec/start_process/
  expose_port` per the interface doc, E2B side only).
- Build the **sandbox image** (E2B template) per §C.
- REST: `GET /api/sessions` (list `projects`), `POST /api/sessions` (create sandbox
  + project row), `POST /api/sessions/{id}/resume`, `DELETE`.
- `apps/web` shell: Google login screen → **session list** landing → "new"/"open".
**Acceptance:** login gated by allowlist; create a session → a real E2B sandbox
exists; list/resume/delete work; suspend on disconnect.
**Packages:** `apps/server`, `apps/web`.

## Milestone 3 — Viewer path (read-only, live)
**Goal:** opening a session shows its live project state and updates in real time —
**no chat yet.**
**Tasks:**
- On resume: control plane reads `/project` from the sandbox (`files.read`/`list`),
  sends a snapshot; subscribe via **E2B `files.watch_dir("/project")`** and push
  `research_updated`/`gedcomx_updated`/`sidecar_updated` over the browser WS.
- `apps/web`: implement `WsResearchTransport` (contract D.1 over the WS + REST);
  mount `viewer-ui`.
- Seed a sandbox with a sample `research.json`/`tree.gedcomx.json` to verify
  rendering end-to-end.
**Acceptance:** the web viewer renders the same sections as Electron from a live
sandbox; editing a file in the sandbox updates the web UI within ~1s. Same
`ResearchTransport` contract test passes against the WS adapter.
**Packages:** `apps/server`, `apps/web`, `viewer-ui`.

## Milestone 4 — Agent path (chat + FamilySearch) ← highest risk, do carefully
**Goal:** a full research session: connect FamilySearch, chat, tools run, files update.
**Tasks:**
- `agent_runner.py`: Agent SDK (`ClaudeSDKClient`) loading `.claude/skills` +
  the stdio MCP server; WS server on a port; `resume=session_id`; streams
  `agent_event`s. (Spec §7 / sandbox doc §6.)
- Control plane: launch `agent_runner` via `start_process`, get its address via
  `expose_port`, and **proxy** the browser WS ↔ in-sandbox WS for chat; multiplex
  with the viewer deltas from M3 on the one browser socket.
- **FamilySearch web OAuth:** `/familysearch/login` + `/familysearch/callback`
  (reuse PKCE/token-exchange/refresh from `engine/.../auth`; drop the localhost
  server/`open()`); write tokens to `~/.familysearch-mcp/tokens.json` **inside the
  sandbox** (option a); emit `auth_required` when not connected.
- **New session** auto-sends the opening turn → `init-project` runs conversationally.
- Model config knob (Sonnet/Opus) per session.
- **Watch the two unverified risks here:** the in-sandbox WS-port round-trip, and
  pause/resume with a live session (re-launch `agent_runner`, restore via
  `resume=session_id`). If resume misbehaves, add reconnect/checkpoint handling.
**Acceptance:** from a clean login: new session → init-project interview → connect
FamilySearch → run a real `record_search`/`person_read` → assertions appear in the
viewer live → suspend → resume → continue the same conversation.
**Packages:** `apps/server` (+ `agent_runner.py`), `engine` (FS web-OAuth), `apps/web` (chat UI).

## Milestone 5 — POC polish
**Goal:** durable enough + observable enough for alpha.
**Tasks:**
- **Local backup dir:** mirror `research.json`/`tree.gedcomx.json`/`results/` to a
  per-session folder on the server as deltas stream (insurance vs sandbox loss).
- **Feedback:** read the in-sandbox `~/.claude/.../*.jsonl` + `/project` via
  `files.read`, bundle (port `feedback.ts` logic); add `POST /api/feedback`.
- **Sidecars:** verify Funnel reachability for `wiki_search`/`place_population`
  from inside a sandbox; confirm wiki markdown corpus is in the image.
- **Cost/idle:** aggressive idle suspend (E2B pause) + optional per-session token
  budget; log token + sandbox-second usage.
- **Image proxy:** `GET /api/image/{imageId}` → `image_read` for FamilySearch images.
- **Observability:** structured logs (no record/tree contents); basic error tracking.
**Acceptance:** a killed sandbox can be re-hydrated from the backup; feedback zip
contains the transcript; wiki/place tools work; idle sessions suspend; images render.
**Packages:** `apps/server`, `apps/web`.

---

## E. Risks / watch-items
- **WS-port + pause/resume** (M4) — the one genuinely unproven path; surface early
  in M4, not at the end.
- **FamilySearch dev-key** limits on external users / web redirect (confirm in C).
- **Funnel** reachability + throughput for sidecars and per-user browsers (handful
  of users → fine; don't assume it scales past alpha).
- **Single copy of project data on E2B** — mitigated by the M5 local backup.
- **Agent SDK skill/MCP loading inside the image** — verify `setting_sources`/
  `skills` discovery + the stdio MCP fork work in the sandbox during M4.

## F. Out of scope for the POC
PII/compliance hardening, cloud/object-store, Postgres, multi-region, collaboration,
public signup, billing, self-hosted E2B (the FamilySearch endgame). The
vendor-neutral `SandboxProvider` is kept so that endgame stays cheap later.
