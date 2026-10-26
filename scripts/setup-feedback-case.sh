#!/usr/bin/env bash
# Set up a feedback case directory from a submitted zip.
# Contract: docs/specs/feedback-case-spec.md §3.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: setup-feedback-case.sh <path-to-feedback.zip> [<dest-dir>] [--force]

Extracts a feedback submission into a case directory, initializes a git
baseline, writes .feedback-repo-root, wires per-skill symlinks, and
prints the user's prompt for first-paste. Needs python3 (or python).

Arguments:
  <path-to-feedback.zip>  The zip file downloaded from the feedback Drive.
  <dest-dir>              Optional. Default: ~/feedback/<slug>/ where
                          <slug> is the zip basename without `.zip`.
  --force                 Overwrite an existing non-empty dest-dir.

See docs/specs/feedback-case-spec.md §3 for the full contract.
EOF
}

# Print the first of python3, python that actually runs. On Windows,
# `command -v python3` succeeds even with no usable interpreter: Windows ships
# an App Execution Alias stub at AppData/Local/Microsoft/WindowsApps/python3
# that exists but fails when run (it exists to launch the Store), and on some
# builds prints its Store message on stdout. So each candidate is run with its
# output discarded, and only the chosen name reaches stdout. Git for Windows
# installs expose the real interpreter as `python`. `-I` also rules out
# Python 2, which has no such flag.
find_python() {
  local cand
  for cand in python3 python; do
    if "$cand" -I -c "import zipfile" >/dev/null 2>&1; then
      echo "$cand"
      return 0
    fi
  done
  return 1
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

# --- Find a Python to extract with ---
# Before --force removes anything. The `if !` form matters: under `set -e` a
# bare `PY="$(find_python)"` exits here, silently, when none runs.
if ! PY="$(find_python)"; then
  echo "Error: python3 (or python) is required to extract the bundle" >&2
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

# --- Extract ---
# Not `unzip` (#3706): macOS's fails on the non-ASCII names report titles
# carry. The extractor reads UTF-8 names, and rewrites `\` to `/` because on
# POSIX `zipfile` keeps a Windows bundle's `results\log_006.json` as one
# literal root-level name. Python fails the whole extraction on an encrypted
# member or an unsupported compression method rather than skipping it; the
# contents are still verified below rather than inferred from the exit code.
# `-I` because the bundle is untrusted input.
mkdir -p "$DEST_DIR"
# Absolute from here on: the script later cds into it and still reads files
# through it, which a relative path would resolve a second time.
DEST_DIR="$(cd "$DEST_DIR" && pwd)"
if ! "$PY" -I "$SCRIPT_DIR/extract_feedback_zip.py" "$ZIP_PATH" "$DEST_DIR"; then
  echo "Error: extraction failed: $ZIP_PATH" >&2
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
  -c commit.gpgsign=false commit -q -m "imported"

# --- Per-skill symlinks under .claude/skills/ ---
mkdir -p .claude/skills
shopt -s nullglob
for d in "$REPO_ROOT"/packages/engine/plugin/skills/*/; do
  name="$(basename "$d")"
  ln -s "$d" ".claude/skills/$name"
  if [ ! -L ".claude/skills/$name" ]; then
    echo "ERROR: ln -s for skill '$name' created a copy, not a symlink." >&2
    echo "This platform does not support symlinks. Run scripts\\setup-feedback-case.bat instead." >&2
    exit 1
  fi
done
for d in "$REPO_ROOT"/.claude/skills/*/; do
  name="$(basename "$d")"
  ln -s "$d" ".claude/skills/$name"
  if [ ! -L ".claude/skills/$name" ]; then
    echo "ERROR: ln -s for skill '$name' created a copy, not a symlink." >&2
    echo "This platform does not support symlinks. Run scripts\\setup-feedback-case.bat instead." >&2
    exit 1
  fi
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
# An EMPTY (or whitespace-only) report must never reach a reader. `jq -er` EXITS 0
# on empty input -- it reads no JSON value, prints nothing, and succeeds -- so the
# reader below would set PROMPT_READ_OK=1 and the script would tell the triager
# "the tester left blank" about a report it never read. The two cases need opposite
# advice: "they left it blank" means look in the session log, "it could not be read"
# means open the file. Gate on there being a non-whitespace document at all.
if [[ -f "$FB_JSON" ]] && [[ -n "$(tr -d '[:space:]' < "$FB_JSON" 2>/dev/null)" ]]; then
  if command -v jq >/dev/null 2>&1; then
    # Inside the `if` rather than with a trailing `|| true`: that forces the
    # substitution's status to 0, so jq's exit code becomes unreadable — and
    # simply dropping it would abort the script with jq's exit 5 on an
    # unparseable report, after the case has already been imported.
    # --slurpfile, not a bare filter: jq reading an EMPTY (or whitespace-only)
    # file produces no output and exits 0, so the bare form recorded a
    # successful read of a blank prompt and printed "left blank" for a report
    # nothing could read -- the exact failure this block's flag exists to tell
    # apart. Slurping makes "no input at all" observable as length 0.
    if USER_PROMPT="$(jq -ern --slurpfile d "$FB_JSON" 'if ($d|length) == 0 then error("empty") elif ($d[0]|type) == "object" then ($d[0].user_prompt // "") else error("not an object") end' 2>/dev/null)"; then
      PROMPT_READ_OK=1
    fi
  fi
  # The Python reader, with the interpreter find_python chose, so the Windows
  # Store stub never runs here. Take the output only when it exited 0: a
  # failed run's stdout is not a prompt.
  #
  # Gate on the flag, not on emptiness: a successful jq read of "" is an
  # answer, and re-running python would only overwrite it with the same "".
  if [[ "$PROMPT_READ_OK" -eq 0 ]]; then
    # `or ''` because .get returns None for an explicit JSON null, and
    # print(None) emits the literal string "None" — which the triager would
    # paste into the issue as the tester's own words. Git for Windows ships
    # no jq, so this reader is the genealogist team's default path.
    #
    # sys.exit(1), not pass: a handler that swallows the error exits 0 while
    # printing nothing, which is indistinguishable from a successful read of
    # an empty prompt. That is the whole distinction this block exists to make.
    #
    # -I because this runs inside the case directory: without it a json.py
    # from the bundle shadows the stdlib module and runs here. -X utf8 because
    # -I also ignores PYTHONIOENCODING, and the prompt may be non-ASCII.
    if PY_OUT="$("$PY" -I -X utf8 -c "import json,sys
try:
    print(json.load(open(sys.argv[1], encoding='utf-8')).get('user_prompt') or '')
except Exception:
    sys.exit(1)" "$FB_JSON" 2>/dev/null)"; then
      USER_PROMPT="$PY_OUT"
      PROMPT_READ_OK=1
    fi
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
