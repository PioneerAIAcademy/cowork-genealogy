#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

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
