#!/usr/bin/env python3
"""Proof that gate-issue-create.py fires on real filings and stays quiet otherwise.

Run: python3 scripts/claude-hooks/test-gate-issue-create.py

No framework — this guards a repo-tooling hook, not shipped engine code, so it
stays runnable from a clean checkout with nothing installed.

The failure this guards against is silent: the hook fails open by design, so a
broken regex or a crash stops the prompt without stopping anything else. To
watch it fail, break GH_ISSUE_CREATE in the hook and re-run.
"""

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parent / "gate-issue-create.py"


def payload(command):
    return json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})


CASES = [
    # (should the gate fire?, name, stdin)
    (True, "plain gh issue create", payload("gh issue create --label developer --title x --body y")),
    (True, "inside a compound command", payload('cd /tmp && gh issue create --title x --body "a\nb"')),
    (True, "line-continuation form", payload("gh issue create --label developer \\\n  --title t \\\n  --body b")),
    (True, "multiline body", payload('gh issue create --title t --body "**Touches:** a.ts\n\nbody"')),
    (False, "gh issue list", payload("gh issue list --state open --search foo")),
    (False, "gh issue view", payload("gh issue view 1549 --json body")),
    (False, "gh pr create", payload("gh pr create --title x --body y")),
    (False, "unrelated command", payload("pnpm test")),
    (False, "malformed json", "not json at all"),
    (False, "empty stdin", ""),
    (False, "no command key", '{"tool_name":"Bash","tool_input":{}}'),
    (False, "command is not a string", '{"tool_name":"Bash","tool_input":{"command":123}}'),
]


def main():
    failures = 0
    for should_fire, name, stdin in CASES:
        proc = subprocess.run(
            [sys.executable, str(HOOK)],
            input=stdin.encode("utf-8"),
            capture_output=True,
        )
        out = proc.stdout.decode("utf-8").strip()
        fired = False
        if out:
            try:
                decision = json.loads(out)["hookSpecificOutput"]["permissionDecision"]
                fired = decision == "ask"
            except (ValueError, KeyError, TypeError):
                fired = False

        # Exit 0 always: the hook must never break an unrelated Bash call.
        ok = fired == should_fire and proc.returncode == 0
        failures += not ok
        print(
            f"{'PASS' if ok else 'FAIL'}  "
            f"expected={'fire' if should_fire else 'quiet':5s} "
            f"got={'fire' if fired else 'quiet':5s} exit={proc.returncode}  {name}"
        )

    print(f"\n{len(CASES) - failures}/{len(CASES)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
