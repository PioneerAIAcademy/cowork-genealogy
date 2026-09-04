#!/usr/bin/env bash
# Set up a feedback case directory from a submitted zip.
# Contract: docs/specs/feedback-case-spec.md §3.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: setup-feedback-case.sh <path-to-feedback.zip> [<dest-dir>] [--force]

Unzips a feedback submission into a case directory, initializes a git
baseline, writes .feedback-repo-root, wires per-skill symlinks, and
prints the user's prompt for first-paste.

Arguments:
  <path-to-feedback.zip>  The zip file downloaded from the feedback Drive.
  <dest-dir>              Optional. Default: ~/feedback/<slug>/ where
                          <slug> is the zip basename without `.zip`.
  --force                 Overwrite an existing non-empty dest-dir.

See docs/specs/feedback-case-spec.md §3 for the full contract.
EOF
}

# --- Parse args ---
FORCE=0
ZIP_PATH=""
DEST_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) echo "Unknown flag: $1" >&2; usage >&2; exit 2 ;;
    *)
      if [[ -z "$ZIP_PATH" ]]; then
        ZIP_PATH="$1"
      elif [[ -z "$DEST_DIR" ]]; then
        DEST_DIR="$1"
      else
        echo "Too many positional arguments" >&2; usage >&2; exit 2
      fi
      shift
      ;;
  esac
done

if [[ -z "$ZIP_PATH" ]]; then usage >&2; exit 2; fi
if [[ ! -f "$ZIP_PATH" ]]; then
  echo "Error: zip not found: $ZIP_PATH" >&2
  exit 1
fi

# --- Resolve repo root from script location ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! REPO_ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "Error: could not determine repo root from $SCRIPT_DIR" >&2
  echo "This script must live inside the repo checkout; the cwd is irrelevant." >&2
  exit 1
fi

# --- Derive slug ---
ZIP_BASENAME="$(basename "$ZIP_PATH")"
SLUG="${ZIP_BASENAME%.zip}"

# --- Resolve dest dir ---
if [[ -z "$DEST_DIR" ]]; then
  DEST_DIR="$HOME/feedback/$SLUG"
fi

# --- Refuse to overwrite non-empty dest dir (unless --force) ---
if [[ -e "$DEST_DIR" ]] && [[ -n "$(ls -A "$DEST_DIR" 2>/dev/null || true)" ]]; then
  if [[ "$FORCE" -eq 0 ]]; then
    echo "Error: $DEST_DIR exists and is non-empty." >&2
    echo "Pass --force to overwrite, or investigate manually." >&2
    exit 1
  fi
  echo "--force: removing existing $DEST_DIR"
  rm -rf "$DEST_DIR"
fi

# --- Unzip ---
# unzip exits 1 for warnings that still extracted everything, and a zip
# submitted from Windows stores backslash path separators — exactly such a
# warning ("appears to use backslashes as path separators"). Under `set -e`
# that aborted here on every win32 submission, after extraction but before the
# marker file, the git baseline and the skill symlinks, and with no output at
# all. Fail only on a real error (>= 2).
#
# But exit 1 is NOT only that warning: Info-ZIP returns it equally for
# "zipfiles where one or more files was skipped due to unsupported compression
# method or encryption with an unknown password". Accepting 1 blind would let a
# partially-extracted case through to the git baseline and the symlinks with no
# error at all, so the contents are verified below rather than inferred from the
# exit code.
mkdir -p "$DEST_DIR"
UNZIP_STATUS=0
unzip -q "$ZIP_PATH" -d "$DEST_DIR" || UNZIP_STATUS=$?
if [[ "$UNZIP_STATUS" -ge 2 ]]; then
  echo "Error: unzip failed (exit $UNZIP_STATUS): $ZIP_PATH" >&2
  exit 1
fi

# --- Verify the bundle actually landed ---
# apps/electron/docs/feedback-json-spec.md guarantees all three in every
# submission: the two project files at the zip root, and the report.
MISSING=()
for required in research.json tree.gedcomx.json _feedback/feedback.json; do
  [[ -f "$DEST_DIR/$required" ]] || MISSING+=("$required")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "Error: extraction incomplete — missing: ${MISSING[*]}" >&2
  if [[ "$UNZIP_STATUS" -eq 1 ]]; then
    echo "unzip exited 1, which also covers members skipped for an unsupported" >&2
    echo "compression method or unknown password. Re-download the zip." >&2
  fi
  exit 1
fi

# --- Write .feedback-repo-root ---
echo "$REPO_ROOT" > "$DEST_DIR/.feedback-repo-root"

# --- Update .gitignore (append-if-missing) ---
cd "$DEST_DIR"
if [[ -f .gitignore ]]; then
  if ! grep -qxF '.claude/' .gitignore; then
    echo '.claude/' >> .gitignore
  fi
else
  echo '.claude/' > .gitignore
fi

# --- git init + initial commit ---
git init -q
git add .
git commit -q -m "imported"

# --- Per-skill symlinks under .claude/skills/ ---
mkdir -p .claude/skills
shopt -s nullglob
for d in "$REPO_ROOT"/packages/engine/plugin/skills/*/; do
  name="$(basename "$d")"
  ln -s "$d" ".claude/skills/$name"
done
for d in "$REPO_ROOT"/.claude/skills/*/; do
  name="$(basename "$d")"
  ln -s "$d" ".claude/skills/$name"
done
shopt -u nullglob

# --- Extract user_prompt for next-steps printout ---
USER_PROMPT=""
FB_JSON="$DEST_DIR/_feedback/feedback.json"
if [[ -f "$FB_JSON" ]]; then
  if command -v jq >/dev/null 2>&1; then
    USER_PROMPT="$(jq -r '.user_prompt // empty' "$FB_JSON" 2>/dev/null || true)"
  fi
  # Try python3 then python. On Windows, `command -v python3` succeeds even with
  # no usable interpreter: Windows ships an App Execution Alias stub at
  # AppData/Local/Microsoft/WindowsApps/python3 that exists but fails when run
  # (it exists to launch the Store). Probing only python3 therefore reports
  # success, the run fails, and the prompt silently degrades to the
  # "see feedback.json" fallback. Git for Windows installs expose the real
  # interpreter as `python`.
  #
  # Take the output only when the interpreter exited 0. That stub prints its
  # Store message and exits nonzero, and on some Windows builds the message
  # lands on stdout — so trusting a failed run's stdout would print the advert
  # under "User's prompt to issue first:" for the genealogist to paste.
  for PY in python3 python; do
    if [[ -n "$USER_PROMPT" ]]; then break; fi
    if command -v "$PY" >/dev/null 2>&1; then
      if PY_OUT="$("$PY" -c "import json,sys
try:
    print(json.load(open(sys.argv[1], encoding='utf-8')).get('user_prompt',''))
except Exception:
    pass" "$FB_JSON" 2>/dev/null)"; then
        USER_PROMPT="$PY_OUT"
      fi
    fi
  done
fi

# --- Print "next steps" ---
echo
echo "✓ Imported to $DEST_DIR"
echo
echo "Next steps:"
echo "  cd $DEST_DIR"
echo "  claude"
echo

if [[ -n "$USER_PROMPT" ]]; then
  echo "User's prompt to issue first:"
  echo "─────────────────────────────────────────────"
  printf '%s\n' "$USER_PROMPT"
  echo "─────────────────────────────────────────────"
else
  echo "User's prompt: see $DEST_DIR/_feedback/feedback.json (user_prompt field)"
fi

echo
echo "Then: /compare-state --against=what-went-wrong"
echo
echo "Full workflow: docs/alpha-feedback-guide.md"
