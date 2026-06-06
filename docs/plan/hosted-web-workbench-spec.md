# Hosted Genealogy Workbench — Developer Spec

**Status:** draft spec for implementation. **Date:** 2026-06-05.
**Companion docs:** sandbox layer = `docs/plan/sandbox-provider-interface.md`
(the per-user E2B sandbox abstraction); architecture/decision record = project
memory `client-server-workbench-direction.md`.

---

## 0. TL;DR of the decisions already made

- **Re-host, don't rewrite.** The hosted product runs the **existing** SKILL.md
  skills + stdio MCP server under the **Claude Agent SDK**, inside a **per-user
  E2B microVM** (chosen platform; FamilySearch will require microVM isolation).
  See `sandbox-provider-interface.md`.
- **Operator pays** for Claude (our Anthropic key). **Hosted multi-user SaaS.**
- **Three artifacts ship from one monorepo:** (1) the existing Cowork plugin +
  `.mcpb` MCP extension (unchanged in purpose), (2) the existing Electron viewer
  (adapted to share code), (3) the **new** hosted web workbench (chat + viewer).
- **The viewer is shared code**; the chat is net-new.

---

## 0.5 POC scope (alpha) — decisions & overrides (2026-06-05)

This section records the **alpha/POC** decisions and **overrides** the
correspondingly-numbered general sections below. The general spec remains the
"eventual" design; build the POC per this section.

- **Why a POC:** let alpha users who *can't install Claude Cowork* help test the
  system. Handful of users. **PII deferred** — users are instructed to enter **no
  living-person data**; §13's residency/retention/compliance work is out of scope
  for now.
- **Deployment — everything on Dallan's local server** except the E2B sandboxes:
  the FastAPI control plane, the web app, and the DB all run locally; the control
  plane calls E2B (outbound) for per-user sandboxes. The server is exposed via
  **Tailscale Funnel** (public HTTPS at `https://<machine>.<tailnet>.ts.net`),
  which is both how alpha users' browsers reach it and the **OAuth redirect
  target** for Google + FamilySearch. The Funnel URL is registered as an allowed
  redirect URI on the FamilySearch OAuth client (Dallan controls this) and the
  Google OAuth client.
- **Database = SQLite** on the local server (not Postgres yet). Same logical
  tables as §6.3.
- **No cloud object store** (overrides §6.4). Project files (`research.json`,
  `tree.gedcomx.json`, `results/`) live on the **E2B sandbox filesystem** and
  persist across hibernation (E2B pause snapshots the FS). **Recommended cheap
  insurance:** the control plane mirrors the small JSON files to a **local backup
  dir per session** as deltas stream through for the viewer (protects against
  sandbox loss; risk if skipped = deleted/corrupted sandbox loses that project).
- **Session-centric model — `session == project == sandbox`, 1:1.** A "session" is
  a hibernated E2B sandbox holding **one** Agent SDK session and **one** project
  at `/project`. **Many sessions per user.** App landing screen = a **session list**
  (from SQLite: user_id, sandbox_id, agent_session_id, title, last_active).
  Select → resume that sandbox; New → create a sandbox + run `init-project`.
- **Combined client (overrides the "two-pane" framing in §8):** ONE app = a viewer
  **with a chat sidebar**. The session list is the landing view. The viewer only
  ever renders a **live (resumed)** session — never hibernated state, no object
  store read.
- **Viewer data path (the "trick"):** on resume, the control plane reads `/project`
  from the sandbox FS via E2B `files.read`/`files.list` and sends a snapshot to the
  client; then it streams live updates by watching the sandbox FS with E2B
  **`files.watch_dir("/project", on_event)`** + `files.read`, pushing
  `research_updated` / `gedcomx_updated` / `sidecar_updated` over the WS. This
  viewer path is control-plane↔E2B and is independent of the chat channel.
- **FamilySearch token (overrides §5.2 option choice):** option **(a)** — the
  control plane writes the token to `~/.familysearch-mcp/tokens.json` **inside the
  sandbox** after OAuth (zero MCP code change); the in-sandbox MCP server refreshes
  it; it persists across hibernation. *Initial* OAuth still needs a hosted/tunneled
  redirect URI registered with FamilySearch.
- **Feedback (refines §11):** the control plane reads the in-sandbox Agent SDK
  transcript (`~/.claude/projects/<…>/*.jsonl`) + `/project` files via E2B
  `files.read` and bundles them — the existing `feedback.ts` logic, repointed at
  the sandbox FS.
- **Sidecars:** `wiki_search`/`place_population` call `malachi.taild68f1b.ts.net`.
  A `*.ts.net` host is reachable from an E2B sandbox **iff it is exposed via
  Tailscale Funnel** (public ingress) — *not* if it is a plain private-tailnet
  MagicDNS name. Action: confirm those two endpoints are Funnel-exposed (expected);
  then E2B sandboxes reach them with no relocation. Separately, the pre-crawled
  wiki markdown (`wikiMarkdownDir`) for `wiki_read`/`wiki_place_page` is read from
  **disk**, so that corpus must be **baked into the sandbox image** (or those two
  tools disabled for the POC).
- **Models:** Dallan provides the Anthropic key. Model is a **per-session config
  knob**; alpha will A/B **Sonnet vs Opus** for cost/performance (Opus ≈ 5× Sonnet
  token cost — fine for comparison, watch the bill).
- **New-session onboarding = conversational.** "New session" creates a fresh
  sandbox with an empty `/project`, starts `agent_runner`, and the client
  **auto-sends an opening turn** ("start a new genealogy research project") that
  triggers the existing **`init-project`** skill — researcher-profile interview +
  FamilySearch-person seeding, in chat, reusing the skill as-is (no new onboarding
  UI). The session is titled provisionally and renamed once the objective is set.

---

## 1. Goals / non-goals

**Goals**
- A browser workbench where a whitelisted user logs in (Google), connects their
  FamilySearch account, and does GPS-conformant research by **chatting with an
  agent** while a **live project viewer** updates beside the chat.
- Maximum reuse: the agent = today's skills + MCP server; the viewer = today's
  Electron renderer; both shared, not forked.
- Keep shipping the Cowork plugin + `.mcpb` for existing Cowork users.

**Non-goals (v1)**
- Collaboration / multi-user shared projects, org accounts, billing UI, mobile.
- Replacing Cowork for existing users (it continues unchanged).
- Public signup (access is gated to a Gmail allowlist).

---

## 2. The three products and what they share

| Product | Runtime | Status | Shares |
|---|---|---|---|
| **Cowork plugin + `.mcpb`** | Claude Cowork VM + host | exists, continues | the **engine** (skills + MCP server) |
| **Electron viewer** | desktop | exists, adapted | the **viewer-ui** + **schema** packages |
| **Hosted web workbench** (new) | browser + our cloud + E2B | new | **engine** (server-side) + **viewer-ui** + **schema** |

**The engine (skills + MCP server) is the single source of truth** consumed two
ways: Cowork loads it as a plugin; the web backend loads it via the Agent SDK
inside the sandbox. The viewer-ui is consumed two ways: Electron (IPC transport)
and web (WebSocket transport).

---

## 3. System architecture & topology — *where each piece runs*

> **Important correction to "server deployment on E2B":** E2B hosts the
> **per-user agent sandboxes only**. E2B is sandbox infrastructure, not a general
> app host — it cannot run our always-on control plane or serve the web app. The
> **control plane (FastAPI), web app, database, and object store run on
> conventional always-on infra** (Fly.io / Render / Cloud Run / a VM). The
> control plane *calls* E2B to create/resume per-user sandboxes.

```
                         ┌────────────────────────── our cloud (always-on) ──────────────────────────┐
  Browser ── HTTPS ────► │  Web app (static)   FastAPI control plane            Postgres   Object store │
  (React: chat+viewer)   │                     ├─ Google auth + allowlist        (users,     (S3/GCS:    │
        ▲   │            │                     ├─ FamilySearch OAuth (per-user)   sessions,   per-user   │
        │   └── WS ──────┼───────────────────► ├─ session/sandbox orchestrator    FS tokens,  project    │
        │  (chat +       │                     │   (SandboxProvider → E2B)         sandbox     folders)   │
        │   live deltas) │                     ├─ viewer read API (durable state)  map)                   │
        │                │                     └─ feedback, sidecar-image proxy                           │
        │                └───────────────────────────────────┬───────────────────────────────────────────┘
        │                                                     │ create / resume / suspend / write-secrets / expose-port
        │                                                     ▼
        │                                      ┌──────────── E2B (per user) ────────────┐
        └──────── proxied WS ──────────────────┤ agent_runner.py (Agent SDK, WS server) │
                                               │   └─ node CLI → node stdio MCP → FamilySearch / sidecars
                                               │ /project (research.json, tree.gedcomx.json, results/) ──► object store
                                               └─────────────────────────────────────────┘
```

**Two decoupled paths (key design rule):**
- **Read/viewer path** — always available, even when the user's sandbox is
  suspended. The control plane serves the latest project state from the
  **object store / DB** (synced out of the sandbox on every change) and pushes
  live deltas over WS *when a session is active*. Viewing never requires waking
  a sandbox.
- **Write/chat path** — requires a **live sandbox**. The control plane
  resumes/creates the user's sandbox, injects secrets, launches `agent_runner`,
  and proxies the browser↔sandbox WebSocket.

---

## 4. Monorepo & code-sharing

Bring everything into one monorepo (pnpm + turborepo). The Electron app moves in
as an app package so it can consume the shared `viewer-ui` (this is what "client
and electron share code" requires).

```
/packages
  /engine       skills (SKILL.md ×28) + MCP server (TS, 30 tools)  ← source of truth for Cowork AND web
  /schema       research.json + simplified-GedcomX TS types + JSON Schemas (single source; used by
                viewer-ui, the validate_research_schema tool, and the server)
  /viewer-ui    the renderer: App, 11 sections, shared components, lib/, ResearchDataProvider —
                refactored to take a **ResearchTransport** (no direct window.api)
/apps
  /cowork-plugin  packages engine skills → genealogy-plugin.zip   (scripts/package-plugin.sh)
  /mcpb           packages engine MCP server → genealogy-mcp.mcpb (scripts/build-mcpb.sh)
  /electron       thin shell: injects an **IPC** ResearchTransport (wraps today's window.api + main/preload)
  /web            React app: chat UI + viewer-ui with a **WebSocket** ResearchTransport
  /server         FastAPI control plane (Python) + agent_runner.py (ships into the sandbox image)
```

### 4.1 The shared seam: `ResearchTransport`

Today `ResearchDataProvider` calls `window.api.*` directly. Refactor it to accept
a transport object so the *same* provider + components run in both apps:

```ts
interface ResearchTransport {
  getProjectState(): Promise<{ research: ResearchData | null; gedcomx: GedcomxData | null }>;
  subscribe(handlers: {
    onResearch(d: ResearchData): void;
    onGedcomx(d: GedcomxData): void;
    onSidecar(e: { logId: string; mtime: number }): void;
    onError(msg: string): void;
  }): () => void;                                   // returns unsubscribe
  readSidecar(logId: string): Promise<{ raw: string; mtime: number } | null>;
  openExternal(url: string): void;                  // electron: window.api.openExternal; web: window.open
  submitFeedback(payload: FeedbackPayload): Promise<{ ok: true; filename?: string }>;
}
```

- **Electron adapter** wraps the existing `window.api` (no behavior change).
- **Web adapter** maps `subscribe` → WebSocket messages, `getProjectState`/
  `readSidecar`/`submitFeedback` → HTTP, `openExternal` → `window.open`.
- **Electron-only `window.api` methods drop out of the shared interface**:
  `selectFolder`, `openFile`, `listProjectFiles`, `getSessionLog`, `getVersion`
  are desktop "open a local folder" concepts. The web app replaces folder
  selection with **server-side project selection** (§7.4) and a different
  feedback/session-capture model (§11).

~90% of the renderer (App, 11 sections, shared components, `lib/schema.ts`,
`progress.ts`, `relationship-label.ts`) moves into `viewer-ui` unchanged.

---

## 5. Authentication & authorization — **two distinct layers**

> **Gap the original list misses:** Google login only controls *app access*. The
> product also needs **per-user FamilySearch OAuth** for the MCP tools to work at
> all. These are two separate flows.

### 5.1 App login: Google OAuth + Gmail allowlist (the "simple auth")
- Google OIDC (Authorization Code + PKCE). On callback, verify the email, check
  it against an **allowlist** (DB table `allowed_emails`, seedable from env).
  Non-allowlisted → 403.
- Issue a signed session (HTTP-only secure cookie or short-lived JWT + refresh).
- This is the only thing the user's *Google* identity does. It is **not** used by
  any genealogy tool.

### 5.2 Data auth: per-user FamilySearch OAuth (the big refactor)
The current MCP auth (`mcp-server/src/auth/`) is **single-user, single-machine**:
`login.ts` runs a **localhost:1837** callback and writes one
`~/.familysearch-mcp/tokens.json`; every tool calls `getValidToken()` which reads
that **one global file** — there is **no per-request/per-env token path**. For
multi-tenant web this must change:

1. **Web OAuth redirect flow** — replace the localhost callback with a hosted
   redirect URI (`https://<app>/familysearch/callback`). Reuse the existing PKCE
   + token-exchange + refresh logic; replace only the transport (no `open()`/
   localhost server).
2. **Per-user token storage** — store `{access, refresh, expiresAt}` per user in
   the DB (encrypted at rest), keyed by user id. Auto-refresh server-side.
3. **Token injection into the sandbox** — on each session connect, the control
   plane writes a fresh token into the user's sandbox; `agent_runner` passes it
   to the MCP server. Two implementation options:
   - **(a) Minimal:** write `~/.familysearch-mcp/tokens.json` inside the sandbox
     (matches today's MCP server exactly — zero MCP code change). Simple, works,
     but couples to the file format.
   - **(b) Clean:** refactor `getValidToken()` to accept a token from an env var
     / per-session config the MCP server reads (`FAMILYSEARCH_ACCESS_TOKEN`),
     and the control plane refreshes centrally. Preferred long-term.
   Recommendation: ship (a) for v1 speed, plan (b).
4. **Onboarding gate** — a user who hasn't connected FamilySearch is prompted to
   before any research tool runs.

---

## 6. The server (FastAPI control plane)

### 6.1 Responsibilities
- Google auth + allowlist; FamilySearch OAuth redirect + per-user token store.
- **Session/sandbox orchestration** via the `SandboxProvider` interface
  (E2BProvider) — create / resume / suspend / write-secrets / expose-port.
  See `sandbox-provider-interface.md` §6–7 for the exact flow.
- **WebSocket endpoint** (`/ws/{project_id}`) that (a) proxies chat to/from the
  in-sandbox `agent_runner`, and (b) streams project-state deltas to the viewer.
- **Viewer read API** — serve the latest `research.json` / `tree.gedcomx.json` /
  `results/<logId>.json` from durable storage (so the viewer works while the
  sandbox is suspended).
- **Sidecar image proxy** — `image_read` returns FamilySearch image bytes; the
  browser can't fetch FS directly (CSP/no token). Proxy through the server.
- Feedback intake (§11); cost controls (§13); observability (§14).

### 6.2 WebSocket protocol (browser ↔ control plane)
JSON messages. The control plane multiplexes chat (proxied to the sandbox) and
viewer deltas (from sync) over one socket:
```
client → server:  {type:"user_msg", text}            {type:"interrupt"}
server → client:  {type:"agent_event", event}        # streamed Agent SDK messages/tool-calls/thinking
                  {type:"research_updated", data}     # full or patch of research.json
                  {type:"gedcomx_updated", data}
                  {type:"sidecar_updated", logId, mtime}
                  {type:"status", state}              # sandbox: starting|ready|suspended|error
                  {type:"auth_required", provider:"familysearch"}
```

### 6.3 Database (Postgres) — minimum tables
- `users` (id, google_sub, email, created)
- `allowed_emails` (email) — the allowlist
- `familysearch_tokens` (user_id, access_enc, refresh_enc, expires_at)
- `projects` (id, user_id, sandbox_id, agent_session_id, objstore_prefix,
  title, created, updated, last_active) — **the user→sandbox map + project list**
- `sessions` (app login sessions) — or stateless JWT
- (optional) `usage` (user_id, tokens, sandbox_seconds) for cost controls

### 6.4 Durable project storage (object store)
- One prefix per project (`projects/<project_id>/`) holding `research.json`,
  `tree.gedcomx.json`, `results/<logId>.json`.
- `agent_runner` syncs the sandbox `/project` → object store on every change
  (decision #5 in the sandbox doc). The control plane reads from here for the
  viewer and can re-hydrate a fresh sandbox from it.

---

## 7. The agent runtime (inside the E2B sandbox)

Per `sandbox-provider-interface.md`. Key points for this spec:
- `agent_runner.py` runs the **Agent SDK**, loading the project's `.claude/skills`
  (the 28 skills) via `setting_sources=["project"], skills="all"`, and the
  genealogy **stdio MCP server** via `mcp_servers={genealogy: {command:"node",
  args:[build/index.js], env:{FAMILYSEARCH_ACCESS_TOKEN…}}}`.
- It exposes a WS server on a port; the control plane reaches it via E2B
  `get_host(port)` and proxies the browser socket.
- It restores conversation context with the Agent SDK's `resume=session_id`
  (we never depend on microVM memory snapshots).
- After each turn it pushes file deltas over WS **and** syncs `/project` to the
  object store.

### 7.1 Sandbox image (`apps/server` build target)
A template/image bundling: Node + Python + `claude-agent-sdk`, the genealogy MCP
`build/`, the 28 `.claude/skills/`, `agent_runner.py`. Built via E2B template
(`e2b.Dockerfile`). The engine package supplies the skills + MCP build at image
build time.

---

## 8. The web client

- **Layout:** two panes — **chat** (left, net-new) + **viewer** (right, shared
  `viewer-ui`). Plus the existing Sidebar/section nav and SidecarPanel.
- **Chat UI (net-new — neither repo has one):** message thread, streaming
  assistant output, tool-call/skill-invocation/progress rendering, interrupt,
  "connect FamilySearch" and "create project" affordances, the researcher-profile
  onboarding (§7.4 below). Renders the `agent_event` stream.
- **Viewer:** `viewer-ui` with the **WebSocket ResearchTransport**. Reads initial
  state from the read API, then live deltas over WS. Identical components to
  Electron.
- **Project selection** replaces "open folder": a project list (from `projects`)
  + "new project" flow.
- **Images:** display via the server's image proxy.

---

## 9. The Electron app (adapted)

- Renderer is replaced by an import of `viewer-ui` + an **IPC ResearchTransport**
  that wraps today's `window.api`. `main/`, `preload/`, watcher, sidecar reader,
  feedback bundling stay as-is.
- Net effect: the Electron app keeps working exactly as today, but its UI now
  comes from the shared package, so any viewer improvement lands in both. No chat
  in Electron (it remains the Cowork companion viewer).

---

## 10. Continued Cowork plugin + MCP `.mcpb`

- Unchanged in purpose. Built from `packages/engine` via the existing
  `scripts/build-mcpb.sh` (→ `genealogy-mcp.mcpb`) and `scripts/package-plugin.sh`
  (→ `genealogy-plugin.zip`). The packaging drift tests
  (`tests/packaging/*.test.ts`) continue to guard manifest/skill sync.
- The web product reuses this same engine; do **not** fork the skills or tools.

---

## 11. Data model, feedback, migration

- `research.json` sections (current): `project, researcher_profile, questions,
  plans, log, sources, assertions, person_evidence, conflicts, hypotheses,
  timelines, proof_summaries, evaluations`. `tree.gedcomx.json`: `persons,
  relationships, sources`. `results/<logId>.json` sidecars. The `schema` package
  is the single TS-types + JSON-Schema source for all consumers.
- **Schema versioning:** stamp a `schema_version`; the web/electron/cowork
  consumers and `validate_research_schema` must tolerate version skew (the schema
  package owns migration helpers).
- **Feedback:** the Electron flow bundles the local `~/.claude` session log; in
  the web app there is no local Claude session — the "session log" is the agent
  transcript held server-side / in the sandbox. Spec a web feedback endpoint that
  captures the server-side transcript + project files instead.

---

## 12. Sidecar services — productionize (currently broken for hosting)

> **Gap:** `wiki_search` and `place_population` call
> `https://malachi.taild68f1b.ts.net/...` — a **personal Tailscale domain**, not
> production. In a hosted product these two tools fail for end users.

Action: host `wiki-query-api` and the Pop-Stats API on production infra and point
`wikiApiUrl` / `popStatsUrl` at them (per-deployment config, not per-user).
`wiki_read`/`wiki_place_page` also read **pre-crawled markdown from disk**
(`wikiMarkdownDir`) — that corpus must be baked into the sandbox image or served.

---

## 13. Security, PII, cost

- **Isolation:** one E2B microVM per user (own guest kernel) — the reason E2B was
  chosen. One sandbox = one tenant; never share.
- **Secrets:** operator Anthropic key + per-user FS token are written into the
  sandbox as a secrets file on connect (not build-time env); never surfaced to
  the browser; rotate FS tokens via central refresh. Keep the Anthropic key out
  of user-readable space where feasible.
- **`validate_research_schema` path-traversal:** the tool takes a user-influenced
  `projectPath` and reads files — in multi-tenant it must be constrained to the
  user's project dir (no `..`/absolute escapes).
- **Data residency / retention (family PII):** confirm E2B's compliance posture
  for the **interim managed** phase (SOC2/HIPAA/DPA — currently unverified via
  `trust.e2b.dev`); the **self-hosted-E2B endgame** removes third-party custody.
  Publish a privacy policy; support project deletion (sandbox kill + object-store
  purge + token revoke).
- **Cost controls (operator-pays):** per-user token budgets + sandbox-second
  budgets; aggressive **idle suspension** (E2B pause) and auto-archive; rate
  limits; the allowlist already caps the blast radius for v1.

---

## 14. Observability, testing

- **Logging:** structured logs **without PII** (never log research/tree contents
  or FS records). Error tracking (Sentry-style) with PII scrubbing.
- **Testing:** keep the engine's existing eval harness (`eval/`) + packaging
  drift tests. Add: control-plane unit/integration tests, a transport-contract
  test shared by both ResearchTransport adapters, and an end-to-end
  "create→chat→file-delta→suspend→resume" test against a real E2B sandbox.

---

## 15. Suggested phasing

1. **Monorepo + `viewer-ui` extraction** (transport-agnostic) — Electron keeps
   working via the IPC adapter. (Lowest risk, unblocks sharing.)
2. **Control plane skeleton:** Google auth + allowlist, project/DB, E2BProvider,
   WS, read API, viewer over WS (read-only web viewer, no chat yet).
3. **Agent path:** `agent_runner` + sandbox image + FamilySearch web OAuth +
   token injection + chat UI → first end-to-end research session.
4. **Productionize:** sidecar services, image proxy, cost controls, feedback,
   privacy/retention, observability.
5. **Harden / endgame:** E2B compliance verification; later, self-hosted E2B for
   FamilySearch.

---

## 16. Decisions — RESOLVED for the POC (see §0.5)
- **Many** projects per user; **`session == project == sandbox`, 1:1**.
- **PII deferred** — POC only, users instructed to enter no living-person data;
  residency/retention/compliance out of scope for now.
- FamilySearch token injection = **(a) file on the sandbox FS** (no MCP change).
- Control plane hosted on **Dallan's local server, exposed via Tailscale Funnel**.
- Onboarding = **conversational** (`init-project` skill), not a custom form.
- **Still to confirm (not blocking):** FamilySearch dev-key supports the web
  redirect flow + a handful of external alpha users; Funnel is enabled for the two
  sidecar endpoints.

---

## 17. What the original list was missing (read this)
1. **Per-user FamilySearch OAuth** (web redirect + per-user token store + sandbox
   injection) — Google login ≠ FamilySearch auth; the product is inert without it.
2. **The control plane is NOT on E2B** — E2B runs per-user sandboxes; the
   always-on FastAPI/web/DB/object-store run on conventional infra.
3. **Per-user durable storage + a database** (object store for project files;
   Postgres for users/allowlist/tokens/sandbox-map/projects).
4. **Decouple viewer reads from the sandbox** — viewer serves from durable
   storage so it works while the sandbox is suspended.
5. **The chat UI is net-new** (streaming, tool/skill progress, interrupt,
   onboarding) — neither repo has one.
6. **MCP per-session token refactor** (today: one global token file, no per-request
   path).
7. **Sidecar services productionization** (`.ts.net` → prod) + the pre-crawled
   wiki markdown corpus.
8. **Operator-pays cost controls** (token + sandbox-second budgets, idle suspend).
9. **Secrets handling & rotation**; **`validate_research_schema` path-traversal**.
10. **Data residency / retention / privacy policy / deletion** for family PII.
11. **Image proxy** (FamilySearch images to the browser).
12. **Schema versioning** across web/electron/cowork; **web feedback** model
    (no local `~/.claude` session log).
13. **Project/onboarding model** (project creation, researcher profile, FS-person
    seeding) — `init-project` is a Cowork skill that needs a web equivalent.
