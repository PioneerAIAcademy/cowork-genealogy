#!/usr/bin/env bash
# Reset a feedback case directory to the pristine state it was imported in.
#
# Run this between attempts: the agent mutates research.json / tree.gedcomx.json
# / results/ as it works, and a second run on top of a first one is testing
# contaminated state. Contract: docs/specs/feedback-case-spec.md §4.
#
# Deliberately the ONLY thing a triager has to know about restoring a case —
# the git baseline underneath is an implementation detail of
# setup-feedback-case.sh, not something to teach a genealogist.
#
# Safe by construction: `.claude/` (the symlinked-in skills) is gitignored by
# the setup script, so `git clean -fd` leaves it alone; `.feedback-repo-root`
# is committed in the baseline, so it survives too.
#
# Usage: reset-feedback-case.sh [<case-dir>]
#        defaults to the current directory
set -euo pipefail

CASE_DIR="${1:-$PWD}"

if [[ ! -d "$CASE_DIR" ]]; then
  echo "Error: no such directory: $CASE_DIR" >&2
  exit 1
fi

if [[ ! -f "$CASE_DIR/.feedback-repo-root" ]]; then
  echo "Error: $CASE_DIR is not a feedback case directory." >&2
  echo "       (no .feedback-repo-root marker — set one up with 'make feedback-case ZIP=…')" >&2
  exit 1
fi

if ! git -C "$CASE_DIR" rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "Error: $CASE_DIR has no imported baseline to reset to." >&2
  echo "       Re-import it with 'make feedback-case ZIP=… FORCE=1'." >&2
  exit 1
fi

git -C "$CASE_DIR" checkout -- .
git -C "$CASE_DIR" clean -qfd

echo "✓ Reset $CASE_DIR to the state it was imported in."
echo
echo "Next: start a fresh Claude Code session (or /clear), then re-issue the"
echo "      user's prompt. Both halves — data and conversation — have to be"
echo "      fresh or you're testing contaminated state."
