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
    """Return parsed research.json or None if missing/invalid."""
    path = Path(workspace) / "research.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


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
) -> bool:
    """Whether to veto an agent's *voluntary* stop and nudge it onward.

    True  → block the Stop: the run is unfinished and a nudge may help.
    False → allow the Stop: the project is complete, the nudge budget is
            spent, or the previous nudge produced no tool call (the agent
            isn't making progress, so another nudge won't either).

    Kept pure so the orchestrator's Stop hook stays a thin wrapper and this
    is unit-testable without a live agent.
    """
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


# ── MCP connection guard ─────────────────────────────────────────────────
# The e2e run spawns the genealogy MCP server over stdio and the agent
# researches through its tools. When that server never connects, the agent
# can't call a single research/writer tool — but nothing stops it: it flails
# (ToolSearch loops, filesystem probing, subagent connection probes) until a
# cap fires, wasting the whole wall-clock and dollar budget. Observed live:
# 65 min / $9.38 / 202 turns with zero genealogy tool calls. The CLI reports
# each server's connection state in the init system message's `mcp_servers`
# list; these helpers read it so the orchestrator can abort fast instead.

GENEALOGY_MCP_SERVER_NAME = "genealogy"

# Statuses a server will NOT recover from within the run — abort immediately.
# `pending` is deliberately excluded: it may still connect, so the orchestrator
# handles it with a slower never-reachable watchdog rather than a hard abort.
_TERMINAL_MCP_FAULTS = frozenset({"failed", "needs-auth", "disabled"})


def genealogy_mcp_status(
    mcp_servers: Any, server_name: str = GENEALOGY_MCP_SERVER_NAME
) -> str | None:
    """The genealogy server's reported connection status, or None.

    None means "cannot assess": the init message carried no `mcp_servers`
    list (older CLI), the genealogy server was not listed, or its entry had
    no string status. Callers that must distinguish "absent from a populated
    list" from "no list at all" use ``genealogy_mcp_terminal_fault``.
    """
    if not isinstance(mcp_servers, list):
        return None
    for server in mcp_servers:
        if isinstance(server, dict) and server.get("name") == server_name:
            status = server.get("status")
            return status if isinstance(status, str) else None
    return None


def genealogy_mcp_terminal_fault(
    mcp_servers: Any, server_name: str = GENEALOGY_MCP_SERVER_NAME
) -> str | None:
    """A human-readable reason if the genealogy server is in a terminal-bad
    state at session init (won't recover), else None.

    Returns None when the CLI reported no ``mcp_servers`` at all — can't
    assess, so stay backward-compatible and don't abort. Returns a reason
    when the list IS present but the genealogy server is absent from it (not
    registered) or carries a terminal status. ``connected``/``pending`` → None
    (``pending`` is left to the orchestrator's never-reachable watchdog).
    """
    if not isinstance(mcp_servers, list):
        return None
    entry = next(
        (s for s in mcp_servers if isinstance(s, dict) and s.get("name") == server_name),
        None,
    )
    if entry is None:
        others = [s.get("name") for s in mcp_servers if isinstance(s, dict)]
        return (
            f"genealogy MCP server '{server_name}' is absent from the init "
            f"mcp_servers list (servers reported: {others or 'none'})"
        )
    status = entry.get("status")
    if status in _TERMINAL_MCP_FAULTS:
        return f"genealogy MCP server '{server_name}' init status is '{status}'"
    return None
