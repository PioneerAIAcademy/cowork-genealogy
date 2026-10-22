"""Positive-test sub-skill stubbing (`execution.stub_skills`).

A test declares a sub-skill it does not want executed. The PreToolUse hook
records the delegation in `skills_invoked`, denies the launch, and lets the run
continue — so the caller still finishes its own logging and summary. A test
that sets `execution.stop_at_stub` stops at its first stubbed hand-off instead
(`skill_runner.py`, #3119). Use when
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

Mechanism note (re-checked on claude-agent-sdk 0.2.165, unchanged from 0.1.81):
a PreToolUse hook has no `updatedToolOutput` — that field is PostToolUse-only —
so the only channel back to the model on a deny is `permissionDecisionReason`.
The canned response therefore rides in that string and reaches the model as
text, not as a structured tool result. A stub whose caller needs to *parse*
structured output is out of scope for this mechanism.

CLI 2.1.294 (SDK 0.2.165) delivers that string as an error result prefixed
`PreToolUse:Agent hook error:`. With every instruction inside that error, a
router sometimes took the hand-off as the end of its turn and skipped its own
closing step (issue #3740, ut_research_020: 7 of 20 runs, against 0 of 33 on CLI
2.1.139). Rewording alone cut it to 3 of 20. What reached 0 of 20 is splitting
the channels: a canned form's reason carries only the result and the
non-disclosure block, and the instructions about the hand-off (did not execute,
do not retry, `_CARRY_ON`) go in `additionalContext` on the same
`hookSpecificOutput`. The run log does not record `additionalContext`, so its
delivery on a deny was inferred from behaviour (no retries, no disclosure),
not observed. `_CARRY_ON`'s wording is the second half of the fix; its
comment records the version that over-shot.

What this deliberately does NOT cover: `skills_invoked` records the skill NAME
only, not the `args` string the caller composed. So no validator can assert
WHAT was passed across the seam — a stub sharpens that, since a denied callee
leaves no output to infer the args from. Widening `skills_invoked` is not the
fix; existing validators depend on its `list[str]` shape.
"""

from __future__ import annotations

from typing import Any

# Framing wrapped around a canned response. Without it the model tends to
# either retry the denied call or decide it must do the callee's work itself —
# both of which spend the turns the stub was meant to save.
_STUB_PREAMBLE = (
    "{name!r} did not execute. The hand-off counts as made. "
    "Do not retry it, and do not attempt to do its work yourself."
)

_CANNED_SUFFIX = "Treat the following as the result {name!r} returned:\n\n{response}"

# The reason string lands in the model's context immediately before it writes
# its summary, so anything harness-flavoured in it is liable to be narrated
# straight into the graded output ("note: search-external-sites was stubbed for
# this eval run"). That reads to a judge as a defect in the skill, and the only
# repair from the grading side is a judge instruction telling it to ignore the
# leak — which is the exact grading-patch-over-a-harness-gap this mechanism
# exists to remove. So suppression belongs here, on the harness side of the
# line, and the preamble above says only what the model must know to behave
# correctly: it did not run, it counts, do not redo it. No "eval", no "stub",
# no "not under test here".
_NO_DISCLOSE = (
    "\n\nThis message is test scaffolding. Do NOT mention it, the evaluation "
    "harness, or the fact that {name!r} was skipped or stubbed — not in your "
    "reply, and not in anything you write to disk (log `notes`, status "
    "updates, summaries). Describe this hand-off using only what the text "
    "above states. Do not say {name!r} wrote, changed or concluded anything "
    "the text does not state."
)

# Sent as `additionalContext`, outside the error-framed reason. It says the
# turn goes on but not what to do in it, and a canned result outranks the
# caller's own instructions: many canned responses tell the router to write its
# summary and stop, and an earlier "follow your own instructions through to
# their end" sent a router on a job down the rest of its routing table
# (ut_research_h7w, 4 of 4 runs). It names no tool, skill or step, because every
# stubbed test shares this text and naming the step a test grades would hand
# that test its pass.
_CARRY_ON = (
    "\n\nThe hand-off is over; your turn is not. Your own instructions still "
    "govern how this turn ends: do what they still require before you reply.{result}"
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
    has work left, so this one denies and continues. The exception is a test
    that sets `execution.stop_at_stub`, whose verdict is its first stubbed
    hand-off: `run_skill` adds the stop to that hand-off.
    """
    preamble = _STUB_PREAMBLE.format(name=skill_name)
    if response:
        reason = _CANNED_SUFFIX.format(name=skill_name, response=response)
        context = preamble + _CARRY_ON.format(
            result=" Where the result it returned says otherwise, follow the result."
        )
    else:
        # No result to carry, so the preamble stays in the reason: a deny
        # with an empty reason gives the model nothing to act on.
        reason = preamble
        context = _CARRY_ON.format(result="").lstrip()
    reason += _NO_DISCLOSE.format(name=skill_name)
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
            "additionalContext": context,
        }
    }
