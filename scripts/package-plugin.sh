#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# Gate: validate skill + agent frontmatter (description <=1024 chars, no angle
# brackets, valid name) BEFORE building a zip Cowork would reject at install
# time. Same check the CI gate runs (.github/workflows/check-runlogs.yml). It
# is stdlib-only, so plain python3 — no uv. A hard violation exits non-zero and
# `set -e` aborts the build here. Best-effort: if python3 is somehow absent we
# warn and continue, since CI still enforces it.
if command -v python3 >/dev/null 2>&1; then
  echo "Validating skill + agent frontmatter..."
  python3 "$ROOT/eval/harness/scripts/check_skill_frontmatter.py"
else
  echo "WARNING: python3 not found — skipping plugin frontmatter validation (CI still enforces it)." >&2
fi

echo "Packaging Cowork plugin..."
mkdir -p releases
rm -f releases/genealogy-plugin.zip
cd packages/engine/plugin
zip -r ../../../releases/genealogy-plugin.zip \
  .claude-plugin/ \
  agents/ \
  skills/
cd ..

echo "Done. Created releases/genealogy-plugin.zip"
