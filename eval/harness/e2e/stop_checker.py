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
    """Return parsed tree.gedcomx.json or None if missing/invalid."""
    path = Path(workspace) / "tree.gedcomx.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


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
