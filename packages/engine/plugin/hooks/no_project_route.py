#!/usr/bin/env python3
"""Tell the Cowork main thread that a research request with no project goes to research.

A first message that names a person ("Research PID X. <question>") was answered on the
main thread from one `person_read` or one search, with no project and no research run
(issue #3768: in Cowork, issues #3927 and #3962 and two on #2813). Nothing else reaches
that main thread before `/research` loads: the hosted planes append their own system-prompt
text, and Cowork's session options are not ours to set. A plugin `UserPromptSubmit` hook
fires on every Cowork message with its text (ADR-0005, item 2), so it carries the sentence.
That probe measured the hook firing, not its `additionalContext` reaching the model in
Cowork, which is unmeasured.

**Cowork only.** Both hosted planes set `GENEALOGY_HOSTED_PLANE` in the SDK env, and the
hook is silent there: the hosted fix ruled for them is text only (a truthful `project_note`
and a `DELIVERY_GUIDANCE` exclusion), with nothing routing the main thread.

**The sentence is conditional because the hook cannot see the project.** Its cwd in the VM
is not the project folder (ADR-0005, item 7), so it cannot tell whether `research.json`
exists. The text applies only when `project_context` reports none, so it is true on every
message and inert once a project exists. It names the opening a tester liked (issue #3842):
with more than one goal, summarise the tree and ask which to pursue.

**Hand-backs are skipped.** A subagent's hand-back fires `UserPromptSubmit` with text that
starts `<agent-message` (ADR-0005), and it is not the researcher speaking.

Stdlib only, no network, and it must never raise: every failure path prints `{}` (no
opinion), so a broken hook adds nothing rather than failing the researcher's message.
"""

from __future__ import annotations

import json
import os
import sys

HOSTED_PLANE_ENV = "GENEALOGY_HOSTED_PLANE"

CONTEXT = (
    "If project_context reports no project in this folder, a request to research a person "
    "is a research job: hand it to the research skill, which starts the project, rather "
    "than answering it from a single lookup. In that case, if the message names more than "
    "one goal, you may summarise what the tree says and ask which to pursue first."
)


def decision(payload: dict, env: dict) -> dict:
    if env.get(HOSTED_PLANE_ENV):
        return {}
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or prompt.lstrip().startswith("<agent-message"):
        return {}
    return {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": CONTEXT,
        }
    }


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        out = decision(payload if isinstance(payload, dict) else {}, dict(os.environ))
    except Exception:
        out = {}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
