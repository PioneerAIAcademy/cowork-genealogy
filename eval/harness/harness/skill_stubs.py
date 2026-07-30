"""Positive-test sub-skill stubbing (`execution.stub_skills`).

A test declares a sub-skill it does not want executed. The PreToolUse hook
records the delegation in `skills_invoked`, denies the launch, and lets the run
continue — so the caller still finishes its own logging and summary. Use when
the callee is separately covered by its own unit suite, so running it inside
the caller's test spends wall-clock and tokens on coverage that already exists.

Two forms, and the choice is NOT stylistic — it depends on the caller's own
contract, not the callee's:

- **Bare deny** (`"search-external-sites"`) — the caller hands off and does not
  read what comes back. Nothing needs to be returned.
- **Canned response** (`{"skill": ..., "response": "..."}`) — the caller's own
  remaining work CONSUMES the callee's output, so a bare deny would leave it
  unable to finish. search-records is the worked case: SKILL.md Step 7 tells it
  to "present the URLs it returns as part of your results", so a stub that
  returns nothing removes a deliverable the skill is specced to produce. Under
  a bare deny that test needed a judge instruction ("do not penalize the skill
  for not producing Ancestry URLs") to stay green — a grading patch over a
  harness gap, which is what this form exists to remove.

Check the CALLER's spec before picking. "Does the callee have its own suite?"
decides whether to stub at all; "does the caller read the result?" decides
which form.

Mechanism note (pinned to claude-agent-sdk 0.1.81): a PreToolUse hook has no
`updatedToolOutput` — that field is PostToolUse-only — so the only channel back
to the model on a deny is `permissionDecisionReason`. The canned response
therefore rides in that string and reaches the model as text, not as a
structured tool result. A stub whose caller needs to *parse* structured output
is out of scope for this mechanism.

What this deliberately does NOT cover: `skills_invoked` records the skill NAME
only, not the `args` string the caller composed. So no validator can assert
WHAT was passed across the seam — see docs/TODOs.md.
"""

from __future__ import annotations

from typing import Any

# Framing wrapped around a canned response. Without it the model tends to
# either retry the denied call or decide it must do the callee's work itself —
# both of which spend the turns the stub was meant to save.
_STUB_PREAMBLE = (
    "{name!r} is stubbed for this eval run — it has its own unit suite and is "
    "not under test here. Your delegation to it HAS been recorded and counts "
    "as successful. Do not retry it, and do not attempt to do its work "
    "yourself."
)

_BARE_SUFFIX = (
    " Carry on and finish your own remaining steps (logging, status, summary)."
)

_CANNED_SUFFIX = (
    "\n\nTreat the following as the result it returned, and use it to finish "
    "your own remaining steps (logging, status, summary):\n\n{response}"
)


def parse_stub_skills(execution: dict[str, Any] | None) -> dict[str, str | None]:
    """Normalize `execution.stub_skills` to `{skill_name: canned_response|None}`.

    Accepts both declared forms — a bare string, or an object with `skill` and
    an optional `response`. A `None` value means bare deny.

    Returns an empty dict when nothing is declared, so callers can treat the
    result as a plain membership test without a null check.
    """
    declared = (execution or {}).get("stub_skills") or []
    stubs: dict[str, str | None] = {}
    for entry in declared:
        if isinstance(entry, str):
            stubs[entry] = None
        elif isinstance(entry, dict):
            name = entry.get("skill")
            if name:
                # An explicitly empty response is a bare deny, not an empty
                # payload — the model must not be told to present nothing.
                stubs[name] = entry.get("response") or None
    return stubs


def stub_denial(skill_name: str, response: str | None) -> dict[str, Any]:
    """The PreToolUse hook output that stubs one sub-skill launch.

    Denies the launch WITHOUT `continue_: False` — that is the whole difference
    from the negative-test routing short-circuit, which stops the run because a
    negative verdict is sealed the moment routing happens. A positive test still
    has work left, so this one denies and continues.
    """
    reason = _STUB_PREAMBLE.format(name=skill_name)
    reason += (
        _CANNED_SUFFIX.format(response=response) if response else _BARE_SUFFIX
    )
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
