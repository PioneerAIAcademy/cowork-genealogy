"""Whether a run keeps going, and what its ending is called.

ONE copy for two planes. The hosted alpha (``real_agent.build_options``) and the
prototype worker (``proto/worker/options.py``) both bind a ``Stop`` hook, and the worker
already imports from this package -- ``options.py`` takes ``direct_project_file_write``
and ``worker.py`` takes ``map_message``, both from ``app.agent.real_agent`` -- so a module
here serves both without a second implementation.

``eval/harness/e2e/stop_checker.py`` stays genuinely separate: the worker image does not
copy ``eval/``, and a test asserts those two trees never import each other. So there are
**two** copies, not three, and
``apps/server/tests/test_continue_policy_parity.py`` pins them against each other by
lifting both with ``ast`` -- the pattern
``eval/harness/tests/unit/test_write_lockdown_parity.py`` already uses for exactly this
problem.

Pure stdlib and no I/O beyond ``read_research_json``, so the parity test can lift the
predicates into a clean namespace without importing ``claude_agent_sdk``.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

# turns.outcome, and what a reader is told for each (research-as-a-job 1b, 1c, 1e).
#
#   completed        the project reached project.status == "completed"
#   stopped          the patron pressed Stop
#   queued           the turn ended to pick up a message the patron typed mid-turn
#   budget           a budget is spent -- the nudge cap, or 1e's per-session spend bound
#   no_progress      a nudge produced no tool call, mid-research
#   decision         the agent asked something only the patron can answer (phase 3)
#   mcp_unavailable  the genealogy tool surface went away
#
# The point of having more than one: ``complete()`` used to hardcode 'ok', so EVERY way a
# run ended looked like success -- including the two ways an unattended run actually ends.
# To a genealogist a half-finished run then reads as "nothing more was found", which is a
# correctness bug in the product rather than a cosmetic one.
TERMINAL_COMPLETED = "completed"
TERMINAL_STOPPED = "stopped"
TERMINAL_QUEUED = "queued"
TERMINAL_BUDGET = "budget"
TERMINAL_NO_PROGRESS = "no_progress"
TERMINAL_DECISION = "decision"
TERMINAL_MCP_UNAVAILABLE = "mcp_unavailable"


def read_research_json(project_dir: Path | str) -> dict[str, Any] | None:
    """``<project_dir>/research.json`` parsed, or None if missing or unusable.

    ``UnicodeDecodeError`` is caught because it is a ``ValueError``, not an ``OSError`` --
    ``read_text`` decodes before ``json`` sees the bytes, so a file with invalid UTF-8
    would otherwise propagate out of every caller. The ``isinstance`` check is
    load-bearing for the same reason: a research.json parsing to a JSON *array* is not
    None, so without it the value passes every ``is None`` test and then raises
    ``AttributeError`` on ``.get(...)``. Both matter because a Stop hook that raises ends
    the turn in error rather than letting it stop.
    """
    path = Path(project_dir) / "research.json"
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return None
    return parsed if isinstance(parsed, dict) else None


def project_completed(research: Mapping[str, Any] | None) -> bool:
    """Whether research.json says the project is done."""
    if not research:
        return False
    return (research.get("project") or {}).get("status") == "completed"


def should_continue_run(
    *,
    research: Mapping[str, Any] | None,
    nudges_used: int,
    max_nudges: int,
    tool_count: int,
    tool_count_at_last_nudge: int,
    mcp_unavailable: bool = False,
    stopped: bool = False,
    pending_user_message: bool = False,
    pending_decision: bool = False,
) -> bool:
    """Whether to veto an agent's *voluntary* stop and nudge it onward.

    True  -> block the Stop: the run is unfinished and a nudge may help.
    False -> allow the Stop: the patron stopped the run (1c), the project is complete, the
             nudge budget is spent, the previous nudge produced no tool call (the agent
             isn't making progress, so another nudge won't either), a message the patron
             typed mid-turn is waiting (1b), the agent has asked something only the patron
             can answer (the clause phase 3 fills in), or the genealogy MCP surface is
             gone -- which neither plane can observe today, so callers leave the default.

    ``stopped`` is FIRST, ahead of everything. None of the original four paths is "the
    patron stopped", and the no-progress escape cannot stand in for one: a halted call
    still writes a tool_calls row and the counter counts ROWS, so it moves and that escape
    never fires.

    The three new flags default False, so the harness's own truth table -- which the first
    five parameters are a port of -- still describes this function exactly.
    """
    if stopped:
        return False
    if mcp_unavailable:
        return False
    if pending_user_message:
        return False
    if pending_decision:
        return False
    if project_completed(research):
        return False
    if nudges_used >= max_nudges:
        return False
    if nudges_used > 0 and tool_count == tool_count_at_last_nudge:
        return False
    return True


def terminal_reason(
    *,
    research: Mapping[str, Any] | None,
    nudges_used: int,
    max_nudges: int,
    mcp_unavailable: bool = False,
    stopped: bool = False,
    pending_user_message: bool = False,
    pending_decision: bool = False,
) -> str:
    """WHY ``should_continue_run`` is about to return False.

    It mirrors that function's clause order exactly, which is the only thing keeping the
    two in agreement; a test walks both in lockstep over every combination.
    """
    if stopped:
        return TERMINAL_STOPPED
    if mcp_unavailable:
        return TERMINAL_MCP_UNAVAILABLE
    if pending_user_message:
        return TERMINAL_QUEUED
    if pending_decision:
        return TERMINAL_DECISION
    if project_completed(research):
        return TERMINAL_COMPLETED
    if nudges_used >= max_nudges:
        return TERMINAL_BUDGET
    return TERMINAL_NO_PROGRESS



# The veto text both Stop hooks send, verbatim from the harness's. It lived in TWO copies
# -- `proto/worker/options.py` and `real_agent.py` -- each with a comment saying it was
# copied from the other, which is what a shared module is for: the whole point of this
# text is that all three readers send the SAME words, and two hand-kept copies is the one
# arrangement that cannot guarantee it.
#
# The worker does not mirror the harness's `classify_hand_back` branch -- it classifies
# nothing, because the classifier reads the harness's in-process narration list and the
# prose half of #2292 has not landed, so copying a moving wording would drift the moment
# it does. Every stop either plane sees therefore takes this text, and
# `test_the_stop_hook_blocks_a_vetoable_stop_with_the_harness_reason_verbatim` reads it
# off the orchestrator and goes red when either side moves.
CONTINUE_REASON = (
    "You are mid-run in an autonomous /research session and the "
    "project is not yet complete (project.status is not "
    "'completed'). Re-read research.json and invoke the next GPS "
    "sub-skill now; keep going until project.status is "
    "'completed' or you hit a genuine, logged blocker."
)


def env_int(name: str, default: int, *, env=None, on_error=None, floor: int = 0) -> int:
    """An int from the environment that cannot crash-loop the process that reads it.

    Every reader of these is at module scope or at container start, so a bare ``int()``
    on ``"  "`` or ``"forty"`` raises before anything binds and the orchestrator restarts
    it forever -- a typo in one environment variable taking the service down with no
    working state to read the error from. This shipped three times as three separate
    hand-written guards; the third instance is what says it belongs in one place.

    ``env=None`` rather than ``env=os.environ``: a default evaluated at DEFINITION time
    is evaluated by anything that lifts this module's functions into a clean namespace,
    which the AST parity test does -- and ``os`` is not there, so the default turns that
    test into a collection error.
    """
    raw = ((os.environ if env is None else env).get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        if on_error is not None:
            on_error(name, raw, default)
        return default
    return max(floor, value)


def env_float(name: str, default: float, *, env=None, on_error=None) -> float:
    """``env_int`` for a float. Same reason, same shape; a negative takes the default
    because every current reader is a price, an interval or a cap, and none of those has
    a meaning below zero."""
    raw = ((os.environ if env is None else env).get(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        if on_error is not None:
            on_error(name, raw, default)
        return default
    return value if value >= 0 else default
