# Fly.io deploy plan — hosted genealogy workbench (alpha)

**Date:** 2026-06-06. **Branch:** `hosted-web-workbench`. **Read with:**
`realtime-rearch-status.md` (current state),
`sandbox-provider-interface.md` (E2B mapping). Artifacts: `deploy/Dockerfile`,
`deploy/fly.toml`.

This is the first hosted deploy of the POC. It replaces the local-server +
Tailscale-Funnel trick with a public Fly URL as the OAuth-redirect target and
browser ingress. E2B runs the per-user sandboxes (outbound from the container).

> **Status (2026-06-08): partially shipped + amended. Read the deltas before
> following the body below.** Since this plan was written, three things landed on
> `main` that change it:
> - **DB is Neon Postgres, not SQLite-on-a-volume.** The `neon-postgres-plan.md`
>   migration (#296) made the backend env-driven via `DATABASE_URL`. **There is no
>   Fly volume** — the `[mounts]` block is gone from `deploy/fly.toml`, and the
>   "SQLite + Fly volume" Decision, the **Volume** section, and the
>   `fly volumes create` step below are **superseded**. `DATABASE_URL` (a secret)
>   is now required; `WS_SIGNING_KEY` is too (per-sandbox WS tokens). The
>   authoritative deploy procedure is **DEVELOPMENT.md § "Deploy to Fly.io"**.
> - **`REALTIME` is gone.** The realtime path is the in-sandbox WS server the
>   browser connects to directly (`/connect`); `config.py` has no `realtime`
>   field, so the `REALTIME=local_ws` env was dead and has been removed from
>   `fly.toml`. Ably was dropped (`ably-realtime-migration.md`). The
>   "Architecture" / smoke-test mentions of a `/ws` relay on this container are
>   historical.
> - **The code is already committed.** The "Server change required" (StaticFiles
>   mount) is done (`main.py`), `deploy/Dockerfile` + `deploy/fly.toml` exist, and
>   `E2BProvider` is fully implemented (not the stub the Caveats imply). What
>   remains is operational: create the app, set secrets, register the FS redirect,
>   build the E2B template image, deploy.

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
- ~~**SQLite + local backup mirror on a Fly persistent volume.**~~ **Superseded
  by `neon-postgres-plan.md` (#296):** the DB is Neon Postgres via the
  `DATABASE_URL` secret; there is **no Fly volume**. An object store is still
  post-alpha.
- **E2B runs the sandboxes.** `SANDBOX_PROVIDER=e2b`; the container reaches E2B
  outbound. The agent does **not** run in this container.
- **Funnel is still needed for the sidecars the *sandbox* calls.** The public
  Fly URL covers the browser and OAuth redirects. But the E2B sandbox still
  reaches the wiki-query-api + pop-stats sidecars, which remain exposed via
  Tailscale Funnel (public ingress). That dependency is unchanged by this
  deploy. (Folding the sidecars behind a stable public host is a later task.)
- **Single FamilySearch login (no Google).** One FS OAuth round-trip at the front
  door both gates app access (email allowlist) and yields the data token injected
  into every sandbox at create — see
  [`familysearch-login-plan.md`](./familysearch-login-plan.md). The only new
  hosted-side dependency is registering `https://<public-host>/callback` with
  FamilySearch (below); Google's client/secret/consent-screen are gone.

---

## Architecture (one container, single origin)

```
Browser ──HTTPS──▶ Fly edge ──▶  [ always-on Machine: uvicorn :8000 ]
  REST  /api,/auth,/callback             FastAPI control plane (apps/server)
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
- A FamilySearch web dev key whose **redirect URI is registered against the
  public Fly hostname** as `https://<public-host>/callback` (see "OAuth redirect"
  below). FamilySearch is the **single app login** — there is no Google client.
  The client id itself comes from the bundled
  `packages/engine/mcp-server/config/familysearch.json`, not a secret; only the
  redirect registration is new for the hosted host.
- The sidecars (wiki-query-api, pop-stats) reachable from E2B via Funnel.

---

## Env / secrets

Non-secret config ships in `deploy/fly.toml` `[env]`. Secrets go via
`fly secrets set` (never in the repo, never in `fly.toml`).

| Var | Where | Secret? | Notes |
|-----|-------|---------|-------|
| `SANDBOX_PROVIDER` | `[env]` | no | `e2b` |
| `AGENT_MODE` | `[env]` | no | `real` |
| `REALTIME` | `[env]` | no | `local_ws` for alpha (this container relays `/ws`); `sandbox_ws` (relay moves into the sandbox) later |
| `PUBLIC_URL` | `[env]` | no | The public https URL; FS `redirect_uri` base (`{PUBLIC_URL}/callback`) + drives the `secure` cookie flag in `auth.py` |
| `FAMILYSEARCH_WEB_ENABLED` | `[env]` | no | `true` — makes FamilySearch the **sole app login** (disables the dev-login fallback) |
| `DEFAULT_MODEL` | `[env]` | no | `claude-sonnet-4-6` |
| `DATA_DIR` | `[env]` | no | `/data` (the volume mount) |
| `WEB_DIST_DIR` | `[env]`/image | no | `/app/server/web-dist` (set in the Dockerfile) |
| `ALLOWED_EMAILS` | secret* | low | Comma-separated allowlist matched against the **FamilySearch-account** email from `/users/current` (NOT a person's Google/contact email — Dallan's is `dallan@quass.org`). `fly secrets set` keeps the tester list out of git |
| `E2B_API_KEY` | secret | yes | E2B account key |
| `ANTHROPIC_API_KEY` | secret | yes | Operator key (injected per sandbox) |
| `SESSION_SECRET` | secret | yes | Replaces the `dev-insecure-secret-change-me` default; signs the session cookie |

\* `ALLOWED_EMAILS` is not strictly a secret but is set via `fly secrets set` so
the alpha tester list is not committed. **Use each tester's FamilySearch-account
email** — that is what the allowlist gate compares against at login.

```bash
# DATABASE_URL + WS_SIGNING_KEY are required now (Neon migration + per-sandbox WS
# tokens); they were not in this plan's original table. DATABASE_URL is the Neon
# DIRECT (non-pooler) URL. See neon-postgres-plan.md and DEVELOPMENT.md § Deploy.
fly secrets set \
  E2B_API_KEY=... \
  ANTHROPIC_API_KEY=... \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  WS_SIGNING_KEY="$(openssl rand -hex 32)" \
  DATABASE_URL="postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/DBNAME?sslmode=require" \
  ALLOWED_EMAILS="dallan@quass.org"
```

---

## Build & deploy steps

The Dockerfile build context is the **repo root** (it copies `pnpm-workspace.yaml`,
`packages/*`, `apps/web`, `apps/server`). Run `fly` with the deploy config and
the repo-root context:

```bash
# 1. First time only: create the app (no deploy yet). NO volume — the DB is on
#    Neon (neon-postgres-plan.md); the old `fly volumes create workbench_data`
#    step is removed.
fly launch --no-deploy --copy-config --name genealogy-workbench \
  --config deploy/fly.toml --dockerfile deploy/Dockerfile

# 2. Set secrets (see above) — including DATABASE_URL + WS_SIGNING_KEY.

# 3. Deploy (build context = repo root, config + Dockerfile under deploy/).
#    --ha=false: fly deploy provisions TWO machines by default; we must stay at
#    count = 1 until init_db moves to a release_command (see Horizontal-scaling).
fly deploy --config deploy/fly.toml --dockerfile deploy/Dockerfile . --ha=false
```

Local sanity-check of the image before deploying:

```bash
pnpm --filter web build              # confirm dist builds in the workspace
docker build -f deploy/Dockerfile -t workbench .   # confirm the multi-stage build
```

---

## Volume — **superseded (no volume)**

`neon-postgres-plan.md` (#296) moved the DB to Neon Postgres and removed the
`[mounts]` block, so **there is no Fly volume**. `DATA_DIR` is still set (to
`/data`) because `get_settings()` mkdirs a work dir there, but nothing persistent
lives on it — the DB is on Neon and feedback + the viewer mirror are off-disk. If
a `workbench_data` volume lingers from a pre-Neon deploy, destroy it after a clean
deploy: `fly volumes destroy workbench_data`.

---

## OAuth-redirect registration

`PUBLIC_URL` is the redirect base. There is exactly **one** OAuth callback to
register (FamilySearch is the single front door; Google is gone):

- **FamilySearch:** redirect URI `https://<public-host>/callback` — top-level,
  **not** `/familysearch/callback`. This must match byte-for-byte what the server
  sends: `auth.py`'s login route builds `redirect_uri = {PUBLIC_URL}/callback`
  (`fs_oauth.redirect_uri()`) and the callback handler is mounted at top-level
  `/callback` (`auth.callback_router`). Confirm the FS key also allows the alpha
  testers' accounts.

This is the new endpoint to add on the FamilySearch side for the hosted host;
locally the same flow rides the already-registered desktop loopback
`http://127.0.0.1:1837/callback`, so only the host/scheme differ in prod.

Set `PUBLIC_URL` to the same `https://<public-host>` (the Fly-assigned
`*.fly.dev` host, or a custom domain once mapped). `auth.py` sets the session
cookie `secure` flag from `PUBLIC_URL.startswith("https")`, so a correct
`PUBLIC_URL` is what makes the cookie sticky over HTTPS. The session cookie is
host-only (no `domain`), which is fine here because the single-origin container
serves the client and API from the same `<public-host>`.

---

## Horizontal-scaling caveat

A **single volume binds the app to a single Machine.** `auto_stop_machines` is
off and `min_machines_running = 1` in `fly.toml` so the one always-on Machine
never sleeps under a live socket. Do **not** `fly scale count > 1` while on
SQLite-on-a-volume: a second Machine cannot share the volume, and the `/ws`
relay + idle-suspend loop assume one writer of the DB. Horizontal scale waits
for: (1) Postgres replacing SQLite (`neon-postgres-plan.md`), and (2) removing
the per-session `LiveSession` pin. The fix is to make **the sandbox the
per-session server** (`ably-realtime-migration.md`): today's relay (the agent
`Process` + `/project` watch + pump) moves *into* the sandbox, which exposes one
authenticated WSS the browser connects to directly, leaving the control plane
affinity-free. Ably is dropped (it would unpin only the *fanout*, not the
*session*).

> **Production target is AWS behind a standard load balancer with no sticky
> routing** (IT will not allow stickiness). This single-Machine Fly shape is the
> **alpha** posture; the affinity-free design (sandbox-as-server) is what both
> satisfies AWS-no-sticky and unblocks `fly scale count > 1`.

---

## Smoke-test checklist (after deploy)

1. `fly status` — one Machine, `started`; volume attached.
2. `curl https://<host>/api/health` → `{"ok":true,"agentMode":"real","provider":"e2b","db":"postgres"}`
   (the health payload reports `db`, not `realtime` — that field was removed).
3. `https://<host>/` loads the web client (StaticFiles mount serving `dist`).
4. **Sign in with FamilySearch** completes and returns to the app: the FS OAuth
   round-trip lands on `/callback` (redirect URI matches), the allowlist check
   passes on the FS-account email, and the session cookie is set with `secure`.
   A FamilySearch account whose email is **not** on the allowlist is rejected
   (403), with no user row and no token persisted.
5. Create a session → viewer renders; the `/ws` socket connects (no CORS error
   in the console, `wss://<host>/ws/sessions/{id}` upgrades). The token from
   step 4 is injected into the new sandbox at `~/.familysearch-mcp/tokens.json`
   (no per-session connect step — login already supplied it).
6. Send a chat message → an E2B sandbox is created, the real agent runs a turn,
   tool-call chips stream, and `research.json` writes show up live in the viewer.
7. An **authenticated FamilySearch tool** runs inside the sandbox (e.g. ask for
   ancestors with no id → `/users/current`, or a record search) and succeeds —
   confirms the injected token works **and** the sandbox can reach FS + the
   Funnel sidecars. (If it 401s, the injected access token's refresh succeeded
   in-sandbox via `getValidToken()`.)
8. Reopen the session after idle → resumes (DB persisted on Neon; sandbox
   resumes or re-creates).
9. `fly machine restart` (or redeploy) → after boot, the session list and DB are
   intact (Neon persistence — no volume).

---

## Out of scope for this deploy

Postgres/S3; `REALTIME=sandbox_ws` cutover; custom domain; PII/compliance hardening
(FS tokens still unencrypted per POC §13); folding the sidecars off Funnel onto
a stable public host. All tracked in POC status.
