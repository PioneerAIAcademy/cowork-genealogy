#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Packaging Cowork plugin..."
mkdir -p releases
rm -f releases/genealogy-plugin.zip
cd packages/engine/plugin
# The e2e-benchmark skills (author-e2e-fixture, interpret-e2e-result) are tooling
# for the internal genealogist+developer benchmark teams — they operate on the
# eval test corpus, not a researcher's project — so they are NOT shipped in the
# Cowork plugin. See docs/plan/e2e-skills.md.
zip -r ../../../releases/genealogy-plugin.zip \
  .claude-plugin/ \
  agents/ \
  skills/ \
  -x 'skills/author-e2e-fixture/*' \
  -x 'skills/interpret-e2e-result/*'
cd ..

echo "Done. Created releases/genealogy-plugin.zip"
