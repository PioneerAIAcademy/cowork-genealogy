# Development

Developer guide for building, testing, and extending this repository.
For architecture and conventions Claude needs when editing the code,
see [CLAUDE.md](./CLAUDE.md). For end-user installation and usage, see
[README.md](./README.md). For contribution criteria, see
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Build commands

```bash
cd packages/engine/mcp-server && npm install && npm run build       # Build MCP server
./scripts/test.sh                                    # Run ALL test suites (see below)
cd packages/engine/mcp-server && npm test                            # Run MCP server tests only (vitest)
cd packages/engine/mcp-server && npx vitest run tests/tools/places.test.ts   # Run a single test file
cd packages/engine/mcp-server && npx vitest run -t "test name"       # Run tests matching a name
./scripts/build-mcpb.sh                              # Package .mcpb extension (→ releases/)
./scripts/verify-mcpb.sh                             # Verify the packed .mcpb (contents + boots)
./scripts/package-plugin.sh                          # Package plugin .zip (→ releases/)
```

After building, both artifacts land in `releases/`:

```bash
ls releases/
```

## Git hooks

Run `make install-hooks` once per clone (opt-in, per-clone) to symlink our
shared hooks: `post-checkout` auto-links shared files into new worktrees, and
`commit-msg` warns (never blocks) when a commit lacks a **human**
`Co-authored-by:` trailer. When you pair, credit the other contributor so it
survives our squash-merges — `Co-authored-by: Their Name <their-github-email>`
as the last line of the commit message. Claude/AI co-authors don't satisfy the
check.

## Smoke-test tools against live APIs

Bypass the MCP harness to debug a tool in isolation:

```bash
cd packages/engine/mcp-server && npx tsx dev/try-wikipedia.ts "Albert Einstein"
cd packages/engine/mcp-server && npx tsx dev/try-place-search.ts "Ohio"
cd packages/engine/mcp-server && npx tsx dev/try-wiki-search.ts "How do I find Italian birth records?"
cd packages/engine/mcp-server && npx tsx dev/try-population.ts 1927069 --year 1960
cd packages/engine/mcp-server && npx tsx dev/try-record-search.ts Lincoln Abraham --birth-year 1809
cd packages/engine/mcp-server && npx tsx dev/try-fulltext-search.ts "+Patrick +Flynn" --place Pennsylvania
cd packages/engine/mcp-server && npx tsx dev/try-fulltext-search.ts --nl "Search for John Doe born in Austria"
```

The `wiki-query-api` and Pop Stats API services are hosted; the smoke
scripts hit them over the public network, no local setup needed.

## How to add a new feature

Example: adding a "list providers" feature.

1. **Add the tool to the MCP server.**
   - Create `packages/engine/mcp-server/src/tools/list-providers.ts`
   - Add its schema to `allToolSchemas` in `packages/engine/mcp-server/src/tool-schemas.ts`
     and its dispatch case to the `CallTool` handler in
     `packages/engine/mcp-server/src/index.ts`
   - Add its name to `tools` in `packages/engine/mcp-server/manifest.json` — the packaging
     test (`tests/packaging/manifest.test.ts`) fails if the manifest and
     the registry drift apart
   - Run `npm run build` in `packages/engine/mcp-server/`
   - Create `packages/engine/mcp-server/dev/try-list-providers.ts` — a one-shot smoke
     script that invokes the tool directly against live APIs. Follows
     the pattern of `try-wikipedia.ts` / `try-place-search.ts`. Critical for
     debugging when the MCP harness hides real errors.

2. **Add or update a skill that uses it.**
   - Create `packages/engine/plugin/skills/list-providers/SKILL.md`
   - In the SKILL.md, instruct Claude to call the new tool when the
     user asks what providers are available

3. **Rebuild both artifacts.**
   ```bash
   cd packages/engine/mcp-server && npm run build && cd ../../..
   ./scripts/build-mcpb.sh
   ./scripts/package-plugin.sh
   ```

4. **Manually test by installing both artifacts in Claude Desktop.**

The `mcp-tool-scaffolder` and `cowork-skill-builder` subagents (under
`.claude/agents/`) generate the boilerplate for steps 1 and 2.
`spec-review` checks the implementation against the spec before PR.

## How to test a new tool end-to-end

For non-trivial tools, write a testing guide at
`docs/testing-guides/<tool>-tool-testing-guide.md` modeled on
`docs/testing-guides/oauth-tool-testing-guide.md` and
`docs/testing-guides/wikipedia-tool-testing-guide.md`. Four layers:

1. **MCP Inspector** — verifies the tool registers and behaves with
   no/dummy/real input.
2. **Claude Code** — verifies the tool description is good enough that
   the LLM picks it from natural language.
3. **Cowork via WSL2** — verifies the WSL2 → Claude Desktop bridge.
4. **Cowork via native Windows** — verifies the install path real
   users will take.

Both Layer 3 sub-layers are required for ship-readiness regardless of
which is your dev environment.

After building and installing both artifacts in Claude Desktop,
exercise the tool from inside a Cowork session — for example, ask
Claude to look up a place: "Find FamilySearch info for Ohio." Claude
should call the `place_search` tool, get structured JSON back, and — if a
skill tells it to — write a file to the selected folder. If that
round-trip works, the full pipeline is wired: host → MCP server → SDK
bridge → VM → Claude → file write.

The `search-wikipedia` skill in `packages/engine/plugin/` is a working reference
example showing the full plugin pipeline — it calls the
`wikipedia_search` MCP tool, populates a markdown template, and saves
the result to a file. Copy this structure when wiring a new skill to
one of the other tools. Don't mutate `search-wikipedia` itself; create a
new skill folder.

## Running the hosted web workbench locally

The hosted web product is two processes — the **FastAPI control plane**
(`apps/server/`) and the **Vite web client** (`apps/web/`) — run one of
each in two terminals. The four control-plane targets differ along three
axes (sandbox provider, agent, login); the web client must point at the
server's **port**:

| `make` target | Sandboxes | Agent | Login | Port | Pair web with |
|---|---|---|---|---|---|
| `server` (default) | local | **real** SDK | **real FamilySearch** | 1837 | `web` |
| `server-e2b` | **E2B** | real | real FamilySearch | 1837 | `web` |
| `server-dev` | local | **real** SDK | dev-login | 8000 | `web-dev` |
| `server-mock` | local | **mock** | dev-login | 8000 | `web-dev` |

The default `make server` is the **realistic** path — real agent + the real
FamilySearch front-door login, so every tool that needs FS auth works. The
other targets trade realism for less setup:

- **`server`** (+ `web`) — **the default.** Real Claude Agent SDK + real
  FamilySearch OAuth on :1837 (`FAMILYSEARCH_WEB_ENABLED=true`; client id from
  the bundled config; `ANTHROPIC_API_KEY` from your env, falling back to the
  sibling repo's `../cowork-genealogy-ui/.env`). Local sandboxes.
- **`server-e2b`** (+ `web`) — the full hosted path: identical to `server` but
  **E2B microVM** sandboxes (`SANDBOX_PROVIDER=e2b`).
- **`server-dev`** (+ `web-dev`) — real agent but **dev-login** (no
  FamilySearch) on :8000. The cheapest real-agent path — Anthropic key only, no
  FS dev key. FS tools won't authenticate; use it for agent/UI iteration that
  doesn't need FS.
- **`server-mock`** (+ `web-dev`) — **zero setup, no keys**: scripted mock
  agent + dev-login on :8000. The fast path for pure UI work.

**The rule that bites:** the web target must match the server's port.
`web` proxies `/api` + WS to `:1837` (pairs with `server` / `server-e2b`);
`web-dev` proxies to `:8000` (pairs with `server-dev` / `server-mock`). Run the
wrong one and the page loads but every API/WebSocket call hits a dead
proxy target. Then open http://127.0.0.1:5173.

**Prerequisites are automatic.** These targets build/install what they
need via Make (no manual `npm install` / `npm run build`):

- `server` and `server-dev` build the genealogy engine first —
  the real agent forks `node packages/engine/mcp-server/build/index.js`.
  `server-e2b` does **not**: the `genealogy-agent` E2B image bakes its
  own engine, so after changing in-sandbox code
  (`apps/server/app/sandbox_server.py` or `app/agent/*`) rebuild the
  image with `make sandbox-image` or the microVM runs stale code.
- `server-e2b` first runs an internal `e2b-preflight` guard (required
  keys present + the stale-image reminder) — a prerequisite, not a
  target you invoke.
- First-time setup for everything: `make install`.

### Operator / alpha tools (`?alpha=1`)

The web client hides operator-only affordances behind a sticky **alpha flag**,
off by default so end users never see them. Turn it on by appending `?alpha=1`
to the URL once — it persists in `localStorage`, so you can then drop it:

```
http://127.0.0.1:5173/?alpha=1
```

It also works appended to a session URL (before or after the `#/s/:id` hash).
With it on, an open session shows, in the chat header:

- a **running cost meter** — per-turn `$` summed from the agent's `usage`
  events; real cost under `server-dev`, a marked `~` synthetic estimate under
  the mock agent (`server-mock`). This is the operator/sponsor signal for estimating
  spend at scale.
- the **Logs** button — tails the in-sandbox `/tmp/ws.log` + `/tmp/agent.log`.

Turn it off by clicking the `ALPHA` tag in the header, or with `?alpha=0`. The
flag is intentionally easy to remove after the alpha test.

## Public `/v1` REST API (hosted control plane)

The hosted web control plane (`apps/server/`, FastAPI / Python / uv —
**separate from the engine**) exposes a dedicated, versioned,
**bearer-only** REST surface at `/v1` so an external chatbot client can
drive sessions over plain HTTP — no browser cookie, no WebSocket.
Source: `apps/server/app/v1.py`. Design + spec:
[`docs/plan/public-rest-api.md`](./docs/plan/public-rest-api.md).

Endpoints (all require `Authorization: Bearer <key>`):

- `POST /v1/sessions` → create. Optional body `{title?, familysearch_token?}`. Supply
  `familysearch_token` (`{access_token, refresh_token?, expires_in?}`) to authenticate the
  sandbox's FamilySearch tool calls — it's injected into the sandbox's `tokens.json` and is
  **never** persisted to the DB; with a refresh token the in-sandbox `getValidToken()`
  self-refreshes for the sandbox's life. Omit it for an FS-tool-less session. Returns
  `{session_id, title, model, created_at}`.
- `POST /v1/sessions/{id}/messages` → send a message. Body `{message, stream?}`:
  sync JSON when `stream` is false/omitted, **Server-Sent Events** when `true`. The sync reply
  is `{session_id, role:"assistant", text, tool_calls, finish_reason, error?}`; the SSE stream
  emits `delta` (text), `tool`, and `error` frames, a final `done` frame, and `: keep-alive`
  heartbeats between.
- `DELETE /v1/sessions/{id}` → release the sandbox.

Every error uses one envelope: `{"error": {"code": "...", "message": "..."}}`
(codes: `unauthorized` 401, `session_not_found` 404, `session_busy` 409,
`validation_error` 422, `turn_timeout` 504, `internal_error` 500).

### Configuring API keys (`API_KEYS`)

Access is granted by `API_KEYS` — a comma-separated list of `key:email`
pairs (env var; parsed by `Settings.api_key_map`). A request's bearer
token is constant-time-compared against each key; on a match it resolves
to the paired **email**, which maps to the same `User` row the browser
path would create. Empty (the default) → the `/v1` surface is closed
(every request `401`s).

```bash
API_KEYS="sk_live_<random>:genealogy-chatbot@yourco.com"
```

- **The key** is the secret the client presents. Generate a strong random value:
  ```bash
  python -c "import secrets; print('sk_live_' + secrets.token_urlsafe(32))"
  ```
  The `sk_` prefix is convention; the format is arbitrary (compared verbatim).
- **The email** is only an identity label. It does **not** need to be a
  real mailbox and does **not** need to be on the `ALLOWED_EMAILS`
  allowlist — API keys are operator-granted (presence in `API_KEYS` *is*
  the grant; the allowlist gates self-service FamilySearch / dev login only).
- **In production, set it as a Fly _secret_** (it's a credential, like
  `DATABASE_URL`) — not in `fly.toml` `[env]`:
  ```bash
  fly secrets set API_KEYS="sk_live_…:genealogy-chatbot@yourco.com"
  ```

**One client, many end-users → one key.** If a single chatbot server
creates and drives sessions on behalf of many of *its own* end-users, use
**exactly one** `key:email` pair. All those sessions are owned by that one
`User`, so anything created with the key can be read/messaged with the key.
That is correct for this model (the chatbot server holds the key
server-to-server; its end-users never see it) — but it means **isolating
one end-user's sessions from another's is the chatbot's responsibility**:
it must track which `session_id` belongs to which of its users and never
hand a `session_id` to the wrong one. Our `session_id`s are 64-bit random
(unguessable — defense-in-depth) but within a single key they are **not**
an authorization boundary.

Use **distinct** `key:email` pairs (distinct emails) only when there are
genuinely **separate clients** you want isolated from each other — then the
ownership check (`_owned`) returns `404` across them automatically.

### Other `/v1` knobs

Pydantic settings are env-driven and case-insensitive (`API_KEYS` →
`api_keys`, etc.):

| Env var | Default | Purpose |
|---|---|---|
| `API_KEYS` | `""` | `key:email` pairs — the bearer-key registry (above). |
| `V1_TURN_TIMEOUT_SECONDS` | `120` | Sync (`stream:false`) turn cap → `504 turn_timeout`. Streaming has no hard cap (heartbeats instead); steer long turns to `stream:true`. |
| `V1_TURN_LOCK_STALE_SECONDS` | `600` | One turn at a time per session, via a DB-backed lock on `Project.turn_locked_at` (correct across horizontally-scaled instances). A lock older than this is reclaimed, so a crashed instance can't wedge a session. Must exceed the longest expected turn. |

### Run + smoke-test locally

Runs fully on mocks — no E2B / Anthropic / OAuth (first time: `make install`):

```bash
# terminal 1 — control plane on :8000 with one dev key
API_KEYS="sk_dev:bot@example.com" make server-mock

# terminal 2 — exercise it. NOTE the explicit JSON content-type: `curl -d`
# defaults to form-encoding, which would fail validation with a 422.
K="Authorization: Bearer sk_dev"; J="Content-Type: application/json"
SID=$(curl -s -H "$K" -H "$J" -XPOST localhost:8000/v1/sessions -d '{"title":"t"}' | jq -r .session_id)
curl -s  -H "$K" -H "$J" -XPOST localhost:8000/v1/sessions/$SID/messages -d '{"message":"hello"}' | jq           # sync JSON
curl -sN -H "$K" -H "$J" -XPOST localhost:8000/v1/sessions/$SID/messages -d '{"message":"hello","stream":true}'  # SSE
curl -s  -H "$K" -H "$J" -XDELETE localhost:8000/v1/sessions/$SID | jq
```

Send a second message that references the first to confirm cross-turn
memory — the agent process stays up between turns as long as you reuse the
`session_id`.

### Tests

```bash
cd apps/server && uv run pytest -q       # or: make server-test
```

`tests/test_v1_api.py` covers auth + error envelopes, sync, SSE (incl.
`tool` frames), `504` timeout, `409 session_busy`, stale-lock reclamation,
cross-client isolation, and delete — all on mocks.

## Database backends & deploying to Fly.io

The control plane picks its database from a single env var, **`DATABASE_URL`**:

- **Unset → SQLite** under `DATA_DIR` (`.workbench-data/workbench.db`) — the
  zero-setup local default. `make server*` and the test suite use this.
- **Set → Postgres** (Neon in production, supplied as a Fly secret).
  `config.sqlalchemy_url` normalizes Neon's `postgres://`/`postgresql://` to the
  `psycopg3` driver.

The schema is pure SQLModel: `init_db()` runs `create_all()` on boot (no Alembic)
and re-seeds the allowlist from `ALLOWED_EMAILS`. There is **no data migration**
between backends — switching `DATABASE_URL` just starts a fresh schema.
`/api/health` reports the live backend (`{"db":"sqlite"|"postgres", …}`). The
test suite always runs on SQLite (`conftest` forces `DATABASE_URL=""`). Because
`create_all()` never ALTERs an existing table, a local SQLModel change can leave the
SQLite schema stale (500s like "no such column") — run `make db-reset` to wipe
`.workbench-data/` (Neon/prod untouched), then restart the server to rebuild it.

### Test the Postgres / Neon path locally (before deploying)

`make server-test` only exercises SQLite, so validate Postgres by **booting the
server against a real Postgres and exercising it**. Two ways:

Prefix any control-plane target with `DATABASE_URL=…` — `make server-mock` then runs
mock + local + **dev-login** against that Postgres (it pins those dev values so a
`.env` kept for the server/e2b real-FamilySearch targets doesn't leak in). Pair with `make web-dev` and
sign in with any email (dev-login is allowlist-free locally) — that write lands in
Postgres. Do **not** use a bare `uv run uvicorn …`: it inherits `.env`, so a real
`FAMILYSEARCH_WEB_ENABLED=true` there forces the FamilySearch front door (whose
redirect is registered for `:1837`, not `:8000`) and disables dev-login.

**A — throwaway Docker Postgres (offline, no account):**
```bash
docker run -d --name wb-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16-alpine
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/postgres" make server-mock   # + make web-dev
# → another terminal:
curl -s localhost:8000/api/health | jq          # expect "db":"postgres", "provider":"local"
docker exec wb-pg psql -U postgres -tAc "\dt"   # 4 tables created by create_all()
#   …dev-login at http://127.0.0.1:5173 and create/delete a session.
docker rm -f wb-pg                               # teardown
```
(`psycopg[binary]` is already in `uv.lock`, so no local libpq is needed.)

**B — a real Neon dev database (also validates SSL + the real URL):**
1. Create a free project at neon.tech (region near `iad`); pick/create a database.
2. Copy the **direct** connection string — the host **without** `-pooler` (it
   already ends with `?sslmode=require`). The pooler endpoint is intentionally
   avoided; see `docs/plan/neon-postgres-plan.md`.
3. Boot against it (mock + local + dev-login):
   ```bash
   DATABASE_URL="postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/DBNAME?sslmode=require" make server-mock
   # + make web-dev
   ```
4. `curl localhost:8000/api/health` → `"db":"postgres"`; dev-login at
   http://127.0.0.1:5173 and create/delete a session; inspect tables in the Neon
   SQL editor. The first request after idle resumes Neon from scale-to-zero (a few
   hundred ms–seconds) — expected.

### Deploy to Fly.io

One always-on container (`count = 1`) serves the REST + WebSocket API and the
built web client from a single origin. Full procedure in
[`docs/plan/fly-deploy-plan.md`](./docs/plan/fly-deploy-plan.md) +
[`docs/plan/neon-postgres-plan.md`](./docs/plan/neon-postgres-plan.md); short version:

```bash
# Secrets — NOT in fly.toml (they carry credentials):
fly secrets set \
  DATABASE_URL="postgresql://…neon.tech/DBNAME?sslmode=require" \  # direct, non-pooler
  E2B_API_KEY=… ANTHROPIC_API_KEY=… SESSION_SECRET=… WS_SIGNING_KEY=… \
  ALLOWED_EMAILS="you@familysearch-account-email" API_KEYS="sk_live_…:chatbot@yourco.com"
# FAMILYSEARCH_WEB_ENABLED is non-secret and already set in deploy/fly.toml [env] —
# don't set it here (a secret would shadow the [env] value).

# Build context is the REPO ROOT (the Dockerfile copies the pnpm workspace).
# --ha=false: fly deploy otherwise provisions TWO machines (HA), which violates
# the count = 1 invariant below until init_db moves to a release_command.
fly deploy --config deploy/fly.toml --dockerfile deploy/Dockerfile . --ha=false

curl -s https://genealogy-workbench.fly.dev/api/health | jq   # expect "db":"postgres"
fly volumes destroy workbench_data    # if a volume lingers from a pre-Neon deploy
```

On boot `init_db()` creates the schema on Neon and seeds the allowlist. Non-secret
config lives in `deploy/fly.toml` `[env]` (`AGENT_MODE=real`, `SANDBOX_PROVIDER=e2b`,
`FAMILYSEARCH_WEB_ENABLED=true`, `PUBLIC_URL`, …); there is **no `[mounts]` block** — nothing persistent remains on
`DATA_DIR` once the DB is on Neon. The agent runs on **E2B**, not in this container
(the `genealogy-agent` image is a separate artifact — see `make sandbox-image`).

**Stay at `count = 1`.** `fly scale count > 1` first needs `init_db()` moved to a
one-time Fly `release_command` (two Machines otherwise race on `create_all` + the
allowlist seed); tracked in [`docs/TODOs.md`](./docs/TODOs.md). Sticky routing is
not an option (production is AWS-no-sticky). Because `fly deploy` provisions two
machines by default, always pass `--ha=false` (above); if a deploy ever leaves
two, run `fly scale count 1` to drop back to one.

## Troubleshooting

### `login` doesn't open a browser tab

**Symptom:** You ask Claude to log in to FamilySearch, the `login` tool
runs, but no browser tab appears. On older builds it then hangs ~5
minutes and reports a timeout.

**Cause:** `login` launches the browser with the `open` package, which
runs in whatever process context the MCP server lives in. In Cowork and
other sandboxed contexts that process often cannot surface a browser
window — and the failure is *silent* (no error is thrown), so nothing
is shown to the user.

**The fix is already in the code.** `performLogin()` is non-blocking: it
returns immediately with the authorization URL *in the result message*.
When the popup doesn't appear, Claude shows you that URL — copy it into
any browser, sign in, approve. So **don't wait for a popup; look for the
URL in Claude's reply.** The OAuth callback (`http://127.0.0.1:1837/callback`)
is local to the machine running the MCP server, so no port-forwarding is
needed when the MCP server and your browser are on the same machine.
Confirm the session afterward with the `auth_status` tool. A repeat
`login` call while a flow is in progress hands back the same URL.

Forcing a specific browser (`open(url, { app: ... })`) does **not** help
— if the process can't launch the default browser it can't launch a
named one either. The URL-in-the-response fallback is the reliable path.

### Deploying a code change to Claude Desktop

The MCP server Claude Desktop runs is a *built* artifact. Editing source
or pulling new commits changes nothing until you rebuild **and** fully
restart. Order matters:

1. **Free disk space if Cowork is complaining.** If Cowork shows "Not
   enough disk space," free space first — the workspace VM won't start
   otherwise.
2. **Pull the change.** `git pull` on the correct branch in your local
   clone.
3. **Rebuild the MCP server.**
   ```bash
   cd packages/engine/mcp-server && npm install && npm run build
   ```
   The `build/` output is what Claude Desktop loads, not the `src/`
   files.
4. **Rebuild the install artifacts you intend to ship** (only the ones
   relevant to the change):
   ```bash
   scripts/build-mcpb.sh        # if MCP server code changed
   scripts/package-plugin.sh    # if packages/engine/plugin/skills/ changed
   ```
5. **Re-install via the Cowork UI** (same path end users follow — see
   `README.md` § "Installation"):
   - **MCP:** Claude Desktop → Settings → Extensions → Advanced Settings
     → "Install extension" → pick the rebuilt
     `releases/genealogy-mcp.mcpb`. Installs over the old copy; no
     uninstall needed.
   - **Plugin:** Claude Desktop → Cowork tab → Customize → **remove the
     existing Genealogy Research plugin first**, then Add → Upload
     Plugin → pick the rebuilt `releases/genealogy-plugin.zip`.
     Uploading on top of the old plugin can leave the old skills in
     place.
6. **Fully quit Claude Desktop.** The MCP server is only re-read on a
   real restart — closing the window is not enough:
   - **macOS:** ⌘Q, or right-click the Dock icon → Quit. From a terminal,
     `pgrep -f Claude` should return nothing afterward.
   - **Windows:** system-tray icon → right-click → Quit. In Task
     Manager, confirm no `Claude.exe` process remains.
7. **Reopen Claude Desktop.**

To confirm the build picked up your change, grep the built file for a
string unique to it. From the repo root:

- **macOS / Linux:**
  ```bash
  grep -F "If no tab appeared" packages/engine/mcp-server/build/auth/login.js
  ```
- **Windows (PowerShell):**
  ```powershell
  Select-String -Path packages\engine\mcp-server\build\auth\login.js -Pattern "If no tab appeared"
  ```

A match means the new code is built; no match means the build is stale.

## Running all tests

`scripts/test.sh` runs every test suite in the repo in one shot:

```bash
./scripts/test.sh
```

It runs three suites in order and exits non-zero if any fail:

| Suite | Directory | Runner | What it tests |
|---|---|---|---|
| MCP server | `packages/engine/mcp-server/` | vitest | Tool code correctness |
| Eval app | `eval/app/` | vitest | Next.js CRUD UI logic |
| Eval harness | `eval/harness/` | pytest | Python test harness internals |

To run a single suite, use the per-suite commands in the sections below.

## Running the eval test suite

Skill evaluation lives under `eval/`. Quick start:

```bash
cd eval/harness
uv sync                                                  # first time only
uv run python run_tests.py --skill search-wikipedia           # run one skill's tests
uv run python run_tests.py --test ut_search_wikipedia_001     # run a single test
```

Run logs land under `eval/runlogs/unit/<skill>/<filename>` — `v{N}.json` (released),
`v{N}_<ts>.json` (candidate), or `scratch_<ts>.json` (partial `--test`/`--tag` runs,
gitignored). There is no `<model>` directory; the model is recorded in the run-log
JSON's `model` field. The harness has its own unit-test suite:

```bash
cd eval/harness && uv run pytest
```

See [`eval/README.md`](./eval/README.md) for the full guide including
prerequisites, useful flags, and Windows `.bat` shortcuts for
non-technical users.
