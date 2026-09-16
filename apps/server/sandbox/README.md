# E2B sandbox template — `genealogy-agent`

The hosted workbench runs each user's agent inside its own E2B Firecracker
microVM. This directory holds the **template image** for that microVM:

- `e2b.Dockerfile` — what gets baked.
- `build-image.sh` — compiles the engine, then builds the E2B template via
  `e2b template create` (v2 build system); name, `start_cmd`, and resources are
  passed as flags. `make sandbox-image` calls it.

> `make deploy` builds this image as part of the deploy, so the control plane and
> the sandbox ship together. It stays a standalone target too (`make
> sandbox-image`) for building a dev template without deploying. Both need an
> `E2B_API_KEY` and a globally-installed `e2b` CLI; local development without
> either uses `SANDBOX_PROVIDER=local` (LocalProvider), which exercises the same
> control-plane code paths against local subprocesses.

---

## What's baked (image layout)

Everything lands under `/opt/genealogy-agent/` (`$AGENT_HOME`):

| Path | Contents | Used by |
|---|---|---|
| `server/app/` | the agent package (`app/agent/{runner,mock_agent,real_agent}.py` + the rest of `app`) | `python -m app.agent.runner` |
| `engine/build/index.js` | compiled genealogy MCP server | forked as `node <index.js>` |
| `engine/node_modules/` | engine **prod-only** deps (`npm ci --omit=dev`) | the MCP server |
| `engine/config/familysearch.json` | bundled FS OAuth client id | the MCP server |
| `plugin/` | Cowork skills + plugin agents | the Agent SDK (`plugins=[…]`) |
| `BUILD_INFO.json` | `{"commit", "dirty", "built_at"}` — which build this image IS | `E2BProvider`, which reports the commit on `/api/health` |

Runtimes: **Python 3.12** (Ubuntu 24.04 system python) + **Node 22** (NodeSource).
`claude-agent-sdk>=0.2.93` is pip-installed system-wide; it ships its own
bundled `claude` CLI (`claude_agent_sdk/_bundled/claude`), so **no separate
Claude CLI install is needed**.

Base-image choice: `ubuntu:24.04` is the simplest single base with **both**
required runtimes and no PPAs — Python 3.12 is its system python (Debian
bookworm is only 3.11) and Node 22 LTS comes from NodeSource (`NODE_MAJOR` in
the Dockerfile is the one source of that number). E2B accepts any Dockerfile, so
we are not tied to an e2b base image.

The engine is staged exactly like the `.mcpb` build (`scripts/build-mcpb.sh`):
copy `build/` + `config/` + `package.json` + `package-lock.json`, then a clean
`npm ci --omit=dev`. We do **not** copy the repo's dev `node_modules` — that
would drag in `typescript`/`vitest`/`mcpb`.

### `BUILD_INFO.json` — which build a session is on

`build-image.sh` writes `apps/server/sandbox/build-provenance.json` (gitignored,
regenerated every build) into the build context, and the Dockerfile's **last**
`COPY` bakes it to `${AGENT_HOME}/BUILD_INFO.json`. Last because its contents
change on every build: above the `npm ci` layer it would invalidate everything
under it and make each build re-run apt, pip and `npm ci`.

`E2BProvider.create()` reads it back off each new sandbox and caches it, and
`/api/health` reports the commit as `sandboxImageCommit`. Three things this is
careful about:

- **It is read from the image, not from the deploy.** The template is referenced
  by a stable name and carries no version, and `e2b template list` returns a
  build *timestamp*, not a commit. `GIT_SHA`/`BUILD_DATE` describe the **Fly**
  container, a different image entirely. After one `make deploy` the two describe
  the same commit but do not look alike: Fly's is stamped with
  `git rev-parse --short HEAD` (7 chars) and this one is the full 40-character
  sha, plus `+dirty` when applicable.
- **It refreshes on every create, not once per process.** `make sandbox-image`
  rebuilds the template in place and does not restart the control plane, so a
  read-once cache would report the pre-rebuild commit for the life of the process.
- **`dirty: true` when the tree was unclean.** The image is built from the working
  tree, so `git rev-parse HEAD` names a commit that may not be what was baked; the
  flag rides on the reported value as a `+dirty` suffix. A clean sha claimed for an
  image built over uncommitted skill edits is worse than no sha at all.

Never fatal, though the failure shapes do not land in the same place. No git and
a repo with no commits both bake `commit: "dev"`, so `sandboxImageCommit` reports
`dev` rather than null (the no-commits shape can also carry `+dirty`; the no-git
shape cannot, since there is no `git status` to consult). It is null when the
baked file is missing or unparseable, when its `commit` is absent, empty or not a
string, and when the read times out. None of these breaks the build or session
creation.

---

## Env the E2BProvider MUST pass at `start_process` time

The agent is launched per session by the control plane, not by a baked server.
`apps/server/app/chat.py:start_agent_process` builds the env and runs
`<python> -m app.agent.runner`. For the **local** provider it relies on
repo-relative defaults in `real_agent.py`; for the **baked E2B image** the
process must be pointed at the baked paths instead. So `E2BProvider.start_process`
(or `chat.py`, when `SANDBOX_PROVIDER=e2b`) must pass:

| Env var | Value (in the E2B image) | Why / source |
|---|---|---|
| `AGENT_MODE` | `real` (or `mock`) | `runner.py` `_make_agent` selects RealAgent vs MockAgent. Set from `settings.agent_mode`. |
| `PROJECT_DIR` | `/project` | `runner.py` reads it for the project dir; `real_agent.py` uses it as cwd. In a microVM this is the sandbox-absolute path (`sandbox/base.py` `PROJECT_DIR`). |
| `HOME` | `/home/user` | Per-sandbox HOME so the MCP server reads **this** session's `~/.familysearch-mcp/tokens.json` (token-injection option a). Matches `base.py` `HOME_DIR`. |
| `MODEL` | e.g. `claude-sonnet-4-6` | `real_agent.py` `build_options` → `ClaudeAgentOptions(model=…)`. From `project.model`. |
| `ANTHROPIC_API_KEY` | operator key | `real_agent.py` passes it through to the SDK env. From `settings.anthropic_api_key`. |
| `PYTHONPATH` | `/opt/genealogy-agent/server` | So `python -m app.agent.runner` resolves the `app` package. (LocalProvider uses `apps/server`; the image relocates it.) |
| `ENGINE_MCP_BUILD` | `/opt/genealogy-agent/engine/build/index.js` | `real_agent.py` `_MCP_BUILD = os.environ.get("ENGINE_MCP_BUILD", …repo default…)` — the baked path overrides the repo default. |
| `ENGINE_PLUGIN_DIR` | `/opt/genealogy-agent/plugin` | `real_agent.py` `_PLUGIN_DIR = os.environ.get("ENGINE_PLUGIN_DIR", …)` — same. |

Notes:
- `chat.py` today sets `AGENT_MODE`, `PROJECT_DIR`, `HOME`, `MODEL`,
  `ANTHROPIC_API_KEY`, and `PYTHONPATH=apps/server`. It does **not** yet set
  `ENGINE_MCP_BUILD` / `ENGINE_PLUGIN_DIR` / a relocated `PYTHONPATH`, because
  LocalProvider runs against the repo. When the E2B path is wired, those three
  must be added for `SANDBOX_PROVIDER=e2b` (or read from `Sandbox`
  helpers). The image also bakes all three as `ENV` defaults, so a bare
  `python -m app.agent.runner` already resolves the baked engine/plugin — but
  passing them explicitly keeps the contract non-implicit.
- The launch command is `<python> -m app.agent.runner`. In the image use
  `python3` (not `sys.executable` from the host venv). The runner speaks JSON
  lines over **stdio**; map onto E2B `commands.run(cmd, background=True,
  stdin=True, on_stdout=…)` (see `sandbox/base.py` `Process` and `e2b.py`).

### Secrets written per connect (not env)

Env can't be mutated on a running microVM, so per-session secrets are written
as files on connect (sandbox-provider design decision #2):

- `$HOME/.familysearch-mcp/tokens.json` — the user's FamilySearch OAuth token
  (token-injection option a). The control plane writes it via
  `Sandbox.write_file` before/at session start; the MCP server reads it.
- `$HOME/.familysearch-mcp/config.json` — per-user MCP tunables (`wikiApiUrl`,
  `popStatsUrl`, `openRouterApiKey`, and the `hosted` marker). Written by
  `fs_oauth.hosted_config()`.

---

## Wiki corpus decision — settled: nothing to bake

`wiki_search`, `wiki_read` and `wiki_place_page` are **all** HTTP clients of the
hosted `wiki-query-api` (CLAUDE.md, "External service dependencies"); the
pre-crawled markdown corpus lives on that server, not in this image. E2B egress
is open, so nothing blocks them at the network layer. What is not settled is the
address: `fs_oauth.hosted_config()` writes `wikiApiUrl` into each sandbox's
`config.json` ONLY when `WIKI_API_URL` is set on the control plane, and
`deploy/fly.toml` does not set it today, so a hosted session currently runs on the
engine's compiled-in `DEFAULT_WIKI_API_URL`. That names one developer's tailnet
host rather than a public deployment (CLAUDE.md, "External service dependencies"),
so these tools work from a hosted sandbox only while that host is reachable.

This section previously described baking a local corpus that `wiki_read` and
`wiki_place_page` read from disk via a `wikiMarkdownDir` config key. **That code
path is gone** — `getWikiMarkdownDir` no longer exists in the engine — and the
`COPY <corpus-dir>` step it recommended would bake a directory nothing reads.

---

## Build

```bash
export E2B_API_KEY=e2b_...        # from your E2B account (required to push)
npm install -g @e2b/cli           # if not already installed

make deploy                       # ships the control plane AND rebuilds this image
E2B_TEMPLATE_NAME=genealogy-agent-dev make sandbox-image   # image only, dev template
```

**`make deploy` builds this image.** The hosted product ships from two
independent images — the Fly container (control plane + web client) and this E2B
template — and only the first used to be built by a deploy. The image is
referenced at runtime by a stable name, so a green deploy could leave every
paying session on weeks-old skills and MCP tools with nothing to show it. They
now ship together (lead decision, 2026-09-10); `make deploy` therefore requires
`E2B_API_KEY` and the `e2b` CLI.

It is still two phases with a window: `e2b template create` rebuilds the template
**in place by name**, with no versioned tag to roll back to, so a `fly deploy`
failure after the image push leaves production's sandboxes on the new in-sandbox
code against the old control plane. Recover by rebuilding from the commit that is
actually deployed: `git checkout <sha> && make sandbox-image`.

### Which template you are rebuilding

`E2B_TEMPLATE_NAME` selects it and **defaults to production's `genealogy-agent`**.
Because `e2b template create` rebuilds in place, a build from your branch without
that override publishes your branch's skills, agents and MCP build to every
hosted session. Verify against `genealogy-agent-dev` and point the server at it
with `E2B_TEMPLATE=genealogy-agent-dev` (a plain pydantic-settings override —
there is no env prefix). Rebuild `genealogy-agent` itself only when the lead says
to.

`build-image.sh` reads `apps/server/.env`, but the **caller's**
`E2B_TEMPLATE_NAME` wins over anything set there. Do not rely on a `.env` entry
to keep you off production: `set -a; source` assigns, so without that precedence
a `.env` value would silently override the name you passed on the command line.

`build-image.sh`:
1. `cd packages/engine/mcp-server && npm install && npm run build` (so `build/` is in context).
2. Write `build-provenance.json` into the context (commit + dirty flag + timestamp).
3. `e2b template create "$E2B_TEMPLATE_NAME" --path <repo root> --dockerfile apps/server/sandbox/e2b.Dockerfile --cmd 'tail -f /dev/null' --ready-cmd true --cpu-count 2 --memory-mb 2048` (v2 build system). v2 requires both a start command (`--cmd`, keeps the VM warm) and a ready command (`--ready-cmd true`, ready as soon as the VM boots — the agent_runner is launched per session, not at boot).

The build context is the **repo root** — that is why the Dockerfile's `COPY`
paths are repo-root-relative (`apps/server/app`, `packages/engine/mcp-server/build`, `packages/engine/plugin`).

`e2b template create` rebuilds the template in place by name (no config file, no
generated `template_id` to commit). The control plane references the template by
name (`config.py` `e2b_template = "genealogy-agent"`, `SandboxSpec.template`).
`make server-e2b` does **not** rebuild anything: it runs whatever is baked into
the template it resolves.
