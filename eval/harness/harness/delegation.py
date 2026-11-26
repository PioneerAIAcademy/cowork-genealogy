"""Run every delegation in the foreground, as the hosted alpha does.

A copy of `foreground_rewrite` in apps/server/app/agent/continue_policy.py, which
this venv cannot import; tests/unit/test_foreground_rewrite_parity.py runs both
on the same inputs. The CLI backgrounds an agent when `run_in_background` is
absent ("Agents run in the background by default", 2.1.220 and 2.1.294). A run
here ends at the main thread's result, so a background agent still running then
loses its work, and a nudge to continue (the alpha's Stop hook, deleted in step mode
phase 2) made the model spawn a duplicate of an agent it was still waiting on: both
measured on the alpha before its rewrite (feedback issues #3156, #3159).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

DELEGATION_TOOLS = frozenset({"Agent", "Task"})
PLUGIN_PREFIX = "plugin:"


def foreground_rewrite(tool_name: str, tool_input: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """An allow-with-rewrite forcing a delegation to the foreground, or None.

    None when the call is not a delegation, or already carries an explicit
    `run_in_background: False` and no `plugin:` on its `subagent_type`. Every other
    shape is rewritten, the `plugin:` dropped.
    """
    data = dict(tool_input or {})
    if tool_name not in DELEGATION_TOOLS:
        return None
    name = data.get("subagent_type")
    prefixed = isinstance(name, str) and name.startswith(PLUGIN_PREFIX) and len(name) > len(PLUGIN_PREFIX)
    if prefixed:
        data["subagent_type"] = name[len(PLUGIN_PREFIX):]
    elif data.get("run_in_background") is False:
        return None
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {**data, "run_in_background": False},
        },
    }


def without_plugin_prefix(input_data: Mapping[str, Any]) -> dict[str, Any] | None:
    """`input_data` with a main-thread spawn's `plugin:` dropped, or None when it has none.

    The harness hooks run the rest of their checks on this, so a stub, a deny and the
    run-log record see the agent `foreground_rewrite` sends the call to, as the hosted
    planes do.
    """
    tool_input = input_data.get("tool_input")
    if input_data.get("tool_name") not in DELEGATION_TOOLS or input_data.get("agent_id"):
        return None
    if not isinstance(tool_input, Mapping):
        return None
    name = tool_input.get("subagent_type")
    if not (isinstance(name, str) and name.startswith(PLUGIN_PREFIX) and len(name) > len(PLUGIN_PREFIX)):
        return None
    return {**input_data, "tool_input": {**tool_input, "subagent_type": name[len(PLUGIN_PREFIX):]}}


def keeping_the_rewrite(out: dict[str, Any] | None, tool_input: Mapping[str, Any]) -> dict[str, Any]:
    """`out`, carrying the rewritten `tool_input` unless it denies or already rewrites."""
    out = dict(out or {})
    hso = dict(out.get("hookSpecificOutput") or {})
    if hso.get("permissionDecision") == "deny" or "updatedInput" in hso:
        return out
    hso.update(
        {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {**dict(tool_input), "run_in_background": False},
        }
    )
    out["hookSpecificOutput"] = hso
    return out
