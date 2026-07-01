#!/usr/bin/env bash
set -euo pipefail

# Builds the Claude Desktop extension at releases/genealogy-mcp.mcpb.
# Contract: docs/specs/mcpb-package-spec.md.
#
# We pack a staged, production-only copy of packages/engine/mcp-server/ (not the dev tree)
# so the bundle ships compiled JS + prod deps only — never devDependencies
# (typescript, vitest, @anthropic-ai/mcpb) or TypeScript source.

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/releases/genealogy-mcp.mcpb"

echo "Building MCP server..."
cd "$ROOT/packages/engine/mcp-server"
# Requires npm >=11.12 (engine-strict in .npmrc enforces it). If this hard-fails
# with EBADENGINE, upgrade: npm i -g npm@<version from packageManager in package.json>.
npm install
npm run build

echo "Staging production-only tree..."
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp manifest.json package.json package-lock.json .mcpbignore "$STAGE/"
cp -R build config "$STAGE/"

echo "Installing production dependencies into the stage..."
( cd "$STAGE" && npm ci --omit=dev --ignore-scripts )

echo "Validating manifest..."
npx mcpb validate "$STAGE"

echo "Packing .mcpb..."
mkdir -p "$ROOT/releases"
npx mcpb pack "$STAGE" "$OUT"

echo
npx mcpb info "$OUT"
echo
echo "Done. Created $OUT"
echo "Verify it with: ./scripts/verify-mcpb.sh"
