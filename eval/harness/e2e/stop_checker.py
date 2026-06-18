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
    if sdk_aborted_reason == "sdk_stream_silence":
        return "inactivity"
    if sdk_aborted_reason == "error":
        return "error"

    if project_completed(research):
        return "completed"
    return "natural_end"
