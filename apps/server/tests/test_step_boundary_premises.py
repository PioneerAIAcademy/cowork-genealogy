"""Phase 0 of `docs/plan/research-step-mode.md`: the premises a step boundary rests on.

Step mode ends every turn at a step boundary. On the hosted planes the boundary
has to be a `PreToolUse` **deny** on the call that would start the next step, so
PR 1's design rests on facts about what the two planes' hooks already do with
such a call. This file pins those facts so PR 1 is not written against a guess,
and so a later change to either plane that would invalidate the design fails here
rather than in a billed run.

Nothing here is a product change -- phase 0 changes none. These are assertions
about code that already exists.

**Why a test rather than a note in the plan.** Each fact below was measured once,
offline, and a measurement nobody re-runs is a belief by the following month.
Two of them are also the kind that flip silently: the `Skill` gap widens the
moment someone adds `Skill` to `DELEGATION_TOOLS`, and the explicit-`False`
shape is a property of the *call*, so it changes with whatever the model emits.

**Why a deny and not `_halt`.** `_halt` (`proto/worker/options.py:441`) looks
like the right instrument -- it preempts everything and ends the turn -- and it
is wrong twice over. `options.py:363-367` records that the SDK's halt fields
"end it AFTER the call runs (CLI 2.1.220, U3 live lost-lock run 2026-10-03: the
halted record_search executed on a just-revoked token)". So the delegation a
halt fires on still executes, and the turn ends with no window for the step
report the boundary exists to produce. A plain deny is a tool RESULT the model
reads, which leaves that window open.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from app.agent import real_agent
from app.agent.continue_policy import DELEGATION_TOOLS, foreground_rewrite

PROTO = Path(__file__).resolve().parents[1] / "proto"
if str(PROTO) not in sys.path:
    sys.path.insert(0, str(PROTO))

from worker.options import is_blocked_call, make_pretool_hook  # noqa: E402


def _proto_hook(**kw):
    """The prototype's real hook, with the plumbing a unit test does not care about."""
    kw.setdefault("record", lambda row: None)
    return make_pretool_hook(
        turn_id="t1", session_id="s1", cwd=str(PROTO), config_root=str(PROTO), **kw
    )


async def _both_planes(tool_name, tool_input):
    """`(alpha_out, prototype_out)` for one call, so every case asserts on both."""
    payload = {"tool_name": tool_name, "tool_input": tool_input}
    return (
        await real_agent._pretool_hook(payload, None, None),
        await _proto_hook()(payload, "tu_1", None),
    )


def _is_foregrounded(out):
    hook = out.get("hookSpecificOutput") or {}
    return (
        hook.get("permissionDecision") == "allow"
        and hook.get("updatedInput", {}).get("run_in_background") is False
    )


# ── premise 1: which tools the rewrite actually claims ───────────────────────


def test_skill_is_not_a_delegation_tool():
    """Phase 0 item 1 asks about `Agent|Task|Skill` as one group. They are not one
    group, and `Skill` is how the router is entered -- so this is the case most
    likely to matter and the one the phase-0 line obscures."""
    assert DELEGATION_TOOLS == frozenset({"Agent", "Task"})
    assert "Skill" not in DELEGATION_TOOLS
    assert foreground_rewrite("Skill", {}) is None


@pytest.mark.parametrize("tool", sorted(DELEGATION_TOOLS))
async def test_both_planes_foreground_a_bare_delegation(tool):
    alpha, proto = await _both_planes(tool, {"prompt": "go"})
    assert _is_foregrounded(alpha), alpha
    assert _is_foregrounded(proto), proto


async def test_both_planes_have_no_opinion_on_a_skill_call():
    alpha, proto = await _both_planes("Skill", {"command": "research"})
    assert alpha == {}
    assert proto == {}


# ── premise 2: the arm order is shape-dependent ──────────────────────────────
#
# THE TRAP this file exists for. An earlier draft of the phase-0 plan proposed
# buying two live turns to learn "a deny placed after the rewrite never fires".
# That is false for one input shape, and a live n=1 would have recorded whichever
# shape the model happened to emit as the answer.


def test_the_rewrite_declines_a_call_that_is_already_in_the_foreground():
    """`foreground_rewrite` returns None on an explicit `run_in_background: False`
    (`continue_policy.py:171`). A deny placed AFTER the rewrite is therefore
    reachable for this shape and unreachable for the bare one -- so "after" is
    not a single answer, and the ordering question cannot be settled by one run."""
    for tool in sorted(DELEGATION_TOOLS):
        assert foreground_rewrite(tool, {"run_in_background": False}) is None
        assert foreground_rewrite(tool, {}) is not None
        # Only an explicit False declines. None/absent/True are all rewritten,
        # because CLI 2.1.220 backgrounds an agent when the key is absent.
        assert foreground_rewrite(tool, {"run_in_background": True}) is not None
        assert foreground_rewrite(tool, {"run_in_background": None}) is not None


@pytest.mark.parametrize("tool", sorted(DELEGATION_TOOLS))
async def test_an_already_foreground_delegation_falls_through_on_both_planes(tool):
    """The other half of the shape-dependence, at the hook level: with the key
    explicitly False both planes reach their no-opinion fallthrough, because the
    rewrite is the last arm before it."""
    alpha, proto = await _both_planes(tool, {"prompt": "go", "run_in_background": False})
    assert alpha == {}
    assert proto == {}


# ── premise 3: the shipped deny paths cannot express a step boundary ─────────


def test_the_blocked_set_cannot_deny_a_delegation():
    """`is_blocked_call` requires an `mcp__` prefix (`options.py:122-124`), so the
    e2e tree-read block cannot be reused as a step boundary however it is
    configured. Asserted in both directions: an mcp tool in the same set denies,
    which is what makes this a statement about the prefix and not about the set
    being plumbed through."""
    every = frozenset({"Agent", "Task", "person_read"})
    for tool in sorted(DELEGATION_TOOLS):
        assert is_blocked_call(tool, every) is False
    assert is_blocked_call("mcp__genealogy__person_read", every) is True


@pytest.mark.parametrize("tool", sorted(DELEGATION_TOOLS))
async def test_blocking_a_delegation_by_name_is_a_no_op_end_to_end(tool):
    """The end-to-end consequence of the above: the call is still foregrounded,
    not denied. A plan that assumed `blocked={"Agent"}` gives a deny arm would
    have been reading the parameter name rather than the predicate."""
    out = await _proto_hook(blocked=frozenset({tool}))(
        {"tool_name": tool, "tool_input": {"prompt": "go"}}, "tu_1", None
    )
    assert _is_foregrounded(out), out


# ── premise 4: the two planes are asymmetric, and the alpha is the gap ───────


async def test_the_prototype_can_end_a_turn_from_the_hook_and_the_alpha_cannot():
    """PR 1's "the alpha's hooks" item is new machinery, not a port of the
    prototype's arm, and the phase-0 line does not say so.

    The prototype's `halt` returns the SDK's turn-ending pair; the alpha's hook
    has no equivalent and says so deliberately (`real_agent.py:428-430`: "No
    `stopReason` -- a denied write is a recoverable mistake. The turn
    continues"). This asserts the asymmetry rather than leaving it in prose,
    because it is the single fact that decides how much PR 1 owes on the alpha.
    """
    halted = await _proto_hook(halt=lambda **_: "STEP BOUNDARY")(
        {"tool_name": "Agent", "tool_input": {"prompt": "go"}}, "tu_1", None
    )
    assert halted["continue_"] is False
    assert halted["stopReason"] == "STEP BOUNDARY"

    # Every arm the alpha's hook can take, on a call it has an opinion about:
    # none of them carries a turn-ending field.
    denied = await real_agent._pretool_hook(
        {"tool_name": "Write", "tool_input": {"file_path": "/p/research.json"}}, None, None
    )
    assert denied["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "continue_" not in denied and "stopReason" not in denied
