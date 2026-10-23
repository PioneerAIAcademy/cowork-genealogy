"""Run every delegation in the foreground, as the hosted alpha does.

A copy of `foreground_rewrite` in apps/server/app/agent/continue_policy.py, which
this venv cannot import; tests/unit/test_foreground_rewrite_parity.py runs both
on the same inputs. The CLI backgrounds an agent when `run_in_background` is
absent ("Agents run in the background by default", 2.1.220 and 2.1.294). A run
here ends at the main thread's result, so a background agent still running then
loses its work, and the e2e Stop hook's nudge makes the model spawn a duplicate
of an agent it is still waiting on: both measured on the alpha before its
rewrite (feedback issues #3156, #3159).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

DELEGATION_TOOLS = frozenset({"Agent", "Task"})


def foreground_rewrite(tool_name: str, tool_input: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """An allow-with-rewrite forcing a delegation to the foreground, or None.

    None when the call is not a delegation, or already carries an explicit
    `run_in_background: False`. Every other shape is rewritten.
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
