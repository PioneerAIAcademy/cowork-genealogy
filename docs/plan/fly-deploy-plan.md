# Fly.io deploy plan — hosted genealogy workbench (alpha)

**Date:** 2026-06-06. **Branch:** `hosted-web-workbench`. **Read with:**
`hosted-web-workbench-POC-status.md` (current state),
`sandbox-provider-interface.md` (E2B mapping). Artifacts: `deploy/Dockerfile`,
`deploy/fly.toml`.

This is the first hosted deploy of the POC. It replaces the local-server +
Tailscale-Funnel trick with a public Fly URL as the OAuth-redirect target and
browser ingress. E2B runs the per-user sandboxes (outbound from the container).
SQLite + the local backup dir stay; Postgres/S3 are later.

---

## Decisions (locked, do not relitigate in review)

- **ONE always-on container.** The FastAPI control plane serves BOTH the
  REST + `/ws` WebSocket API AND the built static web client (`apps/web/dist`)
  from the **same origin**. So the session cookie and the WebSocket both work
  with no CORS. Do **not** split client/server for alpha.
- **Always-on, not serverless.** The viewer + chat ride one long-lived `/ws`
  socket per session (`apps/web/src/transport/SessionConnection.ts`). A
  long-lived socket rules out Lambda/serverless for now, so this is a single
  always-on Fly Machine.
- **SQLite + local backup mirror on a Fly persistent volume.** One volume,
  mounted at `DATA_DIR`. Postgres + an object store come post-alpha.
- **E2B runs the sandboxes.** `SANDBOX_PROVIDER=e2b`; the container reaches E2B
  outbound. The agent does **not** run in this container.
- **Funnel is still needed for the sidecars the *sandbox* calls.** The public
  Fly URL covers the browser and OAuth redirects. But the E2B sandbox still
  reaches the wiki-query-api + pop-stats sidecars, which remain exposed via
  Tailscale Funnel (public ingress). That dependency is unchanged by this
  deploy. (Folding the sidecars behind a stable public host is a later task.)

---

## Architecture (one container, single origin)

```
Browser ──HTTPS──▶ Fly edge ──▶  [ always-on Machine: uvicorn :8000 ]
  REST  /api,/auth,/familysearch         FastAPI control plane (apps/server)
  WS    /ws/sessions/{id}                 ├─ StaticFiles mount → web-dist (apps/web/dist)
  static / (index.html, assets)           ├─ SQLite + backup mirror on /data (Fly volume)
                                          └─ SandboxProvider = E2BProvider ──outbound──▶ E2B
                                                                                  (per-user microVM:
                                                                                   agent_runner + MCP)
                                          sandbox ──outbound──▶ Funnel-exposed sidecars
                                                                (wiki-query-api, pop-stats)
```

Same origin means: the web client already builds every URL relative
(`fetch('/api/...')` in `apps/web/src/api.ts`; `new WebSocket(...location.host...)`
in `SessionConnection.ts`). Serving `dist` from the control plane therefore
needs **zero web-client changes** — the same relative URLs that the Vite dev
proxy fakes locally resolve to the control plane in prod.

---

## Server change required: serve `apps/web/dist`

`apps/server/app/main.py` currently mounts only API routers. Add a `StaticFiles`
mount as the **last** mount so it does not shadow the API routes. Small, concrete
addition:

```python
import os
from pathlib import Path
from fastapi.staticfiles import StaticFiles

# ... after the existing app.include_router(...) calls and /api/health ...

_web_dist = os.environ.get("WEB_DIST_DIR")
if _web_dist and Path(_web_dist).is_dir():
    # html=True serves index.html for "/" and as the SPA fallback for unknown
    # client-side routes. Mounted LAST so /api, /auth, /familysearch, /ws win.
    app.mount("/", StaticFiles(directory=_web_dist, html=True), name="web")
```

Notes for the reviewer:
- Guarded on `WEB_DIST_DIR` so local dev (Vite on :5173, no dist) is unaffected;
  the mount only activates when the env var points at a real directory (it does
  in the image — see the Dockerfile `ENV WEB_DIST_DIR`).
- With single-origin serving, the CORS middleware in `main.py` is effectively a
  no-op (no cross-origin requests). Leave it; it stays correct for local Vite dev.
- `DATA_DIR` is already read by `config.py` (`data_dir`); set it to the volume
  mount (`/data`) so the SQLite DB and backup mirror land on the volume.
  `config.py` should read `DATA_DIR` — confirm the `Settings.data_dir` field
  picks up the env var (it is a plain field; pydantic-settings maps `DATA_DIR`
  → `data_dir` by default). If not, add `validation_alias="DATA_DIR"` or rely
  on the default env-name mapping. **Reviewer: verify this one binding.**

---

## Prerequisites

- `flyctl` installed and `fly auth login` done.
- An E2B account + `E2B_API_KEY`, and the genealogy sandbox **template image
  built** (`make sandbox-image` / `apps/server/sandbox/build-image.sh`):
  Node + Python + `claude-agent-sdk` + the MCP `build/` + the 28 skills +
  `agent_runner` + the pre-crawled wiki markdown. The control-plane container
  does not run the agent, so the template is the gate on real turns, not this
  image. (`E2BProvider` itself is still a stub — see Caveats.)
- An Anthropic operator key (`ANTHROPIC_API_KEY`).
- A Google OAuth client (id + secret) and a FamilySearch web dev key, both
  registered against the public Fly hostname (see "OAuth redirect" below).
- The sidecars (wiki-query-api, pop-stats) reachable from E2B via Funnel.

---

## Env / secrets

Non-secret config ships in `deploy/fly.toml` `[env]`. Secrets go via
`fly secrets set` (never in the repo, never in `fly.toml`).

| Var | Where | Secret? | Notes |
|-----|-------|---------|-------|
| `SANDBOX_PROVIDER` | `[env]` | no | `e2b` |
| `AGENT_MODE` | `[env]` | no | `real` |
| `REALTIME` | `[env]` | no | `local_ws` for alpha (this container relays `/ws`); `ably` later |
| `PUBLIC_URL` | `[env]` | no | The public https URL; OAuth `redirect_uri` base + drives the `secure` cookie flag in `auth.py` |
| `FAMILYSEARCH_WEB_ENABLED` | `[env]` | no | `true` (disables FS dev-connect) |
| `DEFAULT_MODEL` | `[env]` | no | `claude-sonnet-4-6` |
| `DATA_DIR` | `[env]` | no | `/data` (the volume mount) |
| `WEB_DIST_DIR` | `[env]`/image | no | `/app/server/web-dist` (set in the Dockerfile) |
| `ALLOWED_EMAILS` | secret* | low | Comma-separated Gmail allowlist; `fly secrets set` keeps the tester list out of git |
| `E2B_API_KEY` | secret | yes | E2B account key |
| `ANTHROPIC_API_KEY` | secret | yes | Operator key (injected per sandbox) |
| `SESSION_SECRET` | secret | yes | Replaces the `dev-insecure-secret-change-me` default; signs the session cookie |
| `GOOGLE_CLIENT_ID` | secret | yes | Real Google OIDC (disables dev-login when set) |
| `GOOGLE_CLIENT_SECRET` | secret | yes | — |
| `ABLY_API_KEY` | secret | yes | Only when `REALTIME=ably`; unused at `local_ws` |

\* `ALLOWED_EMAILS` is not strictly a secret but is set via `fly secrets set` so
the alpha tester list is not committed.

```bash
fly secrets set \
  E2B_API_KEY=... \
  ANTHROPIC_API_KEY=... \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  ALLOWED_EMAILS="dallan@gmail.com,tester@example.com"
# ABLY_API_KEY only once REALTIME flips to "ably".
```

---

## Build & deploy steps

The Dockerfile build context is the **repo root** (it copies `pnpm-workspace.yaml`,
`packages/*`, `apps/web`, `apps/server`). Run `fly` with the deploy config and
the repo-root context:

```bash
# 1. First time only: create the app (no deploy yet) and the volume.
fly launch --no-deploy --copy-config --name genealogy-workbench \
  --config deploy/fly.toml --dockerfile deploy/Dockerfile
fly volumes create workbench_data --region iad --size 1   # matches [mounts].source

# 2. Set secrets (see above).

# 3. Deploy (build context = repo root, config + Dockerfile under deploy/).
fly deploy --config deploy/fly.toml --dockerfile deploy/Dockerfile .
```

Local sanity-check of the image before deploying:

```bash
pnpm --filter web build              # confirm dist builds in the workspace
docker build -f deploy/Dockerfile -t workbench .   # confirm the multi-stage build
```

---

## Volume

- One volume `workbench_data`, size 1 GB to start (SQLite + JSON backups are
  small; alpha is a handful of users). Mounted at `/data` (= `DATA_DIR`).
- `config.py` derives `workbench.db`, `sandboxes/`, and `backup/` under
  `DATA_DIR`. On a fresh volume those dirs are created on boot (`get_settings()`
  mkdirs them) and `init_db()` creates the SQLite schema.
- The `sandboxes/` dir under `DATA_DIR` is only used by `LocalProvider`; under
  `SANDBOX_PROVIDER=e2b` the project filesystem lives in the E2B microVM, and
  the volume holds only the DB + the backup mirror.

---

## OAuth-redirect registration

`PUBLIC_URL` is the redirect base. Register these exact callbacks:

- **Google:** authorized redirect URI `https://<public-host>/auth/google/callback`.
- **FamilySearch:** redirect `https://<public-host>/familysearch/callback`
  (matches the message `auth/familysearch` already prints), and confirm the FS
  key allows the alpha testers + the web redirect flow.

Set `PUBLIC_URL` to the same `https://<public-host>` (the Fly-assigned
`*.fly.dev` host, or a custom domain once mapped). `auth.py` sets the session
cookie `secure` flag from `PUBLIC_URL.startswith("https")`, so a correct
`PUBLIC_URL` is what makes the cookie sticky over HTTPS.

---

## Horizontal-scaling caveat

A **single volume binds the app to a single Machine.** `auto_stop_machines` is
off and `min_machines_running = 1` in `fly.toml` so the one always-on Machine
never sleeps under a live socket. Do **not** `fly scale count > 1` while on
SQLite-on-a-volume: a second Machine cannot share the volume, and the `/ws`
relay + idle-suspend loop assume one writer of the DB. Horizontal scale waits
for: (1) Postgres replacing SQLite, and (2) `REALTIME=ably` so `/ws` is no
longer pinned to this process. Both are post-alpha (POC status §"What you need
to provision").

---

## Smoke-test checklist (after deploy)

1. `fly status` — one Machine, `started`; volume attached.
2. `curl https://<host>/api/health` → `{"ok":true,"agentMode":"real","provider":"e2b","realtime":"local_ws"}`.
3. `https://<host>/` loads the web client (StaticFiles mount serving `dist`).
4. Google sign-in completes and returns to the app (redirect URI matches; cookie
   set with `secure`). A non-allowlisted email is rejected.
5. Create a session → viewer renders; the `/ws` socket connects (no CORS error
   in the console, `wss://<host>/ws/sessions/{id}` upgrades).
6. Send a chat message → an E2B sandbox is created, the real agent runs a turn,
   tool-call chips stream, and `research.json` writes show up live in the viewer.
7. **Connect FamilySearch** → FS OAuth round-trips through
   `/familysearch/callback`; a token lands in the sandbox's
   `~/.familysearch-mcp/tokens.json`; an authenticated tool (e.g. a record
   search) succeeds — confirms the sandbox can reach FS **and** the Funnel
   sidecars.
8. Reopen the session after idle → resumes (DB persisted on the volume; sandbox
   resumes or re-creates).
9. `fly machine restart` (or redeploy) → after boot, the session list and DB are
   intact (volume persistence).

---

## Out of scope for this deploy

Postgres/S3; `REALTIME=ably` cutover; custom domain; PII/compliance hardening
(FS tokens still unencrypted per POC §13); folding the sidecars off Funnel onto
a stable public host. All tracked in POC status.
