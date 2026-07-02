#!/usr/bin/env bash
# Shim. The packaging logic moved to Node (scripts/package-plugin.mjs) so it
# runs on Windows without bash or a `zip` binary. This wrapper keeps
# `./scripts/package-plugin.sh` working on macOS/Linux for existing docs and
# muscle memory; `make plugin` and the Windows BuildPlugin.bat call node
# directly. The .mjs is the single source of truth (it also runs the same
# frontmatter validation gate before zipping).
exec node "$(dirname "$0")/package-plugin.mjs" "$@"
