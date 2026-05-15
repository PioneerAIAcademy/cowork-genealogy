"""Per-test skill execution via the Claude Agent SDK.

This module wires the mock MCP server, allowed/disallowed tools, hooks, and
output collection. It does not run validators or the judge — that's the
orchestrator's job.

Honors the execution caps from unit-test-spec.md §15:
- max_turns: passed directly to ClaudeAgentOptions, enforced by the SDK.
- max_wall_clock_seconds: asyncio.wait_for around the query loop. On
  timeout, aborts the run with aborted_reason="max_wall_clock_seconds".
- max_tool_calls: counted in the PreToolUse hook. The hook denies the
  over-limit call and signals stop. The run aborts with reason
  "max_tool_calls".
- max_input_tokens_per_turn: **post-hoc.** Checked on each AssistantMessage's
  `usage.input_tokens` after the turn returned. The offending turn has
  already been billed by the time we abort — this catches runaway context
  growth (a skill re-reading files until the window saturates) but does
  not prevent the over-budget call from happening. To pre-emptively cap,
  the SDK would need a pre-turn hook with token estimation; deferred.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    HookMatcher,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    query,
)

from harness.auth import AuthConfig, env_for_sdk
from harness.mock_mcp import create_mock_server


# v1 permissive allowlist + disallow-tool backstop (per the user's tightening).
BASELINE_ALLOWED = ["Read", "Write", "Edit", "Glob", "Grep", "Skill"]
DISALLOWED_BACKSTOP = ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"]

DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_MAX_TURNS = 20
DEFAULT_MAX_WALL_CLOCK_SECONDS = 300
DEFAULT_MAX_TOOL_CALLS = 50
DEFAULT_MAX_INPUT_TOKENS_PER_TURN = 200_000


# Spec §15 "Known risks": permission_mode="dontAsk" must actually block
# unlisted tools — verify on every SDK version bump. We pin a known-good
# version range and warn loudly if the installed SDK is outside it.
# Update _KNOWN_GOOD_SDK_RANGE after running the e2e against a newer
# version and confirming dontAsk still denies unlisted tools.
_KNOWN_GOOD_SDK_RANGE = (">=0.1.81", "<0.2")


def _check_sdk_version() -> str | None:
    """Return a warning string if the SDK version is outside the
    tested-known-good range; None when in range or undeterminable."""
    try:
        from importlib.metadata import PackageNotFoundError, version
        installed = version("claude-agent-sdk")
    except (ImportError, Exception):
        return None
    # Crude comparison: split on dots and compare tuples. Good enough
    # for "0.1.x" vs "0.2.x" granularity.
    try:
        parts = tuple(int(p) for p in installed.split(".")[:2])
        if parts < (0, 1) or parts >= (0, 2):
            return (
                f"claude-agent-sdk version {installed} is outside the "
                f"harness's tested-known-good range "
                f"{_KNOWN_GOOD_SDK_RANGE[0]},{_KNOWN_GOOD_SDK_RANGE[1]}. "
                f"Spec §15 known-risks: verify permission_mode='dontAsk' "
                f"still denies unlisted tools, then update "
                f"_KNOWN_GOOD_SDK_RANGE in skill_runner.py."
            )
    except (ValueError, TypeError):
        pass
    return None


class _LimitExceeded(Exception):
    """Internal sentinel for execution-limit aborts."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# Module-level set of Skill-tool input keys we've observed Claude using
# across runs. Populated by the PreToolUse hook (see `run_skill`). Used by
# `verify_skill_tool_key()` to surface SDK changes — if Claude starts
# using a key we don't handle, this set will never include "skill" or
# "name", which is the early-warning signal. Reset to empty per process.
_observed_skill_keys: set[str] = set()


def get_observed_skill_keys() -> set[str]:
    """Return the set of Skill-tool input keys observed this process.

    The e2e test asserts this is exactly {"skill"} after a real-API run,
    so we can drop the "name" fallback once we have a passing e2e on the
    pinned SDK version.
    """
    return set(_observed_skill_keys)


@dataclass
class SkillRunResult:
    text_response: str
    skills_invoked: list[str]
    tool_calls: list[dict[str, Any]]
    duration_ms: float
    usage: dict[str, Any]
    aborted_reason: str | None = None
    error: str | None = None


async def run_skill(
    *,
    user_message: str,
    workspace: Path,
    fixture_names: list[str],
    fixtures_dir: Path,
    auth: AuthConfig,
    model: str = DEFAULT_MODEL,
    max_turns: int = DEFAULT_MAX_TURNS,
    max_wall_clock_seconds: int = DEFAULT_MAX_WALL_CLOCK_SECONDS,
    max_tool_calls: int = DEFAULT_MAX_TOOL_CALLS,
    max_input_tokens_per_turn: int = DEFAULT_MAX_INPUT_TOKENS_PER_TURN,
    allowed_tools_override: list[str] | None = None,
) -> SkillRunResult:
    """Invoke the SDK against a per-test workspace and collect outputs.

    The caller is responsible for snapshotting workspace state before/after
    and running validators + judge.
    """
    mock_server, call_log, _tools_by_name = create_mock_server(
        fixture_names, fixtures_dir
    )

    if allowed_tools_override is not None:
        # Caller is asserting full control of the allowlist (typically the
        # orchestrator passing compute_allowed_tools output). Mock tools
        # registered for fixtures the skill isn't allowed to call remain
        # invisible to the SDK.
        allowed_tools = list(allowed_tools_override)
    else:
        # Standalone use of run_skill (e.g., one-off scripts): permissive
        # baseline + every loaded mock tool.
        allowed_tools = list(BASELINE_ALLOWED) + [
            f"mcp__genealogy__{name}" for name in _tools_by_name
        ]

    # Compute disallowed_tools as the fixed dangerous-tool backstop PLUS
    # every mcp__genealogy__* mock tool the skill is NOT allowed to call.
    # Belt + suspenders against the spec §15 known risk: if
    # `permission_mode="dontAsk"` ever regresses, the explicit disallow
    # list still rejects out-of-allowlist MCP calls at call time.
    allowed_set = set(allowed_tools)
    all_mock_mcp = {f"mcp__genealogy__{name}" for name in _tools_by_name}
    extra_disallowed = sorted(all_mock_mcp - allowed_set)
    disallowed_tools = list(DISALLOWED_BACKSTOP) + extra_disallowed

    skills_invoked: list[str] = []
    # Mutable counter shared between hook and loop so the hook can flag
    # over-limit calls without raising (the SDK swallows hook exceptions
    # in some paths).
    tool_call_count = {"n": 0}

    async def pretool_hook(input_data, tool_use_id, ctx):
        tool_name = input_data.get("tool_name", "")
        # Track skill invocations so we can populate skills_invoked.
        #
        # The Skill tool's input key isn't fully pinned by the SDK spec —
        # accept the two plausible names and record which one fired in a
        # side-channel set so we can verify (and tighten) post-run.
        # Documented value as of claude-agent-sdk 0.1.81: "skill".
        if tool_name == "Skill":
            tool_input = input_data.get("tool_input", {}) or {}
            skill_name = tool_input.get("skill") or tool_input.get("name")
            if skill_name:
                skills_invoked.append(skill_name)
                _observed_skill_keys.add(
                    "skill" if "skill" in tool_input else "name"
                )
        # Count MCP tool calls toward max_tool_calls. Block over-limit calls
        # with a permission deny so the SDK doesn't actually execute them; the
        # outer loop reads tool_call_count after the iteration ends and sets
        # aborted_reason.
        if tool_name.startswith("mcp__"):
            tool_call_count["n"] += 1
            if tool_call_count["n"] > max_tool_calls:
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": (
                            f"max_tool_calls ({max_tool_calls}) exceeded"
                        ),
                    },
                    "continue_": False,
                    "stopReason": "max_tool_calls",
                }
        return {}

    options = ClaudeAgentOptions(
        cwd=str(workspace),
        # v1.5 reverts to "project" only. The earlier ["user", "project"]
        # tried to match production Cowork fidelity, but production runs
        # in a fresh VM where ~/.claude/ is a known clean state — eval
        # runs on developer machines where ~/.claude/skills/ may contain
        # arbitrary custom skills that contaminate routing tests and make
        # outcomes depend on whoever happens to run the suite. Eval needs
        # reproducibility across machines and CI; "project" only achieves
        # that. The spec was updated to match.
        setting_sources=["project"],
        mcp_servers={"genealogy": mock_server},
        allowed_tools=allowed_tools,
        disallowed_tools=disallowed_tools,
        # dontAsk = "don't prompt; deny if not pre-approved." This makes
        # `allowed_tools` actually enforced at call time. bypassPermissions
        # would auto-approve everything and defeat the per-skill allowlist.
        permission_mode="dontAsk",
        model=model,
        max_turns=max_turns,
        env=env_for_sdk(auth),
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[pretool_hook])]},
    )

    text_chunks: list[str] = []
    usage: dict[str, Any] = {}
    aborted_reason: str | None = None
    error: str | None = None

    async def _consume_messages():
        nonlocal usage, error, aborted_reason
        async for message in query(prompt=user_message, options=options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        text_chunks.append(block.text)
                # Per-turn input-token cap, post-hoc: the SDK exposes usage
                # on the AssistantMessage *after* the model returned, so
                # the offending turn was already billed. This still catches
                # runaway context growth between turns — but doesn't prevent
                # the over-budget call itself. See module docstring.
                if message.usage:
                    turn_input = int(
                        message.usage.get("input_tokens", 0) or 0
                    )
                    if turn_input > max_input_tokens_per_turn:
                        raise _LimitExceeded("max_input_tokens_per_turn")
            elif isinstance(message, ResultMessage):
                usage = {
                    "duration_ms": message.duration_ms,
                    "duration_api_ms": message.duration_api_ms,
                    "num_turns": message.num_turns,
                    "is_error": message.is_error,
                    "stop_reason": message.stop_reason,
                    "total_cost_usd": message.total_cost_usd,
                    "usage": message.usage,
                }
                if message.is_error:
                    error = message.result or message.stop_reason
                    # ResultMessage.is_error is the SDK's signal for "the
                    # session ended in a recoverable API/auth/rate-limit
                    # failure." Treat it as an abort so the run doesn't
                    # get scored against the empty/partial output that
                    # landed before the failure.
                    if aborted_reason is None:
                        aborted_reason = "error"
                if message.stop_reason == "max_turns":
                    aborted_reason = "max_turns"

    start = time.perf_counter()
    try:
        await asyncio.wait_for(_consume_messages(), timeout=max_wall_clock_seconds)
    except asyncio.TimeoutError:
        aborted_reason = "max_wall_clock_seconds"
        error = f"wall-clock timeout after {max_wall_clock_seconds}s"
    except _LimitExceeded as e:
        aborted_reason = e.reason
        error = f"{e.reason} exceeded"
    except Exception as e:  # pragma: no cover — exercised in e2e
        error = f"{type(e).__name__}: {e}"
        aborted_reason = "error"

    # If the hook denied an MCP call past the limit, surface that as the abort.
    if aborted_reason is None and tool_call_count["n"] > max_tool_calls:
        aborted_reason = "max_tool_calls"
        error = f"max_tool_calls ({max_tool_calls}) exceeded"

    duration_ms = (time.perf_counter() - start) * 1000.0

    return SkillRunResult(
        text_response="".join(text_chunks),
        skills_invoked=skills_invoked,
        tool_calls=call_log,
        duration_ms=duration_ms,
        usage=usage,
        aborted_reason=aborted_reason,
        error=error,
    )
