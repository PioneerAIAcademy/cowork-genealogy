#!/usr/bin/env bash
set -euo pipefail

# Builds the E2B sandbox template image ("genealogy-agent") for the hosted
# workbench. Two phases:
#   1. Compile the genealogy engine so packages/engine/mcp-server/build/ exists in the build
#      context (the Dockerfile COPYs build/ + config/ + manifests, then runs a
#      clean `npm ci --omit=dev` for the prod node_modules).
#   2. Run `e2b template create` (the v2 build system) from the REPO ROOT (the
#      Dockerfile's build context). Template settings (start_cmd, cpu, memory)
#      are passed as flags; apps/server/sandbox/e2b.toml is no longer read.
#
# Invoked by `make sandbox-image`. Requires:
#   - node + npm           (phase 1)
#   - the e2b CLI          (phase 2; `npm i -g @e2b/cli`)
#   - E2B_API_KEY in env   (phase 2; create an E2B account, then
#                           `export E2B_API_KEY=...`). No build/push is possible
#                           without it — that is expected.

# Resolve repo root from this script's location (apps/server/sandbox/ -> repo).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${ROOT}"

# Auto-load apps/server/.env — the established home for these keys (the same file
# e2b-preflight checks and pydantic reads for `make server-e2b`). Saves a manual
# `export`/`source`. E2B_API_KEY authenticates both the template build (e2b CLI,
# v2 build system) and the control plane at runtime — one key, living here.
# (E2B_ACCESS_TOKEN is no longer used; v1 access tokens are deprecated.)
ENV_FILE="${ROOT}/apps/server/.env"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
fi

echo "==> [1/2] Building the genealogy engine (mcp-server)..."
# corepack enable/prepare: use the npm pinned in package.json (packageManager).
# The engine's .npmrc sets engine-strict, so an older bundled npm would fail the
# >=11.12 engines bound.
( cd "${ROOT}/packages/engine/mcp-server" && corepack enable && corepack prepare --activate && npm install && npm run build )
test -f "${ROOT}/packages/engine/mcp-server/build/index.js" \
  || { echo "ERROR: packages/engine/mcp-server/build/index.js missing after build." >&2; exit 1; }

echo "==> [2/2] Building the E2B template (genealogy-agent)..."
if ! command -v e2b >/dev/null 2>&1; then
  echo "ERROR: the 'e2b' CLI is not installed. Install it with:" >&2
  echo "         npm install -g @e2b/cli" >&2
  exit 1
fi
if [[ -z "${E2B_API_KEY:-}" ]]; then
  echo "ERROR: E2B_API_KEY is not set. Create an E2B account, then:" >&2
  echo "         export E2B_API_KEY=e2b_..." >&2
  echo "       (Until then the engine is built but the template is not pushed.)" >&2
  exit 1
fi

# Build context is the repo root; the Dockerfile lives under apps/server/sandbox/.
# `e2b template create` (v2) rebuilds the template in place by name — the stable
# name "genealogy-agent" keeps the same template id, so the runtime E2BProvider
# (which resolves by name) is unaffected. The start_cmd / cpu / memory that used
# to live in e2b.toml are passed as flags below (the toml is no longer read).
#
# v2 requires BOTH a start command and a ready command. --cmd keeps the VM warm
# doing nothing (the control plane launches the agent_runner per session, not at
# template boot); --ready-cmd just needs to exit 0, and `true` means "ready as
# soon as the VM boots" since there is no in-template service to wait on.
e2b template create "genealogy-agent" \
  --path "${ROOT}" \
  --dockerfile "apps/server/sandbox/e2b.Dockerfile" \
  --cmd "tail -f /dev/null" \
  --ready-cmd "true" \
  --cpu-count 2 \
  --memory-mb 2048

echo
echo "Done. Template 'genealogy-agent' built."
echo "Set SANDBOX_PROVIDER=e2b and E2B_API_KEY on the control plane to use it."
