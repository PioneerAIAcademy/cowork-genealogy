# E2B sandbox template — `genealogy-agent`

The hosted workbench runs each user's agent inside its own E2B Firecracker
microVM. This directory holds the **template image** for that microVM:

- `e2b.Dockerfile` — what gets baked.
- `build-image.sh` — compiles the engine, then builds the E2B template via
  `e2b template create` (v2 build system); name, `start_cmd`, and resources are
  passed as flags. `make sandbox-image` calls it.

> Status: these files are ready to build. The actual build/push needs an
> `E2B_API_KEY` (an E2B account), which does not exist yet. Until then nothing
> here runs; the POC uses `SANDBOX_PROVIDER=local` (LocalProvider), which
> exercises the same control-plane code paths against local subprocesses.

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
| `wiki/` | pre-crawled wiki markdown corpus | **NOT baked yet** — see below |

Runtimes: **Python 3.12** (Ubuntu 24.04 system python) + **Node 20** (NodeSource).
`claude-agent-sdk>=0.2.93` is pip-installed system-wide; it ships its own
bundled `claude` CLI (`claude_agent_sdk/_bundled/claude`), so **no separate
Claude CLI install is needed**.

Base-image choice: `ubuntu:24.04` is the simplest single base with **both**
required runtimes and no PPAs — Python 3.12 is its system python (Debian
bookworm is only 3.11) and Node 20 LTS comes from NodeSource. E2B accepts any
Dockerfile, so we are not tied to an e2b base image.

The engine is staged exactly like the `.mcpb` build (`scripts/build-mcpb.sh`):
copy `build/` + `config/` + `package.json` + `package-lock.json`, then a clean
`npm ci --omit=dev`. We do **not** copy the repo's dev `node_modules` — that
would drag in `typescript`/`vitest`/`mcpb`.

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
- `$HOME/.familysearch-mcp/config.json` — per-user MCP tunables
  (`wikiApiUrl`, `wikiMarkdownDir`, …). Needed for the wiki page tools (below).

---

## Wiki corpus decision

`wiki_search` hits the hosted `wiki-query-api` over the network and works in
the sandbox as-is (egress is open on E2B) — confirm the sidecar's Tailscale
Funnel is public so the microVM can reach it.

`wiki_read` and `wiki_place_page` are different: they read a **pre-crawled wiki
markdown corpus** from a local directory, resolved from
`~/.familysearch-mcp/config.json` → `wikiMarkdownDir` (see
`packages/engine/mcp-server/src/auth/config.ts` `getWikiMarkdownDir`, which **throws** when the
key is absent).

**Decision for this image: the corpus is NOT baked yet** (its source path is
TBD by Dallan — we don't invent a corpus). Consequence: `wiki_read` and
`wiki_place_page` will error with the configured
`WIKI_MARKDOWN_DIR_MISSING_MESSAGE` until a corpus is provided. Every other
tool works.

To enable them later (two steps):

1. Bake the corpus — add to `e2b.Dockerfile`:
   `COPY <corpus-dir> ${AGENT_HOME}/wiki`
2. Wire the config — have the control plane include
   `{"wikiMarkdownDir": "/opt/genealogy-agent/wiki"}` in the per-sandbox
   `$HOME/.familysearch-mcp/config.json` it writes on connect (alongside the FS
   token). `learningCenterDir` / `libraryDir` are optional and return `null`
   when absent (no error), so they need no baking.

---

## Build

```bash
export E2B_API_KEY=e2b_...        # from your E2B account (required to push)
npm install -g @e2b/cli           # if not already installed
make sandbox-image                # → apps/server/sandbox/build-image.sh
```

`build-image.sh`:
1. `cd packages/engine/mcp-server && npm install && npm run build` (so `build/` is in context).
2. `e2b template create genealogy-agent --path <repo root> --dockerfile apps/server/sandbox/e2b.Dockerfile --cmd 'tail -f /dev/null' --ready-cmd true --cpu-count 2 --memory-mb 2048` (v2 build system). v2 requires both a start command (`--cmd`, keeps the VM warm) and a ready command (`--ready-cmd true`, ready as soon as the VM boots — the agent_runner is launched per session, not at boot).

The build context is the **repo root** — that is why the Dockerfile's `COPY`
paths are repo-root-relative (`apps/server/app`, `packages/engine/mcp-server/build`, `packages/engine/plugin`).

`e2b template create` rebuilds the template in place by name (no config file, no
generated `template_id` to commit). The control plane references the template by
name (`config.py` `e2b_template = "genealogy-agent"`, `SandboxSpec.template`).
