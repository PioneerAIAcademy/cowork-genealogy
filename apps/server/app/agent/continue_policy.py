"""How a hosted turn ends, and what its ending is called.

ONE copy for two planes. The hosted alpha (``real_agent.build_options``) and the
prototype worker (``proto/worker/options.py``) both read the outcomes, the no-project
note and the foreground rewrite from here; the worker already imports from this package
-- ``options.py`` takes ``direct_project_file_write`` and ``worker.py`` takes
``map_message``, both from ``app.agent.real_agent`` -- so a module here serves both
without a second implementation.

Neither plane vetoes a stop. Step mode ends each turn at its boundary on purpose, and
"Keep going" is the host's reply rather than a veto (docs/plan/research-step-mode.md,
section A2 and Phase 2).

Pure stdlib and no I/O beyond ``read_research_json``, so ``test_continue_policy_parity.py``
can lift the predicates into a clean namespace without importing ``claude_agent_sdk``.
"""

from __future__ import annotations

import json
import math
import os
import re
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

# turns.outcome, and what a reader is told for each (PR #2870 items 1b, 1c, 1e).
#
#   completed        the project reached project.status == "completed"
#   stopped          the patron pressed Stop
#   queued           the turn ended to pick up a message the patron typed mid-turn
#   budget           1e's per-session spend bound is spent
#   no_progress      a redelivered attempt did no work ZERO_PROGRESS_CAP times running
#   decision         the agent asked something only the patron can answer (phase 3)
#   delivered        (legacy) a bounded request met, before research_delivered was deleted
#   mcp_unavailable  the genealogy tool surface went away
#   ok               the session has no research.json; the browser shows nothing
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


# #3768: a first message that arrives before any project exists was answered from a
# lookup and ended, with no project and no research. Both hosted planes append this to
# their project note; Cowork's twin is the plugin's `no_project_route.py` hook. It lived
# in the deleted research_delivered guidance (step mode phase 2) and moved here rather
# than going with it.
NO_PROJECT_NOTE = (
    "While no project exists yet (`project_context` returns `no_project`), a request to "
    "research a person is a research job, not a single lookup: follow the research "
    "skill, which sets up the project first."
)


# Issue #4011. Before any project existed, the Kenya alpha session listed "Kenya, Civil
# Registration, deaths 1904–1967" as searchable from memory; FamilySearch has no Kenya
# collections. Issue #4125 (via the lead on #4011, 2026-11-02) did the same with a book: the
# 1895 Ayling register, for the wrong war, and footnotes no tool read. So the rule covers any
# named source. The main thread cannot call `collections_search` itself (the plugin hook
# denies it), so the sentence names the agents that hold it. Both hosted planes append it,
# and the plugin's `no_project_route.py` carries the same text to Cowork as
# `SOURCES_NOTE`; `test_the_sources_sentence_is_the_one_the_plugin_hook_adds`
# fails if the two differ.
SOURCES_GUIDANCE = (
    "Name a source, collection, book or citation only if a tool result in this session "
    "returned it; otherwise say it is unconfirmed. FamilySearch collections come from "
    "collections_search, which locality-guide and research-plan run. This rule is about "
    "what you name, not about which agent a question goes to."
)


# Set in the SDK env by both hosted planes (`real_agent._sdk_env`, the prototype worker's
# options). The plugin's `no_project_route.py` hook defines the same name and stays silent
# when it is set, so its routing text reaches Cowork only and the hosted planes keep the
# text-only fix ruled for them (issue #3768, 2026-10-27). Hook subprocesses inherit the
# CLI's env. `test_the_hosted_flag_is_the_one_the_plugin_hook_reads` fails if the two differ.
HOSTED_PLANE_ENV = "GENEALOGY_HOSTED_PLANE"


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
# already fixed. The Stop hook (since deleted) could not see that the turn was waiting
# on its own background subagent -- it read `project.status` and its own counters --
# so it nudged ("invoke the `research` skill"), and the model, told to get on with
# it, started a DUPLICATE of the agent still running. Measured on the alpha:
# duplicate `q_001`/`q_002` from two question-selection spawns (feedback issue
# #3156), and four record-extractors relaunched synchronously while the
# background copies kept going -- one orphaned source, one extractor hung 56
# minutes, ~20 minutes of re-extraction (feedback issue #3159).
#
# The Stop veto is gone (step mode phase 2), and the rewrite stays (decision 26): an
# `Agent` call with no `run_in_background` key still runs in the background, so the
# turn ends while its agent runs, and the prototype worker kills the CLI at the turn's
# first result, taking a still-running agent with it.
DELEGATION_TOOLS = frozenset({"Agent", "Task"})



def foreground_rewrite(tool_name: str, tool_input: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """An allow-with-rewrite forcing a delegation to the foreground, or None.

    One of the two hook arms that CHANGE a call rather than refusing it (the alpha's
    effort arm is the other). Returns None when the call is not a delegation, or when it
    already carries an explicit `run_in_background: False`. Every other shape is
    rewritten, because the CLI backgrounds an agent when the key is absent ("Agents run
    in the background by default", its own tool text from 2.1.215 through 2.1.308) and
    both measured incidents carried no key at all.

    It outlives the Stop veto, which never covered this: see `DELEGATION_TOOLS`. Without
    it a turn ends while its delegations still run. The prototype worker then kills the
    CLI (`_run_turn`), so the delegation dies mid-run; on the alpha its report arrives
    after the turn, where `_drain_background` discards it.
    """
    data = dict(tool_input or {})
    if tool_name not in DELEGATION_TOOLS or data.get("run_in_background") is False:
        return None
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {**data, "run_in_background": False},
        },
    }



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


# ── The completion halt (issue #3542 lead 1) ──────────────────────────────────────────
#
# Only proof-conclusion may write `project.status` (the plugin hook's OWNED_FIELDS), so a
# project completes INSIDE a main-thread Agent call to it. When that call returns, the
# main thread's next model call only paraphrases the agent's `summary_for_user`; both
# planes end the turn there instead, from PostToolUse, and show the summary itself.
# Measured live: `apps/server/dev/probe_posttool_halt.py`.

PROOF_CONCLUSION_AGENT = "proof-conclusion"

# The closing sentences proof-conclusion's `summary_for_user` ends on exactly when the
# invocation set `project.status` to `completed` (proof-conclusion.md, `### summary_for_user`):
# "for now" when the question's stop record lists unsearched sources. The halt requires one,
# so a proof-conclusion call that did NOT complete the project, running beside the one that
# did, never ends the turn on its own summary. Pinned to the agent body, both ways, by
# `eval/harness/tests/unit/test_completion_halt_parity.py`.
PROOF_CONCLUSION_FINISHED = (
    "This research is finished. If you'd like a second opinion on it, just ask.",
    "This research is finished for now. If you'd like a second opinion on it, just ask.",
)

# The runtime's frame and trailer around a subagent's return as the MODEL sees it. The
# PostToolUse `tool_response` came without them in the probe; they are stripped anyway so
# a string-shaped return parses the same. Ported from `eval/harness/harness/skill_runner.py`
# (`_HAND_BACK_HEADER`, `_AGENT_RETURN_TRAILERS`, `strip_agent_return_frame`), which this
# package cannot import.
_HAND_BACK_HEADER = re.compile(r"^\[Subagent hand-back\][^\n]*\n", re.M)
_AGENT_RETURN_TRAILERS = (
    re.compile(r"(?m)^agentId:\s*\S+.*$"),
    re.compile(r"(?s)<usage>.*?</usage>"),
)


def _agent_return_text(tool_response: Any) -> str:
    """The text of an Agent result: a dict with `content` blocks (what PostToolUse
    carries), a bare list of blocks, or a string."""
    content = tool_response.get("content") if isinstance(tool_response, Mapping) else tool_response
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, Mapping) and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "\n".join(parts)


def summary_for_user(tool_response: Any) -> str | None:
    """The `summary_for_user` an agent's return ends with: everything after its last line
    reading `---` (proof-conclusion.md, `### summary_for_user`). None when there is no
    such line or nothing follows it, which leaves the turn to end as it does today."""
    text = _agent_return_text(tool_response).replace("\r\n", "\n")
    m = _HAND_BACK_HEADER.search(text)
    if m:
        text = "\n".join(line[2:] if line.startswith("  ") else line for line in text[m.end():].split("\n"))
    for pattern in _AGENT_RETURN_TRAILERS:
        text = pattern.sub("", text)
    lines = text.split("\n")
    rules = [i for i, line in enumerate(lines) if line.strip() == "---"]
    if not rules:
        return None
    return "\n".join(lines[rules[-1] + 1:]).strip() or None


def is_proof_conclusion_call(tool_input: Any) -> bool:
    """Whether an Agent call went to proof-conclusion, by its `subagent_type` compared
    after the last `:`, as the step boundary's `bare_name` compares it: bare and
    `genealogy-research:`-prefixed were both seen in the probe."""
    name = tool_input.get("subagent_type") if isinstance(tool_input, Mapping) else None
    return isinstance(name, str) and name.rsplit(":", 1)[-1] == PROOF_CONCLUSION_AGENT


def status_before_call(research: Mapping[str, Any] | None) -> str:
    """The status a completion check compares against, read just before the call:
    `project.status`, or `"completed"` when there is no research.json to read, so the halt
    never fires on a guess."""
    if not research:
        return "completed"
    status = (research.get("project") or {}).get("status")
    return status if isinstance(status, str) else ""


def wants_status_before(data: Mapping[str, Any]) -> bool:
    """Whether a PreToolUse call is one the completion halt needs the status before: a
    main-thread (no `agent_id` key) delegation to proof-conclusion."""
    name = data.get("tool_name")
    return (
        "agent_id" not in data
        and isinstance(name, str)
        and name in DELEGATION_TOOLS
        and is_proof_conclusion_call(data.get("tool_input"))
    )


def completion_halt_summary(
    data: Mapping[str, Any],
    status_before: Any,
    research_now: Callable[[], Mapping[str, Any] | None],
) -> str | None:
    """The summary to end the turn on, or None to let it run on: the ONE predicate both
    planes' PostToolUse arms call. A main-thread proof-conclusion call that moved the
    project to `completed`, whose return carries a `summary_for_user` ending on one of
    ``PROOF_CONCLUSION_FINISHED``. The transition, not the state, so a follow-up question in
    a project already completed never ends a turn. ``research_now`` is read only once every
    cheaper test has passed."""
    if (
        not wants_status_before(data)
        or status_before == "completed"
        or not project_completed(research_now())
    ):
        return None
    summary = summary_for_user(data.get("tool_response"))
    if summary is None or not summary.endswith(PROOF_CONCLUSION_FINISHED):
        return None
    return summary


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
