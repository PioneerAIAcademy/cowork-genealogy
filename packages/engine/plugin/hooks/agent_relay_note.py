#!/usr/bin/env python3
"""On a hosted plane, tell the main thread to relay an agent's report word for word.

A plugin agent ends its return with `---` and the text the researcher should read
(research/SKILL.md, "One step per turn"). A Haiku 5.5 main thread rewrote that text
instead, dropping its caveats and adding a next step of its own (ut_research_030,
2 of 8 runs). A `PostToolUse` note on the agent's return states the rule at the
moment it applies. Only the hosted planes run Haiku and set `GENEALOGY_HOSTED_PLANE`;
Cowork and Desktop run their own model and get nothing (lead, 2026-11-24). Both
harnesses add `RELAY_NOTE` themselves, as they measure the hosted main thread.

Stdlib only, no network, and it must never raise: every failure path prints `{}`.
"""

from __future__ import annotations

import json
import os
import sys

HOSTED_PLANE_ENV = "GENEALOGY_HOSTED_PLANE"
DELEGATION_TOOLS = ("Agent", "Task")

RELAY_NOTE = (
    "That was a plugin agent's report. Unless research/SKILL.md says to relay its whole "
    "return, give the researcher its text after the final `---` word for word, caveats "
    "included, and add nothing to it but the turn's closing offer and the one sentence "
    "before it."
)


def applies(payload: dict) -> bool:
    """A main-thread agent return: a subagent holds no Agent tool, but say so anyway."""
    return payload.get("tool_name") in DELEGATION_TOOLS and not payload.get("agent_id")


def decision(payload: dict, env: dict) -> dict:
    if not env.get(HOSTED_PLANE_ENV) or not applies(payload):
        return {}
    return {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": RELAY_NOTE}}


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        out = decision(payload if isinstance(payload, dict) else {}, dict(os.environ))
    except Exception:
        out = {}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
