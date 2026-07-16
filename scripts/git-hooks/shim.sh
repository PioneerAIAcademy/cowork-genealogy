#!/bin/sh
# cowork-genealogy managed hook shim — do not edit.
#
# `make install-hooks` / InstallHooks.bat copies this stub to .git/hooks/<name>
# for each hook we ship. It dispatches on its own filename, so one file serves
# every hook: installed as .git/hooks/commit-msg it runs the tracked
# scripts/git-hooks/commit-msg.
#
# Why a copied stub rather than a symlink to the real hook: Windows file
# symlinks need admin rights or Developer Mode (`mklink /J` junctions sidestep
# that but only work for directories, not files), so a symlink install has no
# Windows counterpart. And why a stub rather than copying the hook itself:
# a copy goes stale — this re-resolves and re-execs the tracked hook on every
# run, so editing scripts/git-hooks/<name> takes effect with no reinstall.
#
# The tracked hooks live in the PRIMARY worktree, so resolve through
# --git-common-dir (shared by every linked worktree) rather than
# --show-toplevel (which is whichever worktree we happen to be in).
#
# The marker comment on line 2 is how the installers recognize their own work
# and refuse to clobber a foreign hook. Keep it.

name=$(basename "$0")
src="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/scripts/git-hooks/$name"

# Absent or non-executable means this branch predates the hook (or someone is
# mid-rebase on an old commit). Stay silent and let the operation through rather
# than failing it.
[ -x "$src" ] || exit 0

exec "$src" "$@"
