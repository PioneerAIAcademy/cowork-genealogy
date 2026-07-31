#!/usr/bin/env bash
# Run all project test suites. Exits non-zero if any suite fails.
#
# The two npm suites DELEGATE to their Makefile targets instead of invoking
# `npm test` directly. Those targets carry the dependency prerequisites
# ($(ENGINE_DEPS) / $(EVAL_APP_DEPS)), which install-and-stamp before running.
# Calling `npm test` straight — what this script used to do — is what let an
# empty packages/engine/mcp-server/node_modules surface as five cryptic
# TS2307 "Cannot find module" errors instead of "deps not installed", on the
# one command the PR template tells every contributor to run.
#
# The harness suite stays a direct `uv run` — `make harness-test` deliberately
# runs a NARROWER set (`-m 'not e2e'`), so delegating it would silently shrink
# this gate's coverage — but it is preceded by `make engine-build`, because part
# of that suite really does execute the compiled build/ (see below).

set -uo pipefail   # not -e: run every suite, then report all failures together

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
failed=0

# --- preflight ---------------------------------------------------------------
# Name the missing piece up front. Each of these otherwise fails deep inside a
# suite with an error that never mentions which tool is absent.
missing=""
for tool in make npm uv; do
  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "ERROR: required tool(s) not on PATH:$missing" >&2
  echo "  make / npm — see DEVELOPMENT.md 'Build commands'" >&2
  echo "  uv         — https://docs.astral.sh/uv/getting-started/installation/" >&2
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
echo "=== MCP server tests (vitest) ==="
make -C "$ROOT" engine-test || failed=1

echo ""
echo "=== Eval app tests (vitest) ==="
make -C "$ROOT" eval-ui-test || failed=1

echo ""
echo "=== Eval harness tests (pytest) ==="
# The harness's mock MCP server shells out to the COMPILED
# packages/engine/mcp-server/build/ for its live tool handlers, so the build is
# a real dependency of this suite. build/ is gitignored and link-worktree.sh
# does not link it, so a freshly-added worktree has none and the run fails on
# "AssertionError: staging must still happen" — a missing build wearing the
# costume of a code regression. `make engine-build` is a no-op once the build
# is current.
make -C "$ROOT" engine-build || failed=1
(cd "$ROOT/eval/harness" && uv run --frozen pytest) || failed=1

echo ""
if [ "$failed" -ne 0 ]; then
  echo "FAIL: one or more test suites failed"
  exit 1
else
  echo "All test suites passed"
fi
