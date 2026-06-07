# Hosted Genealogy Workbench — memorable build / run / deploy commands.
# Run `make help` for the menu. The genealogy engine (mcp-server/ + plugin/)
# stays npm-managed; everything else is the pnpm workspace + the FastAPI server.

.DEFAULT_GOAL := help
SHELL := /bin/bash

# Source the Anthropic key (operator key) from the sibling UI repo's .env if
# present, so `make server-real` / real-agent runs work without copying secrets
# into this repo. Override by exporting ANTHROPIC_API_KEY yourself.
UI_ENV := ../cowork-genealogy-ui/.env

.PHONY: help
help: ## Show this menu
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | sort | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Setup ────────────────────────────────────────────────────────
.PHONY: install
install: ## Install JS workspace (pnpm) + Python server deps (uv)
	pnpm install
	$(MAKE) server-install

.PHONY: server-install
server-install: ## Create the server venv and install FastAPI deps (uv)
	cd apps/server && uv sync

# ── Dev (the POC: run these two in two terminals) ────────────────
.PHONY: dev
dev: ## Print how to run the full local POC
	@echo "Run these in two terminals:"
	@echo "  make server     # FastAPI control plane on :8000"
	@echo "  make web        # Vite web client on :5173"

.PHONY: web
web: ## Run the web client (Vite dev server, :5173)
	pnpm --filter web dev

.PHONY: server
server: ## Run the FastAPI control plane (:8000) in MOCK agent mode
	cd apps/server && AGENT_MODE=mock uv run uvicorn app.main:app --reload --port 8000

.PHONY: server-real
server-real: ## Run the control plane with the REAL Claude Agent SDK (uses ANTHROPIC_API_KEY)
	cd apps/server && AGENT_MODE=real \
	  ANTHROPIC_API_KEY="$${ANTHROPIC_API_KEY:-$$(grep -E '^ANTHROPIC_API_KEY=' $(UI_ENV) | cut -d= -f2-)}" \
	  uv run uvicorn app.main:app --reload --port 8000

.PHONY: server-oauth
server-oauth: ## Control plane on 127.0.0.1:1837 for REAL Google + FamilySearch OAuth (keys from apps/server/.env)
	# Forces the local provider + WS relay (E2B has no local runtime; this
	# isolates the OAuth layer). Google keys / AGENT_MODE come from .env;
	# FAMILYSEARCH_WEB_ENABLED is forced on so the UI uses the REAL FS popup, not
	# mock dev-connect (client id from bundled mcp-server/config/familysearch.json).
	cd apps/server && \
	  PUBLIC_URL=http://127.0.0.1:1837 WEB_ORIGIN=http://127.0.0.1:5173 \
	  SANDBOX_PROVIDER=local REALTIME=local_ws FAMILYSEARCH_WEB_ENABLED=true \
	  uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 1837

.PHONY: web-oauth
web-oauth: ## Web client pointed at the :1837 OAuth server (then open http://127.0.0.1:5173)
	VITE_API_TARGET=http://127.0.0.1:1837 pnpm --filter web dev

.PHONY: server-e2b
server-e2b: ## Control plane on 127.0.0.1:1837 with REAL E2B sandboxes + real agent (keys from apps/server/.env)
	# Full live-test path: SANDBOX_PROVIDER=e2b boots the genealogy-agent image's
	# in-sandbox WS server per session; the browser connects to it directly via
	# /connect's {wssUrl, token}. AGENT_MODE/ANTHROPIC_API_KEY are injected into the
	# sandbox. Use `make web-oauth` for the client, open http://127.0.0.1:5173.
	cd apps/server && \
	  PUBLIC_URL=http://127.0.0.1:1837 WEB_ORIGIN=http://127.0.0.1:5173 \
	  SANDBOX_PROVIDER=e2b AGENT_MODE=real REALTIME=local_ws FAMILYSEARCH_WEB_ENABLED=true \
	  uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 1837

.PHONY: electron
electron: ## Run the Electron viewer (consumes the shared viewer-ui)
	pnpm --filter cowork-genealogy-ui dev

# ── Quality / tests ──────────────────────────────────────────────
.PHONY: typecheck
typecheck: ## Typecheck the whole JS workspace (turbo)
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
test-js: ## JS workspace tests — web, electron, viewer-ui, schema (turbo)
	pnpm test

.PHONY: server-test
server-test: ## Control-plane tests — apps/server (FastAPI, pytest)
	cd apps/server && uv run pytest -q

.PHONY: engine-test
engine-test: ## Genealogy engine tests — packages/engine/mcp-server (vitest)
	cd packages/engine/mcp-server && npm test

.PHONY: harness-test
harness-test: ## Eval harness tests — eval/harness (pytest, excludes e2e)
	cd eval/harness && uv run pytest -m 'not e2e' -q

.PHONY: eval-ui-test
eval-ui-test: ## Eval CRUD UI tests — eval/app (vitest)
	cd eval/app && npm test

# ── Artifacts (the existing Cowork/desktop deliverables) ─────────
.PHONY: mcpb
mcpb: ## Build the .mcpb desktop extension
	bash scripts/build-mcpb.sh

.PHONY: plugin
plugin: ## Build the Cowork plugin .zip
	bash scripts/package-plugin.sh

.PHONY: sandbox-image
sandbox-image: ## Build the E2B sandbox template image (for hosted deploy)
	bash apps/server/sandbox/build-image.sh
