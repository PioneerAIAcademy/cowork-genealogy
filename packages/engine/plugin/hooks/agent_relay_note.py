#!/usr/bin/env python3
"""On a hosted plane, tell the main thread to relay an agent's report word for word.

A plugin agent ends its return with `---` and the text the researcher should read
(research/SKILL.md, "One step per turn"). A Haiku 5.5 main thread rewrote that text
instead, dropping its caveats and adding a next step of its own (ut_research_030,
2 of 8 runs). A `PostToolUse` note on the agent's return states the rule at the
moment it applies. historical-context is relayed by a different rule (everything above
its `### Search implications` heading), so it gets its own note: the general one sent
the main thread to its plain summary and dropped Sources consulted (ut_research_ia2,
2 of 4 runs). So does init-project, whose report a bounded first message relays without
its next-step sentence before running its deliverable in the same turn: the general note
ended that turn after init-project, or kept the sentence. search-records' note makes the one
sentence before the closing offer say what the turn saved and what it found and did not save:
research/SKILL.md says so, and in 13 runs of a children ask (children-attached-households-
benjamin-phipps, 2026-11-26 and 27) three replies did. Only the hosted planes run Haiku and set `GENEALOGY_HOSTED_PLANE`;
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

#: Agents whose relay rule is not "after the final `---`" (research/SKILL.md, "One step per turn"),
#: or whose closing sentence must carry something.
AGENT_NOTES = {
    "search-records": (
        "That was search-records' report. Give the researcher its text after the final `---` "
        "word for word, caveats included, and add nothing to it but the turn's closing offer and "
        "one sentence before it. That sentence names what this turn saved and anything it found "
        "and did not save, the record and the person it was for, or says it saved no record."
    ),
    "locality-guide": (
        "That was locality-guide's report. Keep its text after the final `---` word for "
        "word. When research-plan runs next in this turn, give the researcher both reports "
        "word for word, locality-guide's first, then research-plan's, adding nothing but the "
        "turn's closing offer and the one sentence before it; otherwise relay this one the "
        "same way."
    ),
    "historical-context": (
        "That was historical-context's report. Give the researcher everything above its "
        "`### Search implications` heading word for word, the Sources consulted list "
        "included, and nothing from that heading on. Then write one sentence offering to "
        "check the facts the explanation rests on, and end on the \"Continue with …?\" line."
    ),
    "init-project": (
        "That was init-project's report. Relay its text after the final `---` word for word, "
        "its source lines included, then add exactly these two lines and nothing else: \"What do you want to verify or research? Is anything here you think is wrong, or do you know or have anything that isn't here?\" "
        "and \"Continue with `choosing the question`?\" Only when the researcher's message is a bounded request for anything but a "
        "research plan (research/SKILL.md, \"Bounded request or job\"; a request for one record, for "
        "when or where one event happened, or for a person's children or siblings, is one), or its return has a "
        "`Verify request: broad` line (the broad audit is then what was asked), leave out its sentence "
        "naming the next step, add neither line, and deliver what was asked now, in this "
        "turn, as research/SKILL.md says."
    ),
}


def applies(payload: dict) -> bool:
    """A main-thread agent return: a subagent holds no Agent tool, but say so anyway."""
    return payload.get("tool_name") in DELEGATION_TOOLS and not payload.get("agent_id")


def note_for(payload: dict) -> str:
    """The note for this agent's return; a `plugin:` or plugin-namespaced name counts as bare."""
    tool_input = payload.get("tool_input")
    agent = tool_input.get("subagent_type") if isinstance(tool_input, dict) else None
    bare = agent.rsplit(":", 1)[-1] if isinstance(agent, str) else ""
    return AGENT_NOTES.get(bare, RELAY_NOTE)


def decision(payload: dict, env: dict) -> dict:
    if not env.get(HOSTED_PLANE_ENV) or not applies(payload):
        return {}
    return {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": note_for(payload)}}


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        out = decision(payload if isinstance(payload, dict) else {}, dict(os.environ))
    except Exception:
        out = {}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
