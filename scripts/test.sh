#!/usr/bin/env bash
# Run all project test suites. Exits non-zero if any suite fails.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
failed=0

echo "=== MCP server tests (vitest) ==="
(cd "$ROOT/mcp-server" && npm test) || failed=1

echo ""
echo "=== Eval app tests (vitest) ==="
(cd "$ROOT/eval/app" && npm test) || failed=1

echo ""
echo "=== Eval harness tests (pytest) ==="
(cd "$ROOT/eval/harness" && uv run pytest) || failed=1

echo ""
if [ "$failed" -ne 0 ]; then
  echo "FAIL: one or more test suites failed"
  exit 1
else
  echo "All test suites passed"
fi
