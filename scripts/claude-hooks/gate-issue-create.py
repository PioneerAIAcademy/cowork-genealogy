#!/usr/bin/env python3
"""PreToolUse gate on `gh issue create`.

Wired from .claude/settings.json against the Bash tool. Reads the hook payload
on stdin, and when the command would file a GitHub issue, returns an "ask"
decision so the lead sees the filing before it happens.

Why a hook and not more prose: the rule already lives in CLAUDE.md and
DEVELOPMENT.md at length, and restating it is the move ADR-0011 measured and
found does not bind. This is the write boundary for filing.

Deliberately "ask", not "deny": the four-step order ends in a legitimate file,
and skills that file in bulk (audit-board, triage-standup, fill-ready) still
work with one approval each.

Never raises. Any failure falls through to allowing the call, because an
exception here would block a Bash command the caller was entitled to run.
"""

import json
import re
import sys

# Matches the subcommand anywhere in the command string, so it still fires
# inside a compound command or a heredoc. A false positive (the literal text
# quoted in an echo) costs one extra prompt, which is the safe direction.
GH_ISSUE_CREATE = re.compile(r"\bgh\b.{0,200}?\bissue\b\s+\bcreate\b", re.DOTALL)

REASON = """The project winds down at the end of 2026. CLAUDE.md > "Work you find along
the way": finish what your task turns up in this PR. Stop at the first that fits:

  1. Fix it in this PR -- always, for what your change broke, left half-done
     or made stale.
  2. Comment on the issue that already covers it (one search, then stop).
  3. Drop it -- improvements, nits, open questions, anything that would cost a
     second paid eval run.
  4. File -- only a bug that harms researchers' data, or a missing guard, that
     needs a different skill or is too big here AFTER counting files/lines.

A failing test is never a new issue: make it pass, or put its restore in the
done-when of the issue that owns the fix."""


def main() -> int:
    try:
        raw = sys.stdin.buffer.read().decode("utf-8")
        payload = json.loads(raw) if raw.strip() else {}
        command = payload.get("tool_input", {}).get("command", "")
        if not isinstance(command, str) or not GH_ISSUE_CREATE.search(command):
            return 0
        json.dump(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": REASON,
                }
            },
            sys.stdout,
        )
    except Exception:
        # Fail open. A broken gate must not break unrelated Bash calls.
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
