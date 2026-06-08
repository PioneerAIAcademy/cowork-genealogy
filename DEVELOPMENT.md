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
     the pattern of `try-wikipedia.ts` / `try-places.ts`. Critical for
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

## Public `/v1` REST API (hosted control plane)

The hosted web control plane (`apps/server/`, FastAPI / Python / uv —
**separate from the engine**) exposes a dedicated, versioned,
**bearer-only** REST surface at `/v1` so an external chatbot client can
drive sessions over plain HTTP — no browser cookie, no WebSocket.
Source: `apps/server/app/v1.py`. Design + spec:
[`docs/plan/public-rest-api.md`](./docs/plan/public-rest-api.md).

Endpoints (all require `Authorization: Bearer <key>`):

- `POST /v1/sessions` → create. Returns `{session_id, title, model, created_at}`.
- `POST /v1/sessions/{id}/messages` → send a message. Body `{message, stream?}`:
  sync JSON when `stream` is false/omitted, **Server-Sent Events** when `true`.
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
  the grant; the allowlist gates self-service Google/dev login only).
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
API_KEYS="sk_dev:bot@example.com" make server

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
   - **MCP:** Claude Desktop → Settings → Extensions → "Install
     Extension..." → pick the rebuilt `releases/genealogy-mcp.mcpb`.
   - **Plugin:** Claude Desktop → Cowork tab → Customize → Browse
     plugins → Upload custom plugin → pick the rebuilt
     `releases/genealogy-plugin.zip`.
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

Run logs land under `eval/runlogs/unit/<skill>/<model>/<timestamp>.json`.
The harness has its own unit-test suite:

```bash
cd eval/harness && uv run pytest
```

See [`eval/README.md`](./eval/README.md) for the full guide including
prerequisites, useful flags, and Windows `.bat` shortcuts for
non-technical users.
