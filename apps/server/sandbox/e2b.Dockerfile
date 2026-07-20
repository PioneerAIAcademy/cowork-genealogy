# Genealogy agent sandbox — E2B Firecracker microVM template image.
#
# Bakes everything the in-sandbox agent_runner needs so a session can run a
# real turn with zero network installs at boot:
#   - Python 3.12 + claude-agent-sdk (drives the skills + forks the MCP server)
#   - the agent package (apps/server/app) → `python -m app.agent.runner`
#   - the genealogy engine (mcp-server prod tree) → forked as node <index.js>
#   - the plugin skills (plugin/) → loaded by the Agent SDK
#
# Base: ubuntu:24.04. It is the simplest single base that ships BOTH runtimes
# this image needs with no PPAs — Python 3.12 is Ubuntu 24.04's system python
# (Debian bookworm is only 3.11; deadsnakes would be required there), and Node
# 22 LTS comes straight from NodeSource. E2B accepts any Dockerfile as a
# template, so we are not constrained to an e2b base image.
#
# Build context is the REPO ROOT (see build-image.sh, which passes --path <root>).
# The engine MUST already be compiled before this builds: build-image.sh runs
# `cd packages/engine/mcp-server && npm install && npm run build` first, so
# packages/engine/mcp-server/build/ exists in the context.
FROM ubuntu:24.04

# NOTE: one ENV per line — the E2B v2 Dockerfile parser appends a trailing space
# to non-last values in a multi-line `ENV a=x \` block (breaks PIP_NO_CACHE_DIR
# and the engine paths). Keep these single-line.
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV NODE_MAJOR=22

# ── System packages: Python 3.12 (default on 24.04) + pip/venv + Node 22 ──
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg git \
        python3 python3-pip python3-venv \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version && python3 --version

# Everything the agent ships under one fixed prefix the E2BProvider can rely on.
ENV AGENT_HOME=/opt/genealogy-agent
RUN mkdir -p "${AGENT_HOME}"

# ── Python deps: claude-agent-sdk (ships its own bundled `claude` CLI under
#    claude_agent_sdk/_bundled/claude — no separate Claude CLI install needed).
#    mock_agent is stdlib-only; real_agent imports only claude_agent_sdk. We
#    install at the system level so `python3 -m app.agent.runner` resolves the
#    SDK without a venv activation step. PEP 668 marks 24.04's python externally
#    managed, hence --break-system-packages (this is a single-purpose image). ──
RUN python3 -m pip install --break-system-packages \
        "claude-agent-sdk>=0.2.93" "websockets>=13"

# ── Agent package: only what `python -m app.agent.runner` needs. The runner
#    + mock_agent + real_agent live under app/agent/; the app/ and app/agent/
#    __init__.py make `app` an importable package. apps/server itself is NOT a
#    package (no apps/server/__init__.py) — it is the import root, so we copy
#    the `app` package under ${AGENT_HOME}/server/app and point PYTHONPATH at
#    ${AGENT_HOME}/server. We copy the whole `app` tree (small); the runner
#    only imports app.agent.{runner,mock_agent,real_agent}, but copying all of
#    `app` keeps the package importable and avoids cherry-picking. ──
COPY apps/server/app ${AGENT_HOME}/server/app

# ── Engine: the genealogy MCP server, production tree only (compiled JS +
#    config + prod node_modules). Mirrors scripts/build-mcpb.sh staging: copy
#    build/ + config/ + package manifests, then `npm ci --omit=dev`. We do NOT
#    copy the dev node_modules from the context — we install a clean prod set
#    so devDependencies (typescript, vitest, mcpb) never enter the image. ──
# NOTE: full destination PATH per COPY, not a trailing-slash dir. The E2B v2
# build system does not auto-create a `COPY file dest/` destination directory
# the way classic Docker does — `COPY …/package.json ${AGENT_HOME}/engine/`
# fails with "failed to move files in sandbox" because engine/ doesn't exist
# yet. A named target whose parent is missing DOES work (the parent is created,
# as the server/app COPY above shows), so name each destination in full.
COPY packages/engine/mcp-server/package.json      ${AGENT_HOME}/engine/package.json
COPY packages/engine/mcp-server/package-lock.json ${AGENT_HOME}/engine/package-lock.json
COPY packages/engine/mcp-server/build             ${AGENT_HOME}/engine/build
COPY packages/engine/mcp-server/config            ${AGENT_HOME}/engine/config
RUN cd ${AGENT_HOME}/engine && npm ci --omit=dev --ignore-scripts

# ── Plugin: the Cowork skills + plugin agents, loaded by the Agent SDK via
#    plugins=[{type:"local", path: ENGINE_PLUGIN_DIR}]. ──
COPY packages/engine/plugin ${AGENT_HOME}/plugin

# ── Wiki tools: nothing to bake ───────────────────────────────────────────
# wiki_search, wiki_read and wiki_place_page are all HTTP clients of the hosted
# wiki-query-api (see CLAUDE.md "External service dependencies"); the corpus
# lives on that server. getWikiApiUrl() falls back to a working default, so no
# per-sandbox config is required. (This block used to describe a local
# `wikiMarkdownDir` corpus the page tools read from disk — that code path is
# gone; the tools were moved to the networked API.)

# ── Engine env baked as defaults so a bare `python -m app.agent.runner` in
#    this image already points at the baked engine/plugin even if a caller
#    forgets to pass them. The E2BProvider SHOULD still pass them explicitly
#    (see README) so the contract is not implicit. ──
ENV ENGINE_MCP_BUILD=${AGENT_HOME}/engine/build/index.js
ENV ENGINE_PLUGIN_DIR=${AGENT_HOME}/plugin
ENV PYTHONPATH=${AGENT_HOME}/server

# Per-sandbox HOME (matches sandbox/base.py HOME_DIR). The FamilySearch token
# lands at $HOME/.familysearch-mcp/tokens.json (token-injection option a) and
# the per-user wiki/config at $HOME/.familysearch-mcp/config.json. The control
# plane writes both via Sandbox.write_file on connect.
RUN mkdir -p /home/user/.familysearch-mcp && chmod 700 /home/user/.familysearch-mcp
ENV HOME=/home/user

# The agent's project folder. The in-sandbox agent writes research.json /
# tree.gedcomx.json / results/ here and the WS server watches it for viewer
# deltas. The agent runs as the E2B `user` (NOT root); E2B chowns $HOME to
# `user` at runtime but NOT /project (it is outside $HOME), so a root-owned
# /project is unwritable by the agent (EACCES on the project files — the whole
# point of the sandbox). Make it world-writable so the agent writes without sudo.
RUN mkdir -p /project && chmod 777 /project
WORKDIR /project

# The template stays warm doing nothing; the control plane starts the
# agent_runner per session via SandboxProvider.start_process (E2B
# commands.run). Overridden by the `--cmd` flag in build-image.sh, kept here as
# a sane default for a bare `docker run`.
CMD ["tail", "-f", "/dev/null"]
