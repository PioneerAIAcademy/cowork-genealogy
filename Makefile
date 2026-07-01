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
# present, so `make server-dev` / real-agent runs work without copying secrets
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
# Use `npm ci`: it installs exactly from the lockfile and never rewrites it, so
# builds can't dirty package-lock.json (some npm versions re-normalize the `libc`
# tags on rolldown's optional binaries). It hard-fails if package.json and the
# lockfile drift out of sync — run `npm install` in $(ENGINE_DIR) to re-sync.
$(ENGINE_DEPS): $(ENGINE_DIR)/package.json $(ENGINE_DIR)/package-lock.json
	cd $(ENGINE_DIR) && npm ci
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

# Wipe every node_modules (and the .make-installed stamps inside them) so the
# next install is from scratch. Needed after a Node version change: pnpm/npm
# won't rebuild native modules (vitest/rolldown/esbuild bindings) compiled for
# the old ABI against an unchanged lockfile, so they fail at *test* time. The
# Python venvs are left alone — `uv run` re-syncs them automatically.
.PHONY: clean-deps
clean-deps: ## Remove all node_modules (force a from-scratch install; use after a Node upgrade)
	rm -rf node_modules \
	       packages/*/node_modules \
	       apps/*/node_modules \
	       $(ENGINE_DIR)/node_modules \
	       eval/app/node_modules
	@echo "✓ node_modules removed — run 'make install' (or 'make reinstall')"

# `install` must run as a sub-make AFTER clean-deps, not as a sibling
# prerequisite: make reads the .make-installed stamp timestamps once at startup,
# so a single `reinstall: clean-deps install` would still see the (now-deleted)
# stamps as up-to-date and skip the JS installs. The recursive call re-evaluates
# them post-clean.
.PHONY: reinstall
reinstall: clean-deps ## Clean every node_modules, then install EVERYTHING from scratch (the safe path after a Node upgrade)
	$(MAKE) install

# ── Worktrees ────────────────────────────────────────────────────
# Git worktrees don't share gitignored files, so a freshly-added worktree lacks
# the shared secrets (eval/.env) and installed deps (node_modules). These link
# them to the primary worktree's copies. `install-hooks` makes new worktrees
# self-link on `git worktree add`; `worktree-link` does it for an existing one.
.PHONY: worktree-link
worktree-link: ## Symlink shared gitignored files (secrets, node_modules) from the primary worktree into this one
	@scripts/link-worktree.sh

# Symlink our post-checkout hook into the shared .git/hooks (covers every
# worktree of this clone). Opt-in and per-clone: it touches only local .git
# state, never core.hooksPath, so it can't disable husky/other hook tooling and
# is invisible to teammates who don't run it. Refuses to clobber a pre-existing
# non-symlink hook.
.PHONY: install-hooks
install-hooks: ## Install the post-checkout hook so new worktrees auto-link shared files (opt-in, per-clone)
	@common=$$(git rev-parse --path-format=absolute --git-common-dir); \
	 main=$$(dirname "$$common"); \
	 dst="$$common/hooks/post-checkout"; \
	 if [ -e "$$dst" ] && [ ! -L "$$dst" ]; then \
	   echo "install-hooks: $$dst already exists and is not a symlink — not overwriting. Merge manually." >&2; exit 1; \
	 fi; \
	 mkdir -p "$$common/hooks"; \
	 ln -sfn "$$main/scripts/git-hooks/post-checkout" "$$dst"; \
	 echo "✓ installed post-checkout hook -> $$dst"

# ── Dev (the POC: run a server + a web client in two terminals) ──
# See DEVELOPMENT.md for the full matrix. The web target must match the server's
# port — `web` ↔ :1837 (server / server-e2b, real FamilySearch login), `web-dev`
# ↔ :8000 (server-dev / server-mock, dev-login).
.PHONY: dev
dev: ## Print how to run the full local POC
	@echo "Run these in two terminals (real agent + FamilySearch login; needs keys):"
	@echo "  make server     # FastAPI control plane on :1837"
	@echo "  make web        # Vite web client on :5173"
	@echo "Zero-setup mock path (no keys): make server-mock + make web-dev"

.PHONY: web-dev
web-dev: $(JS_DEPS) ## Web client (dev-login path); proxies /api+WS to :8000 (use with server-dev / server-mock)
	pnpm --filter web dev

.PHONY: server-mock
server-mock: ## MOCK agent, dev-login, local sandboxes, :8000 — zero setup, no keys (web client: make web-dev)
	# Pin the dev-friendly values so a .env kept for server/server-e2b (real FS,
	# SANDBOX_PROVIDER=e2b) doesn't leak into this zero-setup target:
	#  - FAMILYSEARCH_WEB_ENABLED=false → the FS front door is off, so /auth/config
	#    offers dev-login (any email, no allowlist) and the agent runs in mock mode;
	#  - SANDBOX_PROVIDER=local → sessions run locally, no E2B key needed.
	cd apps/server && AGENT_MODE=mock SANDBOX_PROVIDER=local \
	  FAMILYSEARCH_WEB_ENABLED=false \
	  uv run uvicorn app.main:app --reload --port 8000

.PHONY: server-dev
server-dev: $(ENGINE_BUILD) ## REAL agent, dev-login (no FamilySearch), :8000 — needs ANTHROPIC_API_KEY (web client: make web-dev)
	# engine-build prereq: the real agent forks `node <packages/engine/mcp-server/build/index.js>`.
	# Key is sourced from $$ANTHROPIC_API_KEY, else the sibling repo's .env (UI_ENV).
	# Pin the same dev-friendly values as `server-mock` (local provider, dev-login,
	# FS front door off) so .env kept for the server/e2b targets doesn't leak in here.
	cd apps/server && AGENT_MODE=real SANDBOX_PROVIDER=local \
	  FAMILYSEARCH_WEB_ENABLED=false \
	  ANTHROPIC_API_KEY="$${ANTHROPIC_API_KEY:-$$(grep -E '^ANTHROPIC_API_KEY=' $(UI_ENV) | cut -d= -f2-)}" \
	  uv run uvicorn app.main:app --reload --port 8000

.PHONY: server
server: $(ENGINE_BUILD) ## REAL agent + FamilySearch login, local sandboxes, :1837 — the default (web client: make web)
	# Forces the local provider + WS relay (E2B has no local runtime; this isolates
	# the OAuth layer). FAMILYSEARCH_WEB_ENABLED is forced on so FamilySearch is the
	# only app login (no dev-login), with the client id from the bundled
	# packages/engine/mcp-server/config/familysearch.json. The token from that one login is injected
	# into every sandbox this user creates. AGENT_MODE comes from .env; engine-build
	# prereq: with AGENT_MODE=real the agent forks the local engine.
	cd apps/server && \
	  PUBLIC_URL=http://127.0.0.1:1837 WEB_ORIGIN=http://127.0.0.1:5173 \
	  SANDBOX_PROVIDER=local REALTIME=local_ws FAMILYSEARCH_WEB_ENABLED=true \
	  uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 1837

.PHONY: web
web: $(JS_DEPS) ## Web client (FamilySearch path); proxies /api+WS to :1837 (use with server / server-e2b)
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
	@echo "      If you changed the agent (app/agent/*, sandbox_server.py), MCP tools"
	@echo "      (packages/engine/mcp-server/src), or skills (packages/engine/plugin) since your last"
	@echo "      'make sandbox-image', rebuild the image first or the microVM runs STALE code."

.PHONY: server-e2b
server-e2b: e2b-preflight ## E2B sandboxes + REAL agent + FamilySearch login, :1837 (web client: make web)
	# Full live-test path: SANDBOX_PROVIDER=e2b boots the genealogy-agent image's
	# in-sandbox WS server per session; the browser connects to it directly via
	# /connect's {wssUrl, token}. AGENT_MODE/ANTHROPIC_API_KEY are injected into the
	# sandbox. Use `make web` for the client, open http://127.0.0.1:5173.
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

.PHONY: eval-skill
eval-skill: $(ENGINE_BUILD) ## Run the skill eval harness, rebuilding first: make eval-skill SKILL=tree-edit [CONCURRENCY=8]; SKILL="a b c" runs several in one pool
	# $(ENGINE_BUILD) rebuilds packages/engine/mcp-server/build/ only when its
	# source/deps changed, so the harness's "mcp-server build is stale" check
	# (exit 2) passes. A bare --skill run is releasable: writes a v{N}_<ts>.json
	# candidate. uv auto-syncs the harness venv on invocation.
	#
	# SKILL may name several skills (quote them): make eval-skill SKILL="tree-edit timeline".
	# They share one bounded pool — the safe way to cover multiple skills — and
	# each writes its own releasable run log. Do NOT instead launch several
	# `make eval-skill` processes at once; concurrent SDK subprocesses SIGKILL.
	#
	# CONCURRENCY is optional: how many tests run in parallel. Omit it to let
	# the harness pick a RAM-aware default (~1 per 2 GiB, floor 4, cap 8 — a
	# 16 GiB machine resolves to 8). Override for a bigger box or tighter API
	# rate limits, e.g. make eval-skill SKILL=tree-edit CONCURRENCY=8.
	@test -n "$(SKILL)" || { echo "ERROR: set SKILL, e.g. make eval-skill SKILL=tree-edit" >&2; exit 1; }
	cd eval/harness && uv run python run_tests.py --skill $(SKILL) $(if $(CONCURRENCY),--concurrency $(CONCURRENCY),)

.PHONY: eval-timings
eval-timings: ## Weekly timing review: scan the latest run log per skill, rank the slowest tests + flag why (LONG/RETRY/LOCAL?). Read-only. [TOP=20]
	# Reads the timing instrumentation already in the run logs — does NOT
	# re-run anything. Use it to spot makespan long poles and the stall tax
	# week over week. TOP overrides how many slowest tests to list.
	cd eval/harness && uv run python -m scripts.timing_report $(if $(TOP),--top $(TOP),)

.PHONY: optimize-skill
optimize-skill: ## Tune a skill's SKILL.md description from its tests' trigger queries (on-demand; needs claude CLI + network): make optimize-skill SKILL=tree-edit
	# Builds a [{query,should_trigger}] set from the unit-test corpus, then runs the
	# vendored skill-creator run_loop (real `claude -p`, blinded train/test split,
	# best-by-held-out-score). Tunes the DESCRIPTION only — never runs the skill or
	# any MCP tool. NOT in CI (incurs model cost). Apply best_description as a
	# human-reviewed SKILL.md edit. Output (results.json + report.html) lands in
	# eval/runlogs/optimizer/<ts>/. Override the model with MODEL=<id>.
	@test -n "$(SKILL)" || { echo "ERROR: set SKILL, e.g. make optimize-skill SKILL=tree-edit" >&2; exit 1; }
	cd eval/triggering && uv run python build_eval_set.py --skill $(SKILL)
	cd eval/triggering && uv run python -m scripts.run_loop \
	  --eval-set eval_sets/$(SKILL).json \
	  --skill-path ../../packages/engine/plugin/skills/$(SKILL) \
	  --model "$${MODEL:-claude-sonnet-4-6}" --results-dir ../runlogs/optimizer --verbose

.PHONY: e2e-preflight
e2e-preflight: ## Check a machine is ready to run e2e tests (FS login, built server, API key, deps)
	cd eval/harness && uv run python -m e2e.preflight

.PHONY: e2e-login
e2e-login: $(ENGINE_DEPS) ## Log in to FamilySearch (opens a browser; token lasts ~24h, shared by all e2e runs)
	# Runs the same OAuth flow as the `login` MCP tool using the bundled
	# client ID, so you don't have to open a Claude session to log in.
	# Login is host-global and ~24h-lived — a once-per-day act, not per run.
	cd $(ENGINE_DIR) && npx tsx dev/e2e-login.ts

.PHONY: e2e-run
e2e-run: $(ENGINE_BUILD) ## Run ONE e2e benchmark fixture against live FamilySearch (expensive): make e2e-run TEST=kenneth-quass-death
	# $(ENGINE_BUILD) rebuilds the MCP server only when stale. The run hits
	# live FamilySearch (needs `login` first) and the judge needs an
	# ANTHROPIC_API_KEY (shell or eval/.env). Expensive: ~20-60 min, $3-10.
	# Keep the machine awake for the whole run — see eval/README.md "Keep the
	# machine awake" (a sleep inflates real-clock time; the harness flags it).
	# Stall recovery is ON by default; disable with RESUME_ON_STALL=0.
	@test -n "$(TEST)" || { echo "ERROR: set TEST, e.g. make e2e-run TEST=kenneth-quass-death" >&2; exit 1; }
	cd eval/harness && uv run python -m e2e.run_e2e --test $(TEST) $(if $(filter 0 false no off,$(RESUME_ON_STALL)),--no-resume-on-stall,)

.PHONY: e2e-view
e2e-view: ## Load the latest e2e run into the Research Viewer (eval/e2e-view): make e2e-view TEST=kenneth-quass-death
	# Copies the newest run's final tree + research.json into eval/e2e-view/
	# (the shape the viewer opens + live-watches). Open that folder once in
	# the viewer (its Open Project button, or `make electron`); later runs
	# refresh it in place. Cheap + instant — and it picks the newest run, so
	# a failing scratch_ run (what you usually want to inspect) works too.
	@test -n "$(TEST)" || { echo "ERROR: set TEST, e.g. make e2e-view TEST=kenneth-quass-death" >&2; exit 1; }
	cd eval/harness && uv run python -m e2e.view --test $(TEST)

.PHONY: e2e-project
e2e-project: ## Seed an editable Cowork project from a fixture's STARTING state to debug /research live: make e2e-project TEST=kenneth-quass-death
	# Copies the fixture's starting-research.json + starting-tree.gedcomx.json
	# into eval/e2e-project/<slug>/ as research.json + tree.gedcomx.json — a
	# fresh, editable project you open in Claude Cowork to run /research
	# step-by-step (init-project auto-skipped) while watching it live in the
	# Research Viewer. For DEBUGGING the process, NOT scoring: a live run does
	# not block the tree-read tools the headless `make e2e-run` blocks, so the
	# agent can read the answer off the live tree. Re-seed (wiping work) with FORCE=1.
	@test -n "$(TEST)" || { echo "ERROR: set TEST, e.g. make e2e-project TEST=kenneth-quass-death" >&2; exit 1; }
	cd eval/harness && uv run python -m e2e.project --test $(TEST) $(if $(FORCE),--force,)

.PHONY: e2e-validate
e2e-validate: ## Stripping linter for an e2e fixture (or all): make e2e-validate TEST=kenneth-quass-death  (omit TEST for --all)
	cd eval/harness && uv run python -m e2e.validate_fixture $${TEST:---all}

.PHONY: e2e-calibrate
e2e-calibrate: ## Run judge calibration against committed run annotations (maintainer step; needs an API key)
	cd eval/harness && uv run python -m e2e.calibrate_judge

.PHONY: e2e-scratch
e2e-scratch: ## Set up a throwaway dir (outside the repo) to run /research by hand against a fixture: make e2e-scratch TEST=kenneth-quass-death
	# Seeds the fixture's starting state + plugin skills into a sibling dir
	# of the repo (reusing the harness's build_workspace, so it matches a
	# real run byte-for-byte). Prints the /research command to paste in an
	# interactive `claude` session — the way to debug WHY the agent stops.
	@test -n "$(TEST)" || { echo "ERROR: set TEST, e.g. make e2e-scratch TEST=kenneth-quass-death" >&2; exit 1; }
	cd eval/harness && uv run python -m e2e.scratch --test $(TEST) --launch

.PHONY: eval-ui
eval-ui: $(EVAL_APP_DEPS) ## Launch the Eval CRUD UI dev server — eval/app (Next.js, :3000)
	cd eval/app && npm run dev

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

# Marker recording the commit `make sandbox-image` last built the E2B template
# from, so `deploy-preflight` can warn when in-sandbox agent code changed since.
# Gitignored local build state, like the .make-installed dep stamps above.
SANDBOX_IMAGE_STAMP := apps/server/sandbox/.last-image-build
# Developer-edited sources baked into the genealogy-agent E2B image (NOT the Fly
# container): the in-sandbox WS server + agent runner, the MCP tools (engine
# src → compiled build/), and the plugin skills/agents. A change to ANY of these
# means the image is stale until the next `make sandbox-image`.
SANDBOX_IMAGE_SOURCES := apps/server/app/agent apps/server/app/sandbox_server.py packages/engine/mcp-server/src packages/engine/plugin

.PHONY: sandbox-image
sandbox-image: ## Build (and push to E2B) the genealogy-agent sandbox template — the whole deploy of the agent image
	bash apps/server/sandbox/build-image.sh
	@git rev-parse HEAD > $(SANDBOX_IMAGE_STAMP)

# Advisory (a deploy prerequisite, NOT run directly — so no `## ` help line):
# warns, never blocks, when in-sandbox agent code changed since the last
# `make sandbox-image`. The Fly container does NOT bake the agent — it runs on
# the separate E2B `genealogy-agent` image — so a control-plane deploy can ship
# while prod's agent image is stale, with nothing else to flag it. (A hard
# `sandbox-image` prerequisite would be wrong: it's a heavy build+push to E2B,
# referenced by stable name at runtime, with no build-time tie to the Fly image.)
.PHONY: deploy-preflight
deploy-preflight:
	@base=""; [ -f $(SANDBOX_IMAGE_STAMP) ] && base="$$(cat $(SANDBOX_IMAGE_STAMP))"; \
	if [ -n "$$base" ] && git cat-file -e "$$base^{commit}" 2>/dev/null; then \
	  if ! git diff --quiet "$$base" -- $(SANDBOX_IMAGE_SOURCES); then \
	    echo "⚠️  deploy: in-sandbox code (agent / MCP tools / skills) changed since the last 'make sandbox-image':"; \
	    git diff --name-only "$$base" -- $(SANDBOX_IMAGE_SOURCES) | sed 's/^/        /'; \
	    echo "    Prod runs the agent on the E2B 'genealogy-agent' image, NOT this Fly container."; \
	    echo "    Run 'make sandbox-image' first or new sessions run STALE code (advisory)."; \
	  fi; \
	else \
	  echo "⚠️  deploy: no 'make sandbox-image' record on this machine — can't tell if the E2B"; \
	  echo "    'genealogy-agent' image is current. If you changed the agent, MCP tools, or skills,"; \
	  echo "    run 'make sandbox-image' first or new sessions run STALE code (advisory)."; \
	fi

.PHONY: deploy
deploy: deploy-preflight ## Deploy the control plane to Fly (builds web+server image; single always-on machine)
	# Build context is the repo ROOT (the Dockerfile copies the pnpm workspace).
	# --ha=false: fly deploy provisions TWO machines by default; stay at count=1
	# until init_db moves to a release_command (docs/TODOS.md). Secrets +
	# `fly apps create` are one-time (DEVELOPMENT.md § Deploy to Fly.io).
	# NOTE: apps/web/dist is baked at build time — redeploy to ship UI changes.
	fly deploy --config deploy/fly.toml --dockerfile deploy/Dockerfile . --ha=false
