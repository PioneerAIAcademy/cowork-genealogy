"""Stop-condition checks.

The orchestrator uses these to translate post-SDK state into the
`stop_reason` enum from the spec. For v1, every reason is decided
*after* the SDK returns rather than via active polling — the simplest
mechanism that gives correct labels.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def read_research_json(workspace: Path) -> dict[str, Any] | None:
    """Return parsed research.json, or None if missing or unusable.

    `UnicodeDecodeError` is caught because it is a `ValueError`, not an
    `OSError` — `read_text` decodes before `json` sees the bytes, so a file with
    invalid UTF-8 would otherwise propagate out of every caller. The
    `isinstance` check is load-bearing for the same reason: a research.json
    parsing to a JSON *array* is not None, so without it the value passes every
    `is None` test and then raises `AttributeError` on `.get(...)`. Both matter
    because `pretool_hook` calls this with no `try` around it, so a raise here
    aborts the whole run instead of degrading. Mirrors the guards the sibling
    `guardrail_shadow_report._load_json` already documents.
    """
    path = Path(workspace) / "research.json"
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return None
    return parsed if isinstance(parsed, dict) else None


def read_tree_json(workspace: Path) -> dict[str, Any] | None:
    """Return parsed tree.gedcomx.json, or None if missing or unusable.

    The same two guards `read_research_json` above documents, and for the same
    reasons: `UnicodeDecodeError` is a `ValueError` rather than an `OSError`, so
    a tree written in cp1252 (the Windows default, and this team runs on Windows)
    propagated out of every caller instead of degrading; and a tree parsing to a
    JSON *array* is not None, so it passed every `is None` test and then raised
    `AttributeError` on `.get(...)`. Both now matter on the paid e2e path, where
    `collect_post_hoc_shadow` reads this file and a raise there aborts the run
    before any result file is written.
    """
    path = Path(workspace) / "tree.gedcomx.json"
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return None
    return parsed if isinstance(parsed, dict) else None


def project_completed(research: dict[str, Any] | None) -> bool:
    """Whether research.json says the project is done."""
    if not research:
        return False
    return (research.get("project") or {}).get("status") == "completed"


def should_continue_run(
    *,
    research: dict[str, Any] | None,
    nudges_used: int,
    max_nudges: int,
    tool_count: int,
    tool_count_at_last_nudge: int,
    mcp_unavailable: bool = False,
) -> bool:
    """Whether to veto an agent's *voluntary* stop and nudge it onward.

    True  → block the Stop: the run is unfinished and a nudge may help.
    False → allow the Stop: the project is complete, the nudge budget is
            spent, the previous nudge produced no tool call (the agent
            isn't making progress, so another nudge won't either), or the
            genealogy MCP surface is gone (issue #941 — see below).

    Kept pure so the orchestrator's Stop hook stays a thin wrapper and this
    is unit-testable without a live agent.
    """
    # #941, ask (3): with no genealogy tools in the session there is nothing to
    # resume into, and in the 35-minute lost run this hook vetoed the agent's
    # attempt to give up NINE times. Not the mechanism that ends such a run —
    # the orchestrator's abort returns from its message loop, and no Stop hook
    # is dispatched after that — but a hook already in flight when the abort
    # lands must not nudge the agent back into an empty tool set.
    if mcp_unavailable:
        return False
    if project_completed(research):
        return False
    if nudges_used >= max_nudges:
        return False
    if nudges_used > 0 and tool_count == tool_count_at_last_nudge:
        return False
    return True


# The hand-back form /research emits at a step boundary (lead ruling, 2026-09-07,
# issue #2292). A fixed closing line, matched literally: free-prose matching was the
# alternative the lead set aside, because the old ANNOUNCE_RE caught 15 of 41 real
# yields. The shipped skill does NOT emit this yet — #2292 lands the prose — so `step`
# is structurally 0 until then, and that is the correct result rather than a broken
# classifier. Do not loosen these to make the count non-zero.
_HAND_BACK_STEP_TAIL = ". Continue?"
_HAND_BACK_STEP_LEAD = "Next: "
_HAND_BACK_COMPLETE = "Research complete."


def classify_hand_back(text: str | None) -> str:
    """Classify an agent's closing words: "step" | "silent" | "completion_claim".

    Pure, stdlib-only, text in / class out, and deliberately takes NO `research`
    argument — issue #1104's Half B lifts this verbatim into a plugin-shipped Stop
    hook, which reads research.json itself. Keeping the status out of here is what
    makes that lift possible.

    Normalises its own input (`" ".join(text.split())`) so the two callers agree: the
    orchestrator passes a whole TextBlock, `nudge_report` passes narration text, and a
    predicate anchored to the end would otherwise behave differently on each.

    `completion_claim` is tested first; order between the two `endswith` arms is
    arbitrary, since no normalised string can end with both.

    NOTE the class is about FORM, not truth. A `completion_claim` is not by itself a
    false completion — the caller decides that by reading project.status. And a run
    that stops on a genuine logged blocker (research/SKILL.md's third legitimate
    autonomous stop) reads as `silent` here, because it names no next step; the
    taxonomy has no separate blocker class today.
    """
    t = " ".join((text or "").split())
    if t.endswith(_HAND_BACK_COMPLETE):
        return "completion_claim"
    if t.endswith(_HAND_BACK_STEP_TAIL) and _HAND_BACK_STEP_LEAD in t:
        return "step"
    return "silent"


def terminal_reason(
    *,
    research: dict | None,
    nudges_used: int,
    max_nudges: int,
    mcp_unavailable: bool,
) -> str:
    """Why `should_continue_run` is about to return False.

    That function returns a bare bool for FOUR different reasons and only two of them
    are defects. 134 of the 181 committed e2e run logs stop on `completed` — counting
    those as hand-back defects would make the rate dominated by successes, and the live
    acceptance run (which must end `completed`) would log one against itself.

    Mirrors should_continue_run's own order, which is what keeps the two in agreement.
    """
    if mcp_unavailable:
        return "mcp_unavailable"
    if project_completed(research):
        return "completed"
    if nudges_used >= max_nudges:
        return "budget"
    return "no_progress"


#: Terminal reasons whose hand-back is worth counting. `completed` is the successful
#: path and `mcp_unavailable` is infrastructure (#941) — neither says anything about
#: how the agent handed back.
COUNTED_TERMINAL_REASONS = frozenset({"budget", "no_progress"})


def hand_back_outcome(hand_back_class: str, *, project_is_completed: bool) -> tuple[str, str | None]:
    """Map a class to (counter key, reply) — the hook's branch table, made testable.

    `stop_hook` is a closure inside `run_agent` and no test drives it, so without this
    the wiring from class to reply and counter is unverified. Returns the counter key
    and the reply text, or None where the caller keeps its existing block reason.

    A `completion_claim` on a project that IS completed is a TRUTHFUL completion, not a
    false one — it counts as `step`-equivalent closure, never `false_completion`.
    """
    if hand_back_class == "completion_claim":
        if project_is_completed:
            return "terminal_completed", None
        return "false_completion", (
            "research.json still reports project.status != 'completed', so the research "
            "is not finished. Verify with research_query, then continue the loop."
        )
    if hand_back_class == "step":
        return "step", "Yes."
    return "silent", None


def derive_stop_reason(
    *,
    sdk_aborted_reason: str | None,
    research: dict[str, Any] | None,
) -> str:
    """Map (SDK abort reason, research.json state) to spec stop_reason.

    Priority: explicit SDK aborts win over project status — if a cap
    fired, we want the cap reason in the result even if the agent had
    already set status=completed before the cap.
    """
    # #941 — first, because outranking `completed` is the whole point: two of
    # the three runs lost to an absent MCP surface self-declared
    # project.status == "completed" and were reported as research failures.
    if sdk_aborted_reason == "mcp_unavailable":
        return "mcp_unavailable"
    if sdk_aborted_reason == "max_wall_clock_seconds":
        return "timeout"
    if sdk_aborted_reason == "max_tool_calls":
        return "tool_cap"
    if sdk_aborted_reason == "cost_cap":
        return "cost_cap"
    if sdk_aborted_reason == "max_turns":
        return "max_turns"
    if sdk_aborted_reason in ("sdk_stream_silence", "no_progress_stall"):
        # Both are "the agent stopped advancing": no message at all (silence)
        # or messages without progress (a stall). The error text distinguishes.
        return "inactivity"
    if sdk_aborted_reason == "error":
        return "error"

    if project_completed(research):
        return "completed"
    return "natural_end"
