"""Tests for the `test_no_out_of_lane_section_writes` universal validator and
the payload shape it depends on (issue #2022).

Why this file exists at all. The ownership predicate ships in
`packages/engine/plugin/hooks/guard_project_files.py` and binds in Cowork, on
the hosted path and in the e2e harness. The UNIT plane — the only one that
grades — called it nowhere, and `docs/specs/guardrail-enforcement-spec.md` §4
said so outright. What that absence cost is PREVENTION rather than detection:
the universal `test_ownership_table` already fails a run that wrote `conflicts`
after the fact — both committed runs that did so failed on it — but it cannot
stop the write landing, and once the conflict is cleared the writer tool's own
preconditions correctly allow a tier.

Two things are covered, and they fail for different reasons:

1. The validator's own behaviour and message. Same shape as
   `test_universal_context_calls.py`: the AssertionError text is the only thing
   a genealogist reading a failed run sees.

2. **The payload shape the deny depends on.** This is the guard the issue asked
   for by name, because `owner_denied` reads the caller from the PreToolUse
   payload and a payload without `agent_type` resolves `caller == ""` — under
   which the routed arm denies EVERY `proof_summaries` write in
   proof-conclusion's own suite (81 ops across 17 tests, measured 2026-09-03 --
   the corpus rotates, so re-derive rather than quote).
   That is ADR-0011's "the identifier is not what you expect" trap, and a
   silently-never-firing shape guard is exactly how this plane came to have no
   arm.

   The payload keys below are not invented. They were observed live on
   2026-09-02 by instrumenting `pretool_hook` and running
   `ut_proof_conclusion_011` (one scratch run, $0.4160): the unit plane's
   payload carries `agent_id` AND `agent_type`, and `agent_type` arrives
   already bare (`proof-conclusion`, not
   `genealogy-research:proof-conclusion`). Nothing in CI reaches the SDK's
   payload shape — see docs/architecture.md §9.4 — so this test is the record
   of that measurement. It does NOT detect the shape moving: the payload here is
   a literal. What catches drift is the gating validator, because every drift
   scenario stops the caller resolving to `proof-conclusion` and the routed arm
   then denies the owner's own writes.
"""

import pathlib
import sys
from pathlib import Path

import pytest

from harness.context_policy import owned_section_denial, owner_denied

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_universal import (  # noqa: E402
    test_no_out_of_lane_section_writes as check_no_out_of_lane,
)

# The payload the unit plane actually sends, as measured. Keys verbatim from the
# probe; values reduced to what the predicate reads.
_OBSERVED_KEYS = {
    "agent_id",
    "agent_type",
    "cwd",
    "effort",
    "hook_event_name",
    "permission_mode",
    "session_id",
    "tool_input",
    "tool_name",
    "tool_use_id",
    "transcript_path",
}


def _payload(**over):
    base = {
        "agent_id": "agent-abc123",
        "agent_type": "proof-conclusion",
        "hook_event_name": "PreToolUse",
        "tool_name": "mcp__genealogy__research_append",
    }
    base.update(over)
    return base


def _append(section, **entry):
    return {"ops": [{"op": "append", "section": section, "entry": entry or {"x": 1}}]}


# --- the payload-shape guard -------------------------------------------------

def test_the_observed_payload_resolves_a_bare_caller():
    """The Step-1 measurement, encoded: the predicate's behaviour against the
    payload shape observed 2026-09-02.

    It pins the predicate, not the live payload — this payload is a literal, so
    no change in what the SDK sends can fail it. What catches that is the
    validator itself: every drift scenario resolves a caller that is not
    `proof-conclusion`, so the routed arm denies the owner's OWN
    `proof_summaries` writes and the gating validator fails the run."""
    payload = _payload()
    assert _OBSERVED_KEYS >= set(payload), "test payload drifted from the observed keys"
    # An out-of-lane section for this caller: proof-conclusion's lane is
    # {proof_summaries, questions, project}.
    denied = owner_denied("mcp__genealogy__research_append", _append("conflicts"), payload)
    assert denied is not None, (
        "the observed unit-plane payload no longer resolves a caller — the deny "
        "would go silent, which is the state issue #2022 fixed"
    )
    _section, _rule, caller = denied
    assert caller == "proof-conclusion", (
        f"caller resolved to {caller!r}; a namespaced or empty caller makes the "
        "routed arm deny the owner's own writes"
    )


def test_the_owner_is_not_denied_its_own_section():
    """The polarity half. With `caller == ''` the routed arm denies every
    `proof_summaries` write in this skill's own suite — 81 ops across 17 tests as
    of 2026-09-03 —
    which reads as a skill collapse rather than a guard. The owner must pass."""
    assert (
        owner_denied(
            "mcp__genealogy__research_append",
            _append("proof_summaries"),
            _payload(),
        )
        is None
    )


def test_a_payload_missing_agent_type_would_deny_the_owner():
    """Documents the hazard rather than asserting it is impossible.

    This is the failure the Step-1 probe existed to rule out: keep it as a live
    demonstration of WHY that probe was a precondition, so nobody wires this
    arm on another plane without repeating the measurement.
    """
    blind = _payload()
    blind.pop("agent_type")
    denied = owner_denied(
        "mcp__genealogy__research_append", _append("proof_summaries"), blind
    )
    assert denied is not None and denied[2] == "", (
        "a payload without agent_type no longer resolves an empty caller; if the "
        "predicate changed, re-check whether the routed arm still fails open"
    )


# --- the validator -----------------------------------------------------------

def test_clean_run_passes():
    check_no_out_of_lane([])


def test_message_names_the_caller_the_section_and_the_rule():
    with pytest.raises(AssertionError) as e:
        check_no_out_of_lane(
            [{"tool": "mcp__genealogy__research_append",
              "args": {},
              "section": "conflicts",
              "rule": "routed",
              "caller": "proof-conclusion"}]
        )
    msg = str(e.value)
    assert "proof-conclusion" in msg
    assert "conflicts" in msg
    assert "routed" in msg
    # The reader needs to know where the rule is written down.
    assert "ownership.json" in msg


def test_a_main_thread_caller_reads_as_main_thread_not_empty_string():
    """`caller` is '' on the main thread, and an empty string in the message
    renders as `→ conflicts` with nothing before the arrow."""
    with pytest.raises(AssertionError) as e:
        check_no_out_of_lane(
            [{"tool": "mcp__genealogy__research_append",
              "args": {},
              "section": "conflicts",
              "rule": "routed",
              "caller": ""}]
        )
    assert "<main thread>" in str(e.value)


def test_every_denial_arm_produces_a_reason_the_validator_can_report():
    """All three arms, so a future arm cannot be added with no payload path.
    `declaration` is the trap one: its section is a dotted `section.field` that
    keys neither owner map, so branching on shape rather than `rule` raises."""
    # Each arm paired with a section its OWN map actually holds. Getting this
    # wrong is not hypothetical: pairing `conflicts` with `routed` raises
    # KeyError, because OWNED_SECTIONS holds only {proof_summaries}. That is the
    # trap `owned_section_denial`'s docstring names, and it fires on the arm
    # rather than on the section string's shape.
    arms = [
        ("proof_summaries", "routed", "record-extractor"),
        ("conflicts", "out_of_lane", "proof-conclusion"),
        ("questions.exhaustive_declaration", "declaration", "proof-conclusion"),
    ]
    for denied in arms:
        reason = owned_section_denial(denied)["hookSpecificOutput"][
            "permissionDecisionReason"
        ]
        assert reason, f"no reason for arm {denied[1]}"


# --- the wiring ---------------------------------------------------------------

def test_pretool_hook_calls_the_predicate_before_the_call_counter():
    """Pins the wiring itself, which no behavioural test in this suite reaches.

    Nothing under `tests/` exercises `pretool_hook` — it is a closure inside
    `run_skill` — so deleting the deny arm leaves the whole harness suite green.
    That is precisely how this plane came to have no arm at all, and the same
    shape as `test_orchestrator.py:1172`, which parses rather than indexes: the
    property is
    pinned on the SOURCE because no test reaches the runtime path.

    Ordering is asserted, not just presence. A denied call never executes, so it
    must not consume the `max_tool_calls` budget — the same rationale the two
    existing denies are placed for.
    """
    src = (
        pathlib.Path(__file__).resolve().parents[2] / "harness" / "skill_runner.py"
    ).read_text(encoding="utf-8")

    hook = src.split("async def pretool_hook(", 1)
    assert len(hook) == 2, "pretool_hook was renamed; this guard is now blind"
    body = hook[1]

    assert "owner_denied(" in body, (
        "pretool_hook no longer calls owner_denied — the unit plane is back to "
        "grading out-of-lane writes as clean (issue #2022)"
    )
    assert "owned_section_denial(" in body, (
        "the deny payload is no longer returned; the predicate's verdict is "
        "computed and dropped"
    )

    deny_at = body.index("owner_denied(")
    counter_at = body.index("tool_call_count[")
    assert deny_at < counter_at, (
        "the ownership deny is checked AFTER the max_tool_calls counter; a "
        "denied call never executes and must not consume the budget"
    )
