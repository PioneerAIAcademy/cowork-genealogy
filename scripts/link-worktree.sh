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
  # An EMPTY directory in the primary is worse than a missing one: it exists,
  # so it links cleanly, and every worktree then inherits an unusable
  # node_modules that fails as `TS2307 Cannot find module` rather than as
  # "deps not installed". `npm ci` deletes node_modules before repopulating it,
  # so any interrupted install leaves exactly this state — and because the link
  # is shared, one broken primary silently breaks every worktree at once.
  # Refuse to link it and name the fix instead.
  #
  # Deliberately plain `ls`, NOT `ls -A`: npm writes `.package-lock.json` into
  # node_modules early in the install, so a half-installed directory contains
  # that one dotfile and nothing else. `ls -A` sees it and reads the directory
  # as populated — which is the exact live state this guard was written for.
  # Only a non-hidden entry (a real package, or an `@scope` dir) counts.
  if [ -d "$src" ] && [ -z "$(ls "$src/" 2>/dev/null)" ]; then
    echo "link-worktree: SKIPPING $rel — it exists in the primary worktree but is EMPTY."
    echo "link-worktree:   Run 'make install' in $main to populate it, then re-run"
    echo "link-worktree:   'make worktree-link' here."
    continue
  fi
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then   # real file/dir already here → keep
    # …unless it is a directory holding nothing but vite/vitest cache dirs.
    # A bare `npx vitest` run before this script ever linked node_modules
    # creates node_modules/.vite (and .vite-temp) in an otherwise-unpopulated
    # directory — and treating that as "a real install this worktree owns"
    # blocks the symlink on every future run, silently (broke two worktrees
    # on 2026-08-02: their tests then resolved deps from the primary's hoisted
    # ROOT node_modules, which lacks the engine's deps). `ls -A` deliberately,
    # unlike the source-side guard above: here the dotfile entries are exactly
    # what we need to see.
    if [ -d "$dst" ] && ! ls -A "$dst" 2>/dev/null | grep -qv -e '^\.vite$' -e '^\.vite-temp$'; then
      echo "link-worktree: replacing $rel — contains only .vite/.vite-temp caches"
      rm -rf "$dst"
    else
      echo "link-worktree: keeping existing $rel (not a symlink)"
      continue
    fi
  fi
  mkdir -p "$(dirname "$dst")"
  ln -sfn "$src" "$dst"
  echo "link-worktree: linked $rel -> $src"
  linked=$((linked + 1))
done
echo "link-worktree: done ($linked linked) in $here"
