#!/usr/bin/env bash
# Set up a feedback case directory from a submitted zip.
# Contract: docs/specs/feedback-case-spec.md §11.
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

See docs/specs/feedback-case-spec.md §11 for the full contract.
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
  echo "Run this script from inside the cowork-genealogy repo." >&2
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
mkdir -p "$DEST_DIR"
unzip -q "$ZIP_PATH" -d "$DEST_DIR"

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
for d in "$REPO_ROOT"/plugin/skills/*/; do
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
  if [[ -z "$USER_PROMPT" ]] && command -v python3 >/dev/null 2>&1; then
    USER_PROMPT="$(python3 -c "import json,sys
try:
    print(json.load(open(sys.argv[1])).get('user_prompt',''))
except Exception:
    pass" "$FB_JSON" 2>/dev/null || true)"
  fi
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
echo "Full workflow: docs/specs/feedback-case-spec.md §3"
