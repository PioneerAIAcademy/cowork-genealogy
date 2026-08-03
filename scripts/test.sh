#!/usr/bin/env bash
# Run every check in the repo. Exits non-zero if any suite fails.
#
# THIS IS THE SUPERSET. `make test-all` delegates here, and the PR template
# names it. Nothing else needs running before a PR.
#
# The suites DELEGATE to their Makefile targets instead of invoking `npm test` /
# `pnpm test` directly. Those targets carry the dependency prerequisites
# ($(JS_DEPS) / $(ENGINE_DEPS) / $(EVAL_APP_DEPS)), which install-and-stamp
# before running. Calling the package manager straight — what this script used
# to do — is what let an empty packages/engine/mcp-server/node_modules surface
# as five cryptic TS2307 "Cannot find module" errors instead of "deps not
# installed".
#
# Every suite here is deterministic, offline, and free. Nothing in this gate
# calls a model. That is a property to preserve: this script's whole value is
# that it is cheap enough to run on every change, and a single billed
# end-to-end test used to cost more wall-clock than all 1500+ other tests
# combined, which is how a pre-PR gate stops being run at all.

set -uo pipefail   # not -e: run every suite, then report all failures together

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
failed=0

run_suite() {  # run_suite <label> <cmd...>
  local label="$1"; shift
  echo ""
  echo "=== $label ==="
  "$@" || failed=1
}

# --- preflight ---------------------------------------------------------------
# Name the missing piece up front. Each of these otherwise fails deep inside a
# suite with an error that never mentions which tool is absent.
missing=""
for tool in make npm pnpm uv; do
  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "ERROR: required tool(s) not on PATH:$missing" >&2
  echo "  make / npm / pnpm — see DEVELOPMENT.md 'Build commands'" >&2
  echo "  uv                — https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi

# In a linked worktree, packages/engine/mcp-server/node_modules is a SYMLINK to
# the primary worktree's copy (scripts/link-worktree.sh). A dependency install
# triggered from here therefore writes THROUGH the link into the primary, where
# every other worktree shares it. That is the intended design — one install for
# all worktrees — but say it out loud, because `npm ci` deletes the directory
# before repopulating it, so an install interrupted here leaves the primary and
# every sibling worktree with an empty node_modules.
#
# Plain `ls`, not `ls -A`, on purpose: npm writes `.package-lock.json` into
# node_modules early in the install, so a half-installed directory holds that
# lone dotfile and no packages. `ls -A` would read it as populated.
engine_modules="$ROOT/packages/engine/mcp-server/node_modules"
if [ -L "$engine_modules" ] && [ -z "$(ls "$engine_modules/" 2>/dev/null)" ]; then
  echo "NOTE: the engine's node_modules is a symlink to the primary worktree, and is empty."
  echo "      Installing now writes into $(readlink "$engine_modules"),"
  echo "      which every worktree shares. Let it finish — interrupting it leaves"
  echo "      the primary worktree broken too."
  echo ""
fi

# --- suites ------------------------------------------------------------------
# typecheck first: turbo.json defines `test` and `typecheck` as separate tasks,
# so no test suite ever runs tsc. It costs seconds.
run_suite "Typecheck (turbo)"            make -C "$ROOT" typecheck
run_suite "JS workspace tests (turbo)"   make -C "$ROOT" test-js
run_suite "Control-plane tests (pytest)" make -C "$ROOT" server-test
run_suite "MCP server tests (vitest)"    make -C "$ROOT" engine-test
run_suite "Eval app tests (vitest)"      make -C "$ROOT" eval-ui-test

# harness-test carries the $(ENGINE_BUILD) prerequisite, and that build is a
# real dependency: the harness's mock MCP server shells out to the COMPILED
# packages/engine/mcp-server/build/ for its live tool handlers. build/ is
# gitignored and link-worktree.sh does not link it, so a freshly-added worktree
# has none and the run fails on "AssertionError: staging must still happen" — a
# missing build wearing the costume of a code regression.
run_suite "Eval harness tests (pytest)"  make -C "$ROOT" harness-test

echo ""
if [ "$failed" -ne 0 ]; then
  echo "FAIL: one or more suites failed"
  exit 1
else
  echo "All checks passed"
fi
