#!/usr/bin/env bash
# Shim. The build logic moved to Node (scripts/build-mcpb.mjs) so it runs on
# Windows without bash. This wrapper keeps `./scripts/build-mcpb.sh` working on
# macOS/Linux for existing docs and muscle memory; `make mcpb` and the Windows
# BuildMcpb.bat call node directly. The .mjs is the single source of truth.
exec node "$(dirname "$0")/build-mcpb.mjs" "$@"
