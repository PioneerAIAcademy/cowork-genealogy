#!/usr/bin/env bash
set -euo pipefail

# Builds the E2B sandbox template image ("genealogy-agent") for the hosted
# workbench. Two phases:
#   1. Compile the genealogy engine so packages/engine/mcp-server/build/ exists in the build
#      context (the Dockerfile COPYs build/ + config/ + manifests, then runs a
#      clean `npm ci --omit=dev` for the prod node_modules).
#   2. Run `e2b template build` from the REPO ROOT (the Dockerfile's build
#      context), using apps/server/sandbox/e2b.toml.
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

echo "==> [1/2] Building the genealogy engine (mcp-server)..."
( cd "${ROOT}/packages/engine/mcp-server" && npm install && npm run build )
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

# Build context is the repo root; the config + Dockerfile path live under
# apps/server/sandbox/. The e2b CLI reads dockerfile / start_cmd / resources
# from the toml; we also pass --name explicitly so the stable template name is
# applied even on a first build (before a template_id is written back).
e2b template build \
  --config "apps/server/sandbox/e2b.toml" \
  --name "genealogy-agent" \
  --path "${ROOT}"

echo
echo "Done. Template 'genealogy-agent' built."
echo "Set SANDBOX_PROVIDER=e2b and E2B_API_KEY on the control plane to use it."
