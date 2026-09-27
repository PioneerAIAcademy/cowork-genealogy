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

# --- Strip Claude Code config that may have been injected into the zip ---
# Legitimate feedback zips never contain dotfiles (both walkers skip entries
# starting with "."), so .claude/, .claude.json, and .mcp.json in the zip are
# either hand-crafted or from an unexpected source. Remove them so the script's
# own fresh .claude/ (with repo-symlinked skills only) is the sole config
# Claude Code reads.
for injected in .claude .claude.json .mcp.json .gitattributes .git; do
  if [[ -e "$DEST_DIR/$injected" ]]; then
    echo "Warning: stripped $injected from the zip (not expected in a feedback submission)."
    rm -rf "$DEST_DIR/$injected"
  fi
done
# CLAUDE.md is NOT a dotfile, so the walkers ship it deliberately and they
# walk recursively, so one can arrive at any depth. Claude Code loads a subtree
# CLAUDE.md when it reads files in that subtree, and the triage workflow reads
# results/. Rename rather than delete: the triager keeps the content for
# reproduction, but it no longer executes as config.
while IFS= read -r -d '' f; do
  echo "Note: renamed ${f#"$DEST_DIR"/} to ${f#"$DEST_DIR"/}.submitted so it is not loaded as instructions."
  mv "$f" "$f.submitted"
done < <(find "$DEST_DIR" -type f -name CLAUDE.md -print0)

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
# A fixed, case-local identity. The guide tells the Windows team to use
# GitHub Desktop, which sets no global user.name/user.email, so a bare
# commit aborts the whole run under `set -euo pipefail` — before the skill
# links and the printout, and leaving no `imported` commit for
# reset-feedback-case.sh. `-c` applies to this call only: it never touches
# the user's global config and leaves nothing in the case repo's own.
git -c user.name="feedback-case" -c user.email="feedback-case@localhost" \
  commit -q -m "imported"

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
# Whether a reader actually ran, as distinct from what it returned. An
# empty USER_PROMPT cannot carry that: the prompt box is optional, so ""
# is a legitimate answer and looks identical to "nothing could read it".
# Set outside the -f test below so `set -u` cannot meet it unbound at the
# printout. Defensive rather than reachable today — feedback.json is a
# required member and the bundle check above exits when it is absent.
PROMPT_READ_OK=0
FB_JSON="$DEST_DIR/_feedback/feedback.json"
if [[ -f "$FB_JSON" ]]; then
  if command -v jq >/dev/null 2>&1; then
    # Inside the `if` rather than with a trailing `|| true`: that forces the
    # substitution's status to 0, so jq's exit code becomes unreadable — and
    # simply dropping it would abort the script with jq's exit 5 on an
    # unparseable report, after the case has already been imported.
    if USER_PROMPT="$(jq -r '.user_prompt // empty' "$FB_JSON" 2>/dev/null)"; then
      PROMPT_READ_OK=1
    fi
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
    # Gate on the flag, not on emptiness: a successful jq read of "" is an
    # answer, and re-running python would only overwrite it with the same "".
    if [[ "$PROMPT_READ_OK" -eq 1 ]]; then break; fi
    if command -v "$PY" >/dev/null 2>&1; then
      # `or ''` because .get returns None for an explicit JSON null, and
      # print(None) emits the literal string "None" — which the triager would
      # paste into the issue as the tester's own words. Git for Windows ships
      # no jq, so this reader is the genealogist team's default path.
      #
      # sys.exit(1), not pass: a handler that swallows the error exits 0 while
      # printing nothing, which is indistinguishable from a successful read of
      # an empty prompt. That is the whole distinction this block exists to make.
      if PY_OUT="$("$PY" -c "import json,sys
try:
    print(json.load(open(sys.argv[1], encoding='utf-8')).get('user_prompt') or '')
except Exception:
    sys.exit(1)" "$FB_JSON" 2>/dev/null)"; then
        USER_PROMPT="$PY_OUT"
        PROMPT_READ_OK=1
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

# Three outcomes, not two. Blankness is decided with whitespace stripped so
# "   \n" reads the same here as [string]::IsNullOrWhiteSpace does in the .bat,
# but the prompt itself is still printed verbatim — the spec guarantees that,
# and trimming the variable would break it.
if [[ -n "${USER_PROMPT//[[:space:]]/}" ]]; then
  echo "User's prompt to issue first:"
  echo "─────────────────────────────────────────────"
  printf '%s\n' "$USER_PROMPT"
  echo "─────────────────────────────────────────────"
elif [[ "$PROMPT_READ_OK" -eq 1 ]]; then
  echo "User's prompt: the tester left blank. Try $DEST_DIR/_feedback/session-log.jsonl"
  echo "  for what they asked for — it is optional (a Cowork submission never has"
  echo "  one), and a trimmed log drops its oldest entries, so the prompt goes first."
else
  echo "User's prompt: see $DEST_DIR/_feedback/feedback.json (user_prompt field)"
fi

echo
echo "Then: /compare-state --against=what-went-wrong"
echo
echo "Full workflow: docs/alpha-feedback-guide.md"
