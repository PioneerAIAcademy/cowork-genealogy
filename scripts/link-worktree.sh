#!/bin/sh
# Symlink shared, gitignored dev files from the primary worktree into the
# current linked worktree.
#
# Git worktrees deliberately do NOT share the working tree, so per-worktree
# secrets (eval/.env, apps/server/.env) and installed deps (node_modules) are
# absent in a freshly-added worktree. This links them to the primary worktree's
# copies: one source of truth, nothing copied, no secrets in the environment.
#
# Idempotent and safe to re-run. A no-op in the primary worktree. Run by hand
# (`make worktree-link`) or automatically from the post-checkout hook that
# `make install-hooks` installs.
set -eu

# Files/dirs to link, repo-relative. A path missing in the primary worktree is
# skipped; a real (non-symlink) file already present here is left untouched, so
# a worktree can still hold its own override.
SHARED_PATHS='
eval/.env
apps/server/.env
packages/engine/mcp-server/node_modules
'

common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || {
  echo "link-worktree: not inside a git repository" >&2
  exit 1
}
# The primary worktree is the parent of the shared common .git directory.
main=$(dirname "$common")
here=$(git rev-parse --show-toplevel)

if [ "$main" = "$here" ]; then
  echo "link-worktree: in the primary worktree ($here) — nothing to link."
  exit 0
fi

linked=0
for rel in $SHARED_PATHS; do
  src="$main/$rel"
  dst="$here/$rel"
  [ -e "$src" ] || continue                  # primary doesn't have it → skip
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then   # real file/dir already here → keep
    echo "link-worktree: keeping existing $rel (not a symlink)"
    continue
  fi
  mkdir -p "$(dirname "$dst")"
  ln -sfn "$src" "$dst"
  echo "link-worktree: linked $rel -> $src"
  linked=$((linked + 1))
done
echo "link-worktree: done ($linked linked) in $here"
