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
import math
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

# turns.outcome, and what a reader is told for each (PR #2870 items 1b, 1c, 1e).
#
#   completed        the project reached project.status == "completed"
#   stopped          the patron pressed Stop
#   queued           the turn ended to pick up a message the patron typed mid-turn
#   budget           a budget is spent -- the nudge cap, or 1e's per-session spend bound
#   no_progress      a nudge produced no tool call, mid-research
#   decision         the agent asked something only the patron can answer (phase 3)
#   delivered        a BOUNDED request was met and the turn stopped on purpose
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
# The agent delivered what a BOUNDED request asked for and stopped on purpose.
# A new value, not `ok`: `ok` means "ended with no terminal reason" and the browser
# renders it as nothing, while a delivery has something to report.
TERMINAL_DELIVERED = "delivered"
TERMINAL_MCP_UNAVAILABLE = "mcp_unavailable"


# The signal that produces TERMINAL_DELIVERED above. Shared because BOTH planes match on
# string -- the prototype in its PreToolUse arm, the hosted alpha in `count_only` --
# and a tool name that drifts between two copies fails open on the plane holding the
# stale one: the arm simply never matches and the stop is vetoed as if the rule did
# not exist.
DELIVERED_TOOL = "mcp__genealogy__research_delivered"
# What the researcher is told when that signal fires. Kept beside the tool name for the
# same reason: both planes halt on this, and the prototype appends a one-sentence summary
# ahead of it, so its length is load-bearing there.
DELIVERED_REASON = (
    "You have delivered what this message asked for. Stopping here rather than carrying "
    "on; your next message picks up from here."
)


# The per-turn instruction that makes the halt reachable: nothing calls a tool it was
# never told about. Both hosted planes append this to their system prompt. It lives
# here, beside the tool name and the halt text, because a plane that wires the ARM
# without the GUIDANCE ships a dead rule that looks identical to a working one.
#
# IT RIDES THE SYSTEM PROMPT, NOT THE SKILL BODIES. The hook that makes this tool end a
# turn exists only on the two hosted planes, so a skill-body rule would teach every skill
# to call a tool that is inert in Cowork and in the harness that grades them.
#
# Both exclusions in the text are load-bearing. Calling it when the OBJECTIVE is finished
# would report `delivered` where `completed` is true and the run ends on its own. Calling
# it instead of asking would swallow a question nobody answers: an ask waits, a delivery
# does not. That is also why the carrier is a separate tool rather than AskUserQuestion --
# one tool carrying both speech acts leaves the hook with no discriminator.
DELIVERY_GUIDANCE = (
    "When this message asked for one bounded thing and you have produced it, WRITE YOUR "
    "REPLY FIRST -- this call ends the turn, so nothing you say after it reaches the "
    "researcher -- then call "
    "`research_delivered` with a one-sentence summary and stop: a plan the researcher "
    "asked you to stop after, a single record or lookup, or a status question such as "
    "\"where are we?\". Do not call it when the project's research objective itself is "
    "finished -- that run ends on its own -- and do not call it in place of asking the "
    "researcher a question, which waits for their answer. Its schema is deferred, so "
    "search for it by name if you do not already hold it."
)


# Delegation tools whose `run_in_background` both planes override to False.
# Lead ruling 2026-09-23, reaffirmed as the design 2026-09-29. Forcing the
# foreground does NOT serialise the work: several Agent calls in one message
# still run concurrently, so a fan-out of four extractors stays a fan-out.
#
# The PROTOTYPE's original reason, kept because it is the measurement behind the
# ruling: the worker ends a turn at the main thread's ResultMessage and closes the
# CLI, so a background agent still running then dies with it -- measured 2026-09-23
# (plan D17: both background extractors lost, the patron told their summaries would
# follow; the two lost on 2026-09-21 were sess_25297de9b15b4ef5, and carried no flag
# at all, which is why every call not explicitly False is rewritten).
#
# Shared because the hosted alpha reproduced, twice, the failure the prototype
# already fixed. The Stop hook cannot see that the turn is waiting on its own
# background subagent -- it reads `project.status` and its own counters -- so it
# nudges ("invoke the next GPS sub-skill"), and the model, told to get on with
# it, starts a DUPLICATE of the agent still running. Measured on the alpha:
# duplicate `q_001`/`q_002` from two question-selection spawns (feedback issue
# #3156), and four record-extractors relaunched synchronously while the
# background copies kept going -- one orphaned source, one extractor hung 56
# minutes, ~20 minutes of re-extraction (feedback issue #3159).
DELEGATION_TOOLS = frozenset({"Agent", "Task"})


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
    delivered: bool = False,
) -> bool:
    """Whether to veto an agent's *voluntary* stop and nudge it onward.

    True  -> block the Stop: the run is unfinished and a nudge may help.
    False -> allow the Stop: the patron stopped the run (1c), the project is complete, the
             nudge budget is spent, the previous nudge produced no tool call (the agent
             isn't making progress, so another nudge won't either), a message the patron
             typed mid-turn is waiting (1b), the agent has asked something only the patron
             can answer (the clause phase 3 fills in), the agent met a BOUNDED request and
             stopped on purpose (`delivered`), or the genealogy MCP surface is
             gone -- which neither plane can observe today, so callers leave the default.

    ``stopped`` is FIRST, ahead of everything. None of the original four paths is "the
    patron stopped", and the no-progress escape cannot stand in for one: a halted call
    still writes a tool_calls row and the counter counts ROWS, so it moves and that escape
    never fires.

    The four added flags default False, so the harness's own truth table -- which the first
    five parameters are a port of -- still describes this function exactly.

    ``delivered`` was added, removed as dead code when no caller passed it, and added back
    once one did: the router's "Bounded request or job" section (#2813 item 1) tells the
    model to stop when a bounded request is met, and without this arm THIS plane vetoed
    that stop and nudged it onward -- the exact thrash the section exists to end.
    """
    if stopped:
        return False
    if mcp_unavailable:
        return False
    if pending_user_message:
        return False
    if pending_decision:
        return False
    if delivered:
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
    delivered: bool = False,
) -> str:
    """WHY ``should_continue_run`` is about to return False.

    It mirrors that function's clause order exactly, which is the only thing keeping the
    two in agreement; a test walks both in lockstep over every combination.

    ``delivered`` was added here in the same commit as its sibling clause. It is not
    reachable from either plane yet -- the alpha ends a delivered turn through the
    PreToolUse halt rather than this path -- but a flag that returns False in one function
    and is unnameable in the other breaks the mirror this docstring promises, and the
    parity test is hand-maintained, so nothing else would have caught it.
    """
    if stopped:
        return TERMINAL_STOPPED
    if mcp_unavailable:
        return TERMINAL_MCP_UNAVAILABLE
    if pending_user_message:
        return TERMINAL_QUEUED
    if pending_decision:
        return TERMINAL_DECISION
    if delivered:
        return TERMINAL_DELIVERED
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
    """``env_int`` for a float. Same reason, same shape; a negative or non-finite value
    takes the default because every current reader is a price, an interval or a cap, and
    none of those has a meaning below zero or at ``nan``/``inf``. Those parse, so they
    reach ``on_error`` like a typo does (U23: ``-1`` meaning "cap off" was a silent $35)."""
    raw = ((os.environ if env is None else env).get(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        value = math.nan
    if not (math.isfinite(value) and value >= 0):
        if on_error is not None:
            on_error(name, raw, default)
        return default
    return value
