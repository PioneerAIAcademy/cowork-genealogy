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

.PHONY: electron
electron: ## Run the Electron viewer (consumes the shared viewer-ui)
	pnpm --filter cowork-genealogy-ui dev

# ── Quality ──────────────────────────────────────────────────────
.PHONY: typecheck
typecheck: ## Typecheck the whole JS workspace (turbo)
	pnpm typecheck

.PHONY: test
test: ## Run JS workspace tests (turbo) + server tests
	pnpm test
	$(MAKE) server-test

.PHONY: server-test
server-test: ## Run the FastAPI control-plane tests
	cd apps/server && uv run pytest -q

.PHONY: engine-test
engine-test: ## Run the genealogy engine (MCP server) tests
	cd mcp-server && npm test

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
