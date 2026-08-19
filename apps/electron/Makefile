SAMPLE_PROJECT = test/fixtures/sample-project

# ── Development ─────────────────────────────────────────

dev:                          ## Start dev mode with HMR
	npx electron-vite dev

dev-sample:                   ## Dev mode, auto-open sample project
	npx electron-vite dev -- --project-dir $(SAMPLE_PROJECT)

dev-debug:                    ## Dev mode with CDP on port 9222 (for agent-browser)
	npx electron-vite dev --remoteDebuggingPort 9222

dev-debug-sample:             ## Dev + debug + sample project (full QA setup)
	npx electron-vite dev --remoteDebuggingPort 9222 -- --project-dir $(SAMPLE_PROJECT)

# ── Testing ─────────────────────────────────────────────

test:                         ## Run unit tests
	npx vitest run

test-watch:                   ## Run tests in watch mode
	npx vitest

# ── Quality ─────────────────────────────────────────────

typecheck:                    ## TypeScript type checking (Node + Web)
	npm run typecheck

lint:                         ## ESLint
	npx eslint --cache .

format:                       ## Prettier format all files
	npx prettier --write .

check:                        ## Run typecheck + lint + tests
	npm run typecheck && npx eslint --cache . && npx vitest run

# ── Build ───────────────────────────────────────────────

build:                        ## Production build (typecheck + compile)
	npm run build

# `npm run build:*` now runs check-packaged itself (package.json), so these
# targets inherit the gate rather than repeating it — and so does anyone running
# `pnpm build:mac` straight from the README, which is the invocation #1070 is
# named after and which no make target covers.
#
# `rm -rf dist` first because the check inspects EVERY app.asar under dist/: a
# stale bundle left by an earlier build of a different OS would otherwise fail a
# perfectly good one.
build-linux:                  ## Build Linux AppImage
	rm -rf dist
	npm run build:linux

build-mac:                    ## Build macOS DMG (arm64 + x64)
	rm -rf dist
	npm run build:mac

build-win:                    ## Build Windows NSIS installer
	rm -rf dist
	npm run build:win

check-packaged:               ## Verify the packaged app carries its declared dependencies
	npm run check-packaged

preview:                      ## Preview the production build
	npm start

# ── Agent Browser (QA) ──────────────────────────────────

ab-connect:                   ## Connect agent-browser to running debug app
	agent-browser connect 9222

ab-snapshot:                  ## Take accessibility tree snapshot
	agent-browser snapshot -i

ab-screenshot:                ## Take screenshot of current state
	agent-browser screenshot screenshot-$$(date +%s).png

ab-tabs:                      ## List all targets (windows, webviews)
	agent-browser tab

# ── Utilities ───────────────────────────────────────────

clean:                        ## Remove build artifacts
	rm -rf out dist

help:                         ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-24s\033[0m %s\n", $$1, $$2}'

.PHONY: dev dev-sample dev-debug dev-debug-sample test test-watch typecheck lint format check build build-linux build-mac build-win check-packaged preview ab-connect ab-snapshot ab-screenshot ab-tabs clean help
.DEFAULT_GOAL := help
