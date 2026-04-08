#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Building MCP server..."
cd mcp-server
npm install
npm run build
cd ..

echo "Packaging .mcpb..."
mkdir -p releases
cd mcp-server
zip -r ../releases/genealogy-mcp.mcpb \
  manifest.json \
  package.json \
  build/ \
  node_modules/
cd ..

echo "Done. Created releases/genealogy-mcp.mcpb"
