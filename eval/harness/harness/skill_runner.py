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
import contextlib
import re
import sys
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
# "Task" is allowed unconditionally (matching the e2e orchestrator's
# BASELINE_ALLOWED_TOOLS): plugin subagents are staged into every workspace
# and a skill delegates via `@plugin:<name>` only when its SKILL.md says to —
# the model doesn't spawn subagents unprompted, so no per-test flag is needed.
BASELINE_ALLOWED = ["Read", "Write", "Edit", "Glob", "Grep", "Skill", "Task"]
DISALLOWED_BACKSTOP = ["Bash", "WebFetch", "WebSearch", "NotebookEdit"]

DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_MAX_TURNS = 20
DEFAULT_MAX_WALL_CLOCK_SECONDS = 300
DEFAULT_MAX_TOOL_CALLS = 50
DEFAULT_MAX_INPUT_TOKENS_PER_TURN = 200_000
# Per-message silence watchdog: if no SDK message arrives within this
# window (AssistantMessage, ResultMessage, etc.), the upstream API has
# almost certainly stalled mid-generation. Aborts with
# `sdk_stream_silence`, which the orchestrator treats as a transient
# error and retries (vs. `max_wall_clock_seconds`, which is the
# deterministic outer ceiling).
#
# 60s was the original default; empirical analysis (2026-05-24) showed
# it killed legitimate runs where the model spends a long time on a
# single generation step. Two distinct slow-step modes were observed:
# (1) extended-thinking blocks lasting 100–160s during which the API
# emits SSE keepalives but no content events, and (2) large structured-
# JSON Write turns emitting ~15+ assertions in one AssistantMessage.
# 180s comfortably exceeds both observed durations while still bailing
# out ~1.7× faster than the 300s wall-clock cap. Tests whose record
# requires longer thinking should also bump `execution.max_wall_clock_
# seconds` (see eval/tests/unit/record-extraction/*.json).
DEFAULT_SDK_MESSAGE_SILENCE_SECONDS = 180


# Spec §15 "Known risks": disallowed_tools must actually block unlisted
# tools — verify on every SDK version bump. We pin a known-good version
# range and warn loudly if the installed SDK is outside it.
# Update _KNOWN_GOOD_SDK_RANGE after running the e2e against a newer
# version and confirming disallowed_tools still denies unlisted tools.
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
                f"Spec §15 known-risks: verify disallowed_tools "
                f"still blocks unlisted tools, then update "
                f"_KNOWN_GOOD_SDK_RANGE in skill_runner.py."
            )
    except (ValueError, TypeError):
        pass
    return None


# When the harness abandons a run mid-stream (wall-clock / silence abort or
# a routing short-circuit), the SDK tears down the CLI subprocess while it may
# still be mid-hook. The CLI's hook callback then tries a control-channel
# `sendRequest` on the already-closed stream, throws "Stream closed", and bun
# dumps a minified JS stack + code frame to the subprocess's stderr. It is pure
# teardown noise — the outcome is already recorded — but on any suite with
# aborts it floods the console (see the `record-extraction` run: four aborts,
# dozens of stack-trace lines). Registering a `stderr` callback is also the
# only way to intercept it at all: with `stderr=None` the SDK leaves the
# subprocess stderr attached to our own fd (subprocess_cli.py pipes it only
# when a callback is set), so we could not filter it from Python. This callback
# drops the known-noise lines and forwards everything else, so a genuine CLI
# diagnostic still reaches the console.
_CLI_NOISE_PATTERNS = (
    re.compile(r"Error in hook callback"),
    re.compile(r"Stream closed"),
    re.compile(r"^\s*at\s"),  # JS stack frames ("at sendRequest (...)")
    re.compile(r"^\s*\d+\s*\|"),  # bun code-frame lines ("9403 | ...")
    re.compile(r"/\$bunfs/"),  # bun bundled-path frames
)


def _filter_cli_stderr(line: str) -> None:
    """SDK `stderr` callback: swallow CLI teardown noise, forward the rest.

    The SDK strips the trailing newline and skips blank lines before calling
    us, so `line` is a non-empty, right-stripped string.
    """
    if any(p.search(line) for p in _CLI_NOISE_PATTERNS):
        return
    sys.stderr.write(line + "\n")


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
    # Every MCP tool-use the model emitted, as {"tool", "args"}. Captured
    # straight off the AssistantMessages so it includes calls the mock
    # never handled (denied by the allowlist, or no fixture registered for
    # the tool). `tool_calls` only covers calls that reached the mock, so
    # the orchestrator diffs the two to detect uncovered calls.
    attempted_mcp_calls: list[dict[str, Any]] = field(default_factory=list)
    # Set of bare tool names registered in the mock MCP server (e.g.,
    # {"place_search", "wikipedia_search"}). Used by Phase 2 of the
    # unmatched-tool-call gate to distinguish Type 1 (tool doesn't exist,
    # abort) from Type 2 (wrong args to existing tool, continue to judge).
    registered_mcp_tools: set[str] = field(default_factory=set)
    # How many skill-execution attempts this result took (1 = clean first
    # try; >1 means transient stalls/errors forced a retry in
    # _execute_skill_with_retry). The keystone stall-tax signal: a suite
    # with many >1 runs is paying the cold-cache / API-stall cost the e2e
    # perf analysis flagged. Set by the retry wrapper, not run_skill.
    attempts: int = 1


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
    sdk_message_silence_seconds: int = DEFAULT_SDK_MESSAGE_SILENCE_SECONDS,
    allowed_tools_override: list[str] | None = None,
    routing_short_circuit_skills: set[str] | None = None,
) -> SkillRunResult:
    """Invoke the SDK against a per-test workspace and collect outputs.

    The caller is responsible for snapshotting workspace state before/after
    and running validators + judge.
    """
    mock_server, call_log, tools_by_name = create_mock_server(
        fixture_names, fixtures_dir, workspace=workspace
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
            f"mcp__genealogy__{name}" for name in tools_by_name
        ]

    # Compute disallowed_tools as the fixed dangerous-tool backstop PLUS
    # every mcp__genealogy__* mock tool the skill is NOT allowed to call.
    # Belt + suspenders against the spec §15 known risk: the explicit
    # disallow list rejects out-of-allowlist MCP calls at call time,
    # independent of the permission_mode setting.
    allowed_set = set(allowed_tools)
    all_mock_mcp = {f"mcp__genealogy__{name}" for name in tools_by_name}
    extra_disallowed = sorted(all_mock_mcp - allowed_set)
    disallowed_tools = list(DISALLOWED_BACKSTOP) + extra_disallowed

    skills_invoked: list[str] = []
    # Mutable counter shared between hook and loop so the hook can flag
    # over-limit calls without raising (the SDK swallows hook exceptions
    # in some paths).
    tool_call_count = {"n": 0}
    # Set by the hook when a negative test routes to its `correct_skill`:
    # the verdict is sealed the moment that skill is invoked (orchestrator
    # `_compute_outcome` grades negatives on routing, not on downstream
    # execution), so we deny the sub-skill launch and stop the run instead
    # of paying for the routed-to skill's full workload. The loop reads
    # this after consuming to force a clean (non-aborted) termination.
    routing_resolved = {"v": False}
    _short_circuit = routing_short_circuit_skills or set()

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
                # Negative-test routing short-circuit: the correct skill was
                # invoked, so the routing verdict is decided. skills_invoked
                # already holds it (recorded just above), so denying the
                # launch and stopping loses no grading signal while skipping
                # the routed-to skill's (often very expensive) execution.
                if skill_name in _short_circuit:
                    routing_resolved["v"] = True
                    return {
                        "hookSpecificOutput": {
                            "hookEventName": "PreToolUse",
                            "permissionDecision": "deny",
                            "permissionDecisionReason": (
                                f"negative-test routing to {skill_name!r} "
                                f"observed; verdict decided, stopping"
                            ),
                        },
                        "continue_": False,
                        "stopReason": "routing_resolved",
                    }
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
        # bypassPermissions auto-approves all path-level permission checks.
        # Tool-level access control is still enforced by allowed_tools /
        # disallowed_tools — dangerous tools (Bash, WebFetch, etc.) and
        # out-of-allowlist MCP tools remain blocked. The original "dontAsk"
        # mode denied Write/Edit in Claude Code >=2.1 even when those tools
        # were listed in allowed_tools, because dontAsk also blocks
        # path-level approval prompts that Write/Edit require.
        permission_mode="bypassPermissions",
        model=model,
        max_turns=max_turns,
        env=env_for_sdk(auth),
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[pretool_hook])]},
        # Intercept the CLI subprocess stderr so we can drop teardown noise
        # (see _filter_cli_stderr) instead of letting it flood the console on
        # aborted runs. Setting this is also what makes the SDK pipe stderr.
        stderr=_filter_cli_stderr,
    )

    text_chunks: list[str] = []
    attempted_mcp_calls: list[dict[str, Any]] = []
    usage: dict[str, Any] = {}
    aborted_reason: str | None = None
    error: str | None = None
    # The query() async generator, hoisted so the finally below can close it
    # deterministically on every exit path (see that finally for why).
    iterator: Any = None

    async def _consume_messages():
        nonlocal usage, error, aborted_reason, iterator
        # Manual iteration so each `__anext__()` can be wrapped in a
        # per-message silence watchdog. The SDK has no internal
        # generation-side timeout — once the control-channel
        # `initialize` succeeds, an upstream API stall mid-generation
        # would otherwise consume the entire `max_wall_clock_seconds`
        # budget before aborting. This watchdog fires faster and emits
        # a distinguishable `sdk_stream_silence` reason that the
        # orchestrator retries.
        iterator = query(prompt=user_message, options=options).__aiter__()
        while True:
            try:
                message = await asyncio.wait_for(
                    iterator.__anext__(),
                    timeout=sdk_message_silence_seconds,
                )
            except StopAsyncIteration:
                return
            except asyncio.TimeoutError:
                raise _LimitExceeded("sdk_stream_silence")
            # Negative-test routing short-circuit: the hook denied the
            # correct-skill launch and set this flag. The SDK does NOT honor
            # the hook's `continue_: False` to end the run (it just retries
            # other tools), so we stop consuming here — the routing verdict
            # is already captured in skills_invoked. This is the early-exit
            # the hook's stopReason alone can't deliver.
            if routing_resolved["v"]:
                return
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        text_chunks.append(block.text)
                    elif isinstance(block, ToolUseBlock) and block.name.startswith(
                        "mcp__"
                    ):
                        attempted_mcp_calls.append(
                            {"tool": block.name, "args": dict(block.input or {})}
                        )
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
        if e.reason == "sdk_stream_silence":
            error = (
                f"no SDK message received within "
                f"{sdk_message_silence_seconds}s — likely an upstream "
                f"API stall mid-generation"
            )
        else:
            error = f"{e.reason} exceeded"
    except Exception as e:  # pragma: no cover — exercised in e2e
        error = f"{type(e).__name__}: {e}"
        aborted_reason = "error"
    finally:
        # Close the query() generator while this event loop is still running.
        # The SDK's process_query tears down its subprocess transport only
        # inside the generator's own `finally`, and its own comment warns that
        # manual iteration / early `return` does NOT trigger it (PEP 533). On
        # the routing short-circuit, _LimitExceeded, and wall-clock-cancel
        # paths we abandon the generator mid-stream, so that teardown is left
        # to GC during asyncio.run()'s loop shutdown — which races
        # shutdown_asyncgens and prints "aclose(): asynchronous generator is
        # already running" plus a dangling "Loop ... is closed" from the
        # subprocess transport. (The subscription-auth flip changed subprocess
        # timing enough to surface this latent leak.) asyncio.wait_for has
        # fully settled _consume_messages by now, so no __anext__ is in flight
        # and this aclose can't race; the bounded wait_for guards a stuck
        # close from hanging the worker thread.
        if iterator is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(iterator.aclose(), timeout=15)

    # If the hook denied an MCP call past the limit, surface that as the abort.
    if aborted_reason is None and tool_call_count["n"] > max_tool_calls:
        aborted_reason = "max_tool_calls"
        error = f"max_tool_calls ({max_tool_calls}) exceeded"

    # A routing short-circuit is a deliberate, successful early stop — not a
    # failure. The SDK may surface the hook-initiated stop as an error/abort
    # on the trailing ResultMessage, so clear any such state and keep the
    # run clean. The downstream skill never ran; that's the whole point.
    if routing_resolved["v"]:
        aborted_reason = None
        error = None

    duration_ms = (time.perf_counter() - start) * 1000.0

    return SkillRunResult(
        text_response="".join(text_chunks),
        skills_invoked=skills_invoked,
        tool_calls=call_log,
        duration_ms=duration_ms,
        usage=usage,
        aborted_reason=aborted_reason,
        error=error,
        attempted_mcp_calls=attempted_mcp_calls,
        registered_mcp_tools=set(tools_by_name.keys()),
    )
