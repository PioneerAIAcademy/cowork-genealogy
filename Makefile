# Hosted Genealogy Workbench — memorable build / run / deploy commands.
# Run `make help` for the menu. The genealogy engine (mcp-server/ + plugin/)
# stays npm-managed; everything else is the pnpm workspace + the FastAPI server.
#
# Running the workbench locally? See DEVELOPMENT.md § "Running the hosted web
# workbench locally" for the server/web target matrix (provider, agent, login,
# port) and the rule that the web target must match the server's port.

.DEFAULT_GOAL := help
SHELL := /bin/bash

# Source the Anthropic key (operator key) from the sibling UI repo's .env if
# present, so `make server-real` / real-agent runs work without copying secrets
# into this repo. Override by exporting ANTHROPIC_API_KEY yourself.
UI_ENV := ../cowork-genealogy-ui/.env

# ── Dependency stamps (make implicit prerequisites explicit) ─────
# Each run/test target depends on a stamp below instead of silently assuming the
# install/build was done by hand. A stamp rebuilds ONLY when its inputs change,
# so the steady state is a no-op — not a reinstall on every run. The stamps live
# under gitignored build output (node_modules / build), so they regenerate after
# a clean checkout. Python deps are NOT listed here: `uv run` auto-syncs the venv
# on every invocation, so the server/harness targets are already self-healing.
ENGINE_DIR    := packages/engine/mcp-server
ENGINE_BUILD  := $(ENGINE_DIR)/build/index.js
ENGINE_DEPS   := $(ENGINE_DIR)/node_modules/.make-installed
EVAL_APP_DEPS := eval/app/node_modules/.make-installed
JS_DEPS       := node_modules/.make-installed

# Root pnpm workspace (web, electron, viewer-ui, schema). Reinstall when the
# manifest or lockfile changes.
$(JS_DEPS): package.json pnpm-lock.yaml
	pnpm install
	@touch $@

# Genealogy engine deps. Reinstall when the engine manifest/lockfile changes.
$(ENGINE_DEPS): $(ENGINE_DIR)/package.json $(ENGINE_DIR)/package-lock.json
	cd $(ENGINE_DIR) && npm install
	@touch $@

# Genealogy engine build. Real-agent LOCAL runs fork this compiled entrypoint
# (`node <ENGINE_BUILD>`); without it the agent loses every genealogy tool.
# Rebuild when the engine TypeScript source or its deps change. (E2B does NOT
# need this — the genealogy-agent image bakes its own engine; see server-e2b.)
$(ENGINE_BUILD): $(ENGINE_DEPS) $(shell find $(ENGINE_DIR)/src -type f 2>/dev/null)
	cd $(ENGINE_DIR) && npm run build

# Eval CRUD UI deps.
$(EVAL_APP_DEPS): eval/app/package.json
	cd eval/app && npm install
	@touch $@

.PHONY: engine-build
engine-build: $(ENGINE_BUILD) ## Build the genealogy engine (mcp-server) — real-agent local runs need it

.PHONY: help
help: ## Show this menu
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | sort | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Setup ────────────────────────────────────────────────────────
.PHONY: install
install: $(JS_DEPS) server-install $(ENGINE_BUILD) $(EVAL_APP_DEPS) ## Install EVERYTHING: pnpm workspace, server venv, engine build, eval-ui deps
	@echo "✓ install complete (pnpm workspace + server venv + engine build + eval-ui deps)"

.PHONY: server-install
server-install: ## Create the server venv and install FastAPI deps (uv)
	cd apps/server && uv sync

# ── Dev (the POC: run a server + a web client in two terminals) ──
# See DEVELOPMENT.md for the full matrix. Quick guide: the web target must match
# the server's port — `web` ↔ :8000 (server / server-real), `web-oauth` ↔ :1837
# (server-oauth / server-e2b).
.PHONY: dev
dev: ## Print how to run the full local POC
	@echo "Run these in two terminals:"
	@echo "  make server     # FastAPI control plane on :8000"
	@echo "  make web        # Vite web client on :5173"

.PHONY: web
web: $(JS_DEPS) ## Web client; proxies /api+WS to :8000 (use with server / server-real)
	pnpm --filter web dev

.PHONY: server
server: ## LOCAL + MOCK agent, dev-login, :8000 — zero setup (web client: make web)
	# Pin the dev-friendly values so a .env kept for server-oauth/-e2b (real FS,
	# SANDBOX_PROVIDER=e2b) doesn't leak into this zero-setup target:
	#  - FAMILYSEARCH_WEB_ENABLED=false → the FS front door is off, so /auth/config
	#    offers dev-login (any email, no allowlist) and the agent runs in mock mode;
	#  - SANDBOX_PROVIDER=local → sessions run locally, no E2B key needed.
	cd apps/server && AGENT_MODE=mock SANDBOX_PROVIDER=local \
	  FAMILYSEARCH_WEB_ENABLED=false \
	  uv run uvicorn app.main:app --reload --port 8000

.PHONY: server-real
server-real: $(ENGINE_BUILD) ## LOCAL + REAL agent, dev-login, :8000 — needs ANTHROPIC_API_KEY (web client: make web)
	# engine-build prereq: the real agent forks `node <mcp-server/build/index.js>`.
	# Key is sourced from $$ANTHROPIC_API_KEY, else the sibling repo's .env (UI_ENV).
	# Pin the same dev-friendly values as `server` (local provider, dev-login, FS
	# front door off) so .env kept for the oauth/e2b targets doesn't leak in here.
	cd apps/server && AGENT_MODE=real SANDBOX_PROVIDER=local \
	  FAMILYSEARCH_WEB_ENABLED=false \
	  ANTHROPIC_API_KEY="$${ANTHROPIC_API_KEY:-$$(grep -E '^ANTHROPIC_API_KEY=' $(UI_ENV) | cut -d= -f2-)}" \
	  uv run uvicorn app.main:app --reload --port 8000

.PHONY: server-oauth
server-oauth: $(ENGINE_BUILD) ## LOCAL + REAL FamilySearch front-door login, :1837 (web client: make web-oauth)
	# Forces the local provider + WS relay (E2B has no local runtime; this isolates
	# the OAuth layer). FAMILYSEARCH_WEB_ENABLED is forced on so FamilySearch is the
	# only app login (no dev-login), with the client id from the bundled
	# mcp-server/config/familysearch.json. The token from that one login is injected
	# into every sandbox this user creates. AGENT_MODE comes from .env; engine-build
	# prereq: with AGENT_MODE=real the agent forks the local engine.
	cd apps/server && \
	  PUBLIC_URL=http://127.0.0.1:1837 WEB_ORIGIN=http://127.0.0.1:5173 \
	  SANDBOX_PROVIDER=local REALTIME=local_ws FAMILYSEARCH_WEB_ENABLED=true \
	  uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 1837

.PHONY: web-oauth
web-oauth: $(JS_DEPS) ## Web client; proxies /api+WS to :1837 (use with server-oauth / server-e2b)
	VITE_API_TARGET=http://127.0.0.1:1837 pnpm --filter web dev

.PHONY: db-reset
db-reset: ## Wipe the local SQLite DB + sandbox dirs (POC drop/recreate; schema rebuilds on next server start)
	# After a model/schema change the on-disk SQLite DB drifts — create_all() never
	# ALTERs existing tables, so list/create can 500 with "no such column: …". Wipe
	# the local data and let init_db() rebuild it fresh on the next server start.
	# SAFE: touches only .workbench-data/ (local POC); Neon/prod is unaffected.
	rm -f .workbench-data/workbench.db
	rm -rf .workbench-data/sandboxes/*
	@echo "✓ local DB + sandbox dirs reset — (re)start the server to recreate the schema"

# Internal guard (a server-e2b prerequisite, NOT run directly — so no `## ` help
# line): verifies the required keys are present and reminds that the baked E2B
# image must be current.
.PHONY: e2b-preflight
e2b-preflight:
	@test -f apps/server/.env || { echo "ERROR: apps/server/.env is missing (needs E2B_API_KEY + ANTHROPIC_API_KEY)." >&2; exit 1; }
	@grep -qE '^E2B_API_KEY=.'       apps/server/.env || { echo "ERROR: E2B_API_KEY is not set in apps/server/.env."       >&2; exit 1; }
	@grep -qE '^ANTHROPIC_API_KEY=.' apps/server/.env || { echo "ERROR: ANTHROPIC_API_KEY is not set in apps/server/.env." >&2; exit 1; }
	@echo "NOTE: server-e2b runs the in-sandbox code BAKED INTO the 'genealogy-agent' E2B image."
	@echo "      If you changed apps/server/app/sandbox_server.py or app/agent/*.py since your last"
	@echo "      'make sandbox-image', rebuild the image first or the microVM runs STALE code."

.PHONY: server-e2b
server-e2b: e2b-preflight ## E2B + REAL agent + REAL FamilySearch login, :1837 (web client: make web-oauth)
	# Full live-test path: SANDBOX_PROVIDER=e2b boots the genealogy-agent image's
	# in-sandbox WS server per session; the browser connects to it directly via
	# /connect's {wssUrl, token}. AGENT_MODE/ANTHROPIC_API_KEY are injected into the
	# sandbox. Use `make web-oauth` for the client, open http://127.0.0.1:5173.
	# No local engine build needed — the image bakes the engine. The real hidden
	# dep is a CURRENT image; e2b-preflight checks keys + reminds about staleness.
	cd apps/server && \
	  PUBLIC_URL=http://127.0.0.1:1837 WEB_ORIGIN=http://127.0.0.1:5173 \
	  SANDBOX_PROVIDER=e2b AGENT_MODE=real REALTIME=local_ws FAMILYSEARCH_WEB_ENABLED=true \
	  uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 1837

.PHONY: electron
electron: $(JS_DEPS) ## Run the Electron viewer (consumes the shared viewer-ui)
	pnpm --filter cowork-genealogy-ui dev

# ── Quality / tests ──────────────────────────────────────────────
.PHONY: typecheck
typecheck: $(JS_DEPS) ## Typecheck the whole JS workspace (turbo)
	pnpm typecheck

.PHONY: test-all
test-all: ## Run EVERY test suite (JS workspace + server + engine + eval harness + CRUD UI)
	$(MAKE) test-js
	$(MAKE) server-test
	$(MAKE) engine-test
	$(MAKE) harness-test
	$(MAKE) eval-ui-test
	@echo "✓ all test suites passed"

.PHONY: test
test: ## Quick loop: JS workspace + server tests (a subset of test-all)
	$(MAKE) test-js
	$(MAKE) server-test

.PHONY: test-js
test-js: $(JS_DEPS) ## JS workspace tests — web, electron, viewer-ui, schema (turbo)
	pnpm test

.PHONY: server-test
server-test: ## Control-plane tests — apps/server (FastAPI, pytest; uv auto-syncs the venv)
	cd apps/server && uv run pytest -q

.PHONY: engine-test
engine-test: $(ENGINE_DEPS) ## Genealogy engine tests — packages/engine/mcp-server (vitest)
	cd $(ENGINE_DIR) && npm test

.PHONY: harness-test
harness-test: ## Eval harness tests — eval/harness (pytest, excludes e2e; uv auto-syncs the venv)
	cd eval/harness && uv run pytest -m 'not e2e' -q

.PHONY: eval-ui-test
eval-ui-test: $(EVAL_APP_DEPS) ## Eval CRUD UI tests — eval/app (vitest)
	cd eval/app && npm test

# ── Artifacts (the existing Cowork/desktop deliverables) ─────────
# build-mcpb.sh and build-image.sh already self-install + self-build the engine,
# so these stay as thin wrappers (no hidden dep to surface here).
.PHONY: mcpb
mcpb: ## Build the .mcpb desktop extension
	bash scripts/build-mcpb.sh

.PHONY: plugin
plugin: ## Build the Cowork plugin .zip
	bash scripts/package-plugin.sh

.PHONY: sandbox-image
sandbox-image: ## Build the E2B sandbox template image (for hosted deploy)
	bash apps/server/sandbox/build-image.sh

.PHONY: deploy
deploy: ## Deploy the control plane to Fly (builds web+server image; single always-on machine)
	# Build context is the repo ROOT (the Dockerfile copies the pnpm workspace).
	# --ha=false: fly deploy provisions TWO machines by default; stay at count=1
	# until init_db moves to a release_command (docs/TODOS.md). Secrets +
	# `fly apps create` are one-time (DEVELOPMENT.md § Deploy to Fly.io).
	# NOTE: apps/web/dist is baked at build time — redeploy to ship UI changes.
	fly deploy --config deploy/fly.toml --dockerfile deploy/Dockerfile . --ha=false
