#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Packaging Cowork plugin..."
mkdir -p releases
cd plugin
zip -r ../releases/genealogy-plugin.zip \
  .claude-plugin/ \
  skills/ \
  commands/
cd ..

echo "Done. Created releases/genealogy-plugin.zip"
