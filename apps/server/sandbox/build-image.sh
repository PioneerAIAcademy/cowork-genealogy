#!/usr/bin/env bash
set -euo pipefail

# Builds the E2B sandbox template image (default name "genealogy-agent") for the
# hosted workbench. Two phases:
#   1. Compile the genealogy engine so packages/engine/mcp-server/build/ exists in the build
#      context (the Dockerfile COPYs build/ + config/ + manifests, then runs a
#      clean `npm ci --omit=dev` for the prod node_modules).
#   2. Run `e2b template create` (the v2 build system) from the REPO ROOT (the
#      Dockerfile's build context). Template settings (start_cmd, cpu, memory)
#      are passed as flags; apps/server/sandbox/e2b.toml is no longer read.
#
# Invoked by `make sandbox-image`, and by `make deploy`, which builds this image
# as part of the deploy so the control plane and the sandbox ship together.
# Requires:
#   - node + npm           (phase 1)
#   - the e2b CLI          (phase 2; `npm i -g @e2b/cli`)
#   - E2B_API_KEY in env   (phase 2; create an E2B account, then
#                           `export E2B_API_KEY=...`). No build/push is possible
#                           without it — that is expected.
#
# E2B_TEMPLATE_NAME selects which template is rebuilt; it defaults to the
# production name. `e2b template create` rebuilds a template IN PLACE by name, so
# building from a branch without setting this publishes that branch's skills,
# agents and MCP build to every hosted session. Verify against a dev template:
#   E2B_TEMPLATE_NAME=genealogy-agent-dev make sandbox-image

# Resolve repo root from this script's location (apps/server/sandbox/ -> repo).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${ROOT}"

# Auto-load apps/server/.env — the established home for these keys (the same file
# e2b-preflight checks and pydantic reads for `make server-e2b`). Saves a manual
# `export`/`source`. E2B_API_KEY authenticates both the template build (e2b CLI,
# v2 build system) and the control plane at runtime — one key, living here.
# (E2B_ACCESS_TOKEN is no longer used; v1 access tokens are deprecated.)
#
# The caller's E2B_TEMPLATE_NAME is captured first and restored after, so it wins
# over the .env file. `set -a; source` ASSIGNS, which overwrites an already
# exported value — without this, `E2B_TEMPLATE_NAME=genealogy-agent-dev make
# sandbox-image` would silently build whatever .env named, and the one guard
# standing between a branch and production's template would be the weaker of the
# two values rather than the explicit one.
_caller_template="${E2B_TEMPLATE_NAME:-}"
ENV_FILE="${ROOT}/apps/server/.env"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
fi
if [[ -n "${_caller_template}" ]]; then
  E2B_TEMPLATE_NAME="${_caller_template}"
fi
E2B_TEMPLATE_NAME="${E2B_TEMPLATE_NAME:-genealogy-agent}"

# Preconditions checked BEFORE phase 1. Both are hard dependencies of `make
# deploy` now, and phase 1 is a full `npm install && npm run build` — failing on
# a one-line precondition after paying for that (and, under `make deploy`, after
# the stage-1 docker replay) wastes minutes on an unprovisioned machine.
if ! command -v e2b >/dev/null 2>&1; then
  echo "ERROR: the 'e2b' CLI is not installed. Install it with:" >&2
  echo "         npm install -g @e2b/cli" >&2
  exit 1
fi
if [[ -z "${E2B_API_KEY:-}" ]]; then
  echo "ERROR: E2B_API_KEY is not set. Create an E2B account, then:" >&2
  echo "         export E2B_API_KEY=e2b_..." >&2
  exit 1
fi

echo "==> [1/2] Building the genealogy engine (mcp-server)..."
# Requires npm >=11.12 (engine-strict in the engine's .npmrc enforces it). If this
# hard-fails with EBADENGINE, upgrade: npm i -g npm@<version from packageManager>.
( cd "${ROOT}/packages/engine/mcp-server" && npm install && npm run build )
test -f "${ROOT}/packages/engine/mcp-server/build/index.js" \
  || { echo "ERROR: packages/engine/mcp-server/build/index.js missing after build." >&2; exit 1; }

echo "==> [2/2] Building the E2B template (${E2B_TEMPLATE_NAME})..."
# ── Provenance: what this image was built FROM ────────────────────────────────
# Baked into the image (e2b.Dockerfile's last COPY) and read back once per
# sandbox create by E2BProvider, which reports it on /api/health. Without it
# there is no way to ask a running system which build it is on: the template is
# referenced by a stable name, `e2b template list` returns a build timestamp
# rather than a commit, and GIT_SHA/BUILD_DATE describe the OTHER (Fly) image.
#
# The dirty flag is not decoration. The image is built from the WORKING TREE, so
# `git rev-parse HEAD` names a commit that may not be what was baked; a clean sha
# claimed for an image built over uncommitted skill edits is worse than no sha.
# Computed BEFORE the file is written so the artifact cannot make itself dirty
# (it is gitignored too, and --porcelain omits ignored files, so this is
# belt-and-braces).
#
# Never fails the build: no git, no .git, or a repo with no commits all yield
# "dev". `git rev-parse HEAD` in a repo with no commits prints "HEAD" on STDOUT
# and exits non-zero, so the exit status alone is not enough to reject it — hence
# the hex test rather than a bare `|| echo dev`, which would bake the literal
# two-line string "HEAD\ndev" and produce invalid JSON.
PROVENANCE_FILE="${ROOT}/apps/server/sandbox/build-provenance.json"
# Retired by the same change that added this file: `.last-image-build` was the
# gitignored stamp the old staleness check compared against, and its ignore rule
# is gone. It still exists on every machine that ever ran `make sandbox-image` --
# i.e. exactly whoever built production's image -- where it would now show up as
# an untracked file and mark EVERY build dirty from a leftover that has nothing
# to do with the image. Removed rather than re-ignored: nothing writes it now.
rm -f "${ROOT}/apps/server/sandbox/.last-image-build"
_commit="$(git rev-parse HEAD 2>/dev/null)" || _commit=""
case "${_commit}" in
  "" | *[!0-9a-f]*) _commit="dev" ;;
esac
_dirty=false
if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
  _dirty=true
fi
printf '{"commit": "%s", "dirty": %s, "built_at": "%s"}\n' \
  "${_commit}" "${_dirty}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${PROVENANCE_FILE}"
echo "    provenance: commit=${_commit} dirty=${_dirty}"

# Build context is the repo root; the Dockerfile lives under apps/server/sandbox/.
# `e2b template create` (v2) rebuilds the template in place by name — a stable
# name keeps the same template id, so the runtime E2BProvider (which resolves by
# name) is unaffected. The start_cmd / cpu / memory that used to live in e2b.toml
# are passed as flags below (the toml is no longer read).
#
# v2 requires BOTH a start command and a ready command. --cmd keeps the VM warm
# doing nothing (the control plane launches the agent_runner per session, not at
# template boot); --ready-cmd just needs to exit 0, and `true` means "ready as
# soon as the VM boots" since there is no in-template service to wait on.
e2b template create "${E2B_TEMPLATE_NAME}" \
  --path "${ROOT}" \
  --dockerfile "apps/server/sandbox/e2b.Dockerfile" \
  --cmd "tail -f /dev/null" \
  --ready-cmd "true" \
  --cpu-count 2 \
  --memory-mb 2048

echo
echo "Done. Template '${E2B_TEMPLATE_NAME}' built from ${_commit}$([ "${_dirty}" = true ] && echo ' (DIRTY TREE)')."
echo "Set SANDBOX_PROVIDER=e2b and E2B_API_KEY on the control plane to use it."
