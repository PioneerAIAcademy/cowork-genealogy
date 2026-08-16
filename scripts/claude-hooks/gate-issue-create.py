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

REASON = """Before filing, walk the order in CLAUDE.md > "Work you find along the way"
and stop at the first that fits:

  1. Fix it in this PR. The default, and the right answer about 2 times in 3 --
     the context is loaded now and the ticket-taker would rebuild it from zero.
  2. Drop it. A nit costs triage every morning for as long as it stays open.
  3. Comment on the issue that already covers it (one search, then stop).
  4. File -- only by naming which exemption applies: different reviewer/skill;
     a decision only the lead can make AND he is not reachable (a decision is a
     question -- if you can ask, ask); a different skill's paid eval slot; or
     too big for this PR AFTER opening the call sites and counting files/lines.

"I noticed it in passing" and "I'm not sure if this is in scope" are not
exemptions -- they are reasons to fix it now or to drop it."""


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
