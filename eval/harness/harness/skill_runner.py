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
    RateLimitEvent,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    query,
)

from harness.auth import AuthConfig, env_for_sdk
from harness.context_policy import (
    owned_section_denial,
    owner_denied,
    protected_file_denial,
    subagent_only_denial,
    subagent_only_violation,
)
from harness.mock_mcp import create_mock_server
from harness.skill_stubs import stub_denial


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


# The SDK usually reports max_turns via ResultMessage.stop_reason (handled
# inline in _consume_messages), but has also been observed raising it as a
# bare exception instead — message text confirmed against a live run:
# "Claude Code returned an error result: Reached maximum number of turns
# (30)". The generic `except Exception` handler below used to bucket that
# under aborted_reason="error", which orchestrator.RETRYABLE_ABORT_REASONS
# retries — burning a second full attempt (and its own turn budget) on a
# test that was always going to hit the same deterministic cap again.
# Pattern-matching the message routes it to "max_turns" instead, which the
# orchestrator correctly does not retry.
_DETERMINISTIC_CAP_EXCEPTION_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"reached maximum number of turns", re.IGNORECASE), "max_turns"),
)


def _classify_exception_abort_reason(exc: Exception) -> str:
    """`aborted_reason` for a bare exception from the SDK's query() loop.

    Returns a specific deterministic-cap reason (e.g. "max_turns") when the
    exception message matches a known SDK phrasing, else the generic
    "error" bucket used for genuinely transient failures.
    """
    message = str(exc)
    for pattern, reason in _DETERMINISTIC_CAP_EXCEPTION_PATTERNS:
        if pattern.search(message):
            return reason
    return "error"


# Input keys the Skill tool may carry the invoked skill's name under.
# "skill" is the documented value as of claude-agent-sdk 0.1.81; "name"
# is a fallback we've kept because the SDK spec doesn't pin it.
SKILL_TOOL_NAME_KEYS = ("skill", "name")


def read_skill_tool_input(tool_input: dict[str, Any]) -> tuple[str | None, list[str]]:
    """Return `(skill_name, unread_keys)` for one Skill tool call.

    `unread_keys` is empty when the name was found. When it isn't — the SDK
    moved the name to a key we don't read — the caller gets the input's
    actual keys to report, because the alternative is silent: `skills_invoked`
    stays empty for a skill that really did run, every routing verdict reads
    as "never activated", and nothing anywhere says why.
    """
    for key in SKILL_TOOL_NAME_KEYS:
        value = tool_input.get(key)
        if value:
            return value, []
    return None, sorted(tool_input)


# Longest argument value kept per built-in tool call. Run logs are committed,
# and an untruncated Write/Edit argument would carry whole file bodies into
# the corpus. 200 chars keeps the diagnostic part of every argument we care
# about (a Read `file_path`, a Skill name, a Grep pattern) and bounds the rest.
BUILTIN_ARG_TRUNCATE = 200

# (tool_name, arg_key) pairs exempted from BUILTIN_ARG_TRUNCATE (issue #2020,
# absorbed into #2189). The cap's stated purpose is bounding a Read/Grep/
# Write/Edit-shaped argument; it was applied uniformly to every built-in
# argument instead, which also cut the Agent tool's `prompt` — the delegation
# contract between a routing skill and its agent — to 200 characters. Measured
# at 4a6cfad44 over the five committed record-extraction run logs
# (`git ls-files eval/runlogs/unit/record-extraction`, no `.ann.json`): 143 of
# 145 Agent prompts were exactly 200 characters long.
# record-extraction/SKILL.md's prohibitions that live only in that message
# (never frame the delegation as a "fix"; never
# instruct identity-confidence assignment; pass project_path; phrase
# looking_for as a search key; carry recordId/logId/open question ids) were
# consequently unauditable from any committed run log.
_UNTRUNCATED_ARGS: set[tuple[str, str]] = {("Agent", "prompt")}


def builtin_call_record(
    tool_name: str, input_data: dict[str, Any]
) -> dict[str, Any] | None:
    """Return a run-log record for one **built-in** tool call, or None for MCP.

    The harness records MCP calls two ways (`tool_calls` from the mock,
    `attempted_mcp_calls` off the message stream) and Skill calls a third
    (`skills_invoked`), but nothing recorded plain built-ins. A subagent told
    to `Read` a reference file therefore left no trace whether it read the
    file, skipped it, or read the wrong one — the run only differed in its
    assertion values, so the failure had to be diagnosed by hand. This closes
    that blind spot at the one site that sees every call, including calls made
    inside a Task-spawned subagent.

    `agent_id` is present only when the hook fires inside a subagent (see
    context_policy), so it is the field that distinguishes "the extractor
    agent read it" from "the main thread read it" — the exact question a
    delegated-reference design has to answer.
    """
    if tool_name.startswith("mcp__"):
        return None
    tool_input = input_data.get("tool_input") or {}
    record: dict[str, Any] = {
        "tool": tool_name,
        "args": {
            key: str(value) if (tool_name, key) in _UNTRUNCATED_ARGS
            else str(value)[:BUILTIN_ARG_TRUNCATE]
            for key, value in tool_input.items()
        },
    }
    agent_id = input_data.get("agent_id")
    if agent_id:
        record["agent_id"] = agent_id
    return record


# A subscription quota is deterministic until the seat's window resets, so it is
# NOT transient: retrying burns attempts in seconds against a limit that clears
# in hours, and the suite then ships an ungraded test as a real result. Kept out
# of `_ALWAYS_RETRYABLE_ABORTS` (orchestrator) and `_TRANSIENT_ABORT_REASONS`
# (run_tests) deliberately — membership in either restores the retry or feeds
# the abort-storm breaker's ratio arithmetic.
QUOTA_ABORT_REASON = "quota_exhausted"

# Display prose, localized to the seat and CLI-version-dependent. Observed once,
# in eval/runlogs/unit/convert-dates/v1_2026-09-01_14-32-09.json:
#   "You've hit your limit · resets 4pm (Africa/Lagos)"
# It is the LAST resort, never the primary predicate — the structured signals in
# `_quota_evidence` are checked first. This exists only so a quota that emits
# none of them is still caught rather than retried three times.
# Subscription prose only. `"rate limit"` is deliberately NOT here: it matches
# Anthropic's own 429 body text, which in `api_key` mode is a per-minute org
# limit that clears in under a minute — see the predicate note below.
_QUOTA_TEXT_MARKERS = ("hit your limit", "usage limit")


def _looks_like_quota(
    signals: dict[str, Any],
    error_text: str | None,
    response_text: str | None = None,
) -> bool:
    """True when this run ended on the SEAT'S SUBSCRIPTION limit, not a blip.

    Only one signal classifies, and the choice is deliberate. `RateLimitEvent`
    carries a `rate_limit_type` whose every literal is a subscription window —
    `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `overage` —
    so `status == "rejected"` cannot be produced by a per-minute API limit.

    `api_error_status == 429` and `assistant_error == "rate_limit"` are captured
    as EVIDENCE but do not classify, because either can come from a per-minute
    org limit in `api_key` mode, which this repo twice calls transient
    (`harness/auth.py:151`, `harness/judge.py`). Treating one as a quota would
    stop the suite and discard a whole paid `make eval-skill` slot over a limit
    that had already cleared — a worse failure than the retry this change
    exists to remove, and one this PR briefly introduced (review of #2326).

    The asymmetry is the argument: a false positive throws away a paid run; a
    false negative merely returns the old three-retry behaviour. Recall is not
    worth that trade here.

    Which structured signal a real subscription quota actually emits remains
    UNVERIFIED — one cannot be forced on demand. Whichever signals fire are
    recorded in `runs[].error` on any run that aborts, so the next occurrence
    settles it from the run log without another paid suite. A healthy run
    persists none of them: `_format_quota_evidence` drops the None ones and
    `error` is assigned on failure paths only.
    """
    if signals.get("rate_limit_status") == "rejected":
        return True
    # Both text sources. The one occurrence in the corpus
    # (convert-dates/v1_2026-09-01_14-32-09.json, ut_convert_dates_012) has
    # `error: null` and carries the prose in `output.text_response`, so a
    # fallback that reads only the SDK's error text misses the very case it
    # was written for and the run is retried three times anyway.
    text = f"{error_text or ''}\n{response_text or ''}".lower()
    return any(marker in text for marker in _QUOTA_TEXT_MARKERS)


def _format_quota_evidence(signals: dict[str, Any], error_text: str | None) -> str:
    """The SDK's own error text, plus whichever structured signals fired.

    `error` is the run's only free-form field (`{"type": ["string","null"]}`),
    and the run object is `additionalProperties: false`, so this is where the
    evidence goes without widening the schema past the `error` key itself. The
    verbatim SDK text stays first so nothing is lost by the annotation.
    """
    fired = {k: v for k, v in signals.items() if v is not None}
    base = error_text or ""
    if not fired:
        return base
    detail = " ".join(f"{k}={v}" for k, v in sorted(fired.items()))
    return f"{base} [rate-limit signals: {detail}]".strip()


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
    # Subagent-only tools the MAIN thread tried to call and was denied, as
    # {"tool", "args"} (see harness.context_policy). Empty is the healthy
    # case. This is the deterministic routing signal: the judge cannot see a
    # denied call, and grading routing by transcript inference is what made
    # ut_015 detect the violation ~1-in-8.
    blocked_context_calls: list[dict[str, Any]] = field(default_factory=list)
    # Raw Write/Edit/NotebookEdit calls to a protected project file
    # (research.json / tree.gedcomx.json) the main thread tried and was denied,
    # as {"tool", "args"} (see harness.context_policy.protected_file_denial).
    # Empty is the healthy case. Like blocked_context_calls, the hook blocks the
    # call so it never reaches `tool_calls` — this is the only place the raw-write
    # attempt is visible, and the universal validator asserts it stays empty
    # (issue #1493).
    blocked_protected_writes: list[dict[str, Any]] = field(default_factory=list)
    # `research_append` ops the SHIPPED ownership rule refuses — a section routed
    # to an owning agent reached by someone else, a routed claim, or a known agent
    # reaching outside its own lane — as {"tool", "args", "section", "rule",
    # "caller"} (see harness.context_policy.owner_denied). Empty is the healthy
    # case, and the universal validator asserts that.
    #
    # Until issue #2022 this plane called the predicate NOWHERE, while the e2e
    # orchestrator, Cowork and the hosted path all bound it.
    #
    # What that absence cost is PREVENTION, not detection -- the earlier claim
    # here, that runs graded clean while writing `conflicts`, is refuted by the
    # run logs: the passing runs never wrote the section, and both runs that did
    # failed on the existing universal `test_ownership_table` (@chesworthrm).
    # What that check cannot do is stop the write landing. Once `conflicts` is
    # cleared, `research_append`'s own `conflictedSourceInvariants` correctly
    # sees nothing unresolved and correctly allows a tier, so the chain completes
    # before any validator runs.
    #
    # It also reaches two cases the manifest check cannot: it keys on the calling
    # AGENT rather than the skill's frontmatter name (test_universal.py:475), and
    # it runs on negative tests, which test_universal.py:464 skips.
    blocked_owned_section_writes: list[dict[str, Any]] = field(default_factory=list)
    # One entry per Skill call whose input carried the skill name under no key
    # this harness reads, holding that input's actual keys. Non-empty means the
    # SDK's Skill-tool contract moved and `skills_invoked` is undercounting.
    unread_skill_calls: list[list[str]] = field(default_factory=list)
    # Every built-in (non-MCP) tool call the run emitted, as
    # {"tool", "args", "agent_id"?} — see builtin_call_record for why this
    # exists. Telemetry only: nothing reads it to gate, grade, or abort.
    builtin_tool_calls: list[dict[str, Any]] = field(default_factory=list)
    # True when the run ended before a ResultMessage ever arrived even though
    # it is NOT an abort — currently only the negative-test routing
    # short-circuit (issue #2189). On that path num_turns is real (turns_seen
    # survives regardless of exit path), but output_tokens has no real answer:
    # no partial token count exists before a ResultMessage. This says so
    # instead of leaving 0 indistinguishable from "the skill used no tokens."
    no_result_message: bool = False


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
    allowed_tools_override: list[str] | None = None,  # IGNORED — see below
    routing_short_circuit_skills: set[str] | None = None,
    stub_skills: dict[str, str | None] | None = None,
    declared_tools: set[str] | None = None,
) -> SkillRunResult:
    """Invoke the SDK against a per-test workspace and collect outputs.

    The caller is responsible for snapshotting workspace state before/after
    and running validators + judge.

    `allowed_tools_override` is accepted but **explicitly ignored** — the
    session now grants every registered MCP tool (issue #1748). The
    parameter survives so the acceptance test can pass a restrictive
    list and prove it has no effect; deleting it would make the test
    non-discriminating (it would pass on main too).

    `declared_tools` is the BARE tool names this skill claims in its own
    `allowed-tools` (`allowed_tools.declared_skill_tools`) — NOT the unioned
    allowlist. It scopes the per-context policy: a skill that declared
    `image_read` may call it on the main thread (search-images browses volumes
    that way); one that holds it only via the agent-union must delegate.
    Omitting it means "declared nothing", so the guard applies to every
    guarded tool.
    """
    mock_server, call_log, tools_by_name = create_mock_server(
        fixture_names, fixtures_dir, workspace=workspace
    )

    # Permissive: baseline + every registered mock tool, matching
    # production (issue #1748). Per-skill narrowing was retired because
    # `allowed-tools` frontmatter is a grant, not a restriction —
    # deriving a deny list as its complement inverted the field's
    # documented meaning. The advisory test_tool_allowlist validator
    # still warns on undeclared tool calls without failing the test.
    allowed_tools = list(BASELINE_ALLOWED) + [
        f"mcp__genealogy__{name}" for name in tools_by_name
    ]
    disallowed_tools = list(DISALLOWED_BACKSTOP)

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
    routing_resolved: dict[str, Any] = {"v": False, "tool_use_id": None}
    _short_circuit = routing_short_circuit_skills or set()
    # Positive-test sub-skill stubbing (`execution.stub_skills`). Distinct from
    # the negative-test short-circuit above: that one DENIES AND STOPS, because
    # a negative test's verdict is sealed the moment routing happens. A positive
    # test still has work to do after the hand-off (its closing log entry and
    # summary), so this one DENIES AND CONTINUES — the delegation is recorded in
    # skills_invoked, the callee never executes, and the caller finishes normally.
    # Maps skill name -> canned response (None = bare deny); see skill_stubs.py
    # for which form a given hand-off needs.
    _stub_skills = stub_skills or {}
    # Main-thread calls to subagent-only tools, denied by the hook below.
    blocked_context_calls: list[dict[str, Any]] = []
    # Raw writes to a protected project file, denied by the hook below.
    blocked_protected_writes: list[dict[str, Any]] = []
    blocked_owned_section_writes: list[dict[str, Any]] = []
    # Skill calls whose name we couldn't read (see read_skill_tool_input).
    unread_skill_calls: list[list[str]] = []
    # Every built-in (non-MCP) tool call, for telemetry only — see
    # builtin_call_record. Collected in the hook rather than off the message
    # stream because the hook is the only site that sees calls made inside a
    # Task-spawned subagent, which is where reference reads actually happen.
    builtin_tool_calls: list[dict[str, Any]] = []

    async def pretool_hook(input_data, tool_use_id, ctx):
        tool_name = input_data.get("tool_name", "")
        # Telemetry only — never gates, denies, or counts toward any limit.
        if (builtin_record := builtin_call_record(tool_name, input_data)):
            builtin_tool_calls.append(builtin_record)
        # Track skill invocations so we can populate skills_invoked.
        if tool_name == "Skill":
            tool_input = input_data.get("tool_input", {}) or {}
            skill_name, unread_keys = read_skill_tool_input(tool_input)
            if not skill_name:
                unread_skill_calls.append(unread_keys)
            else:
                skills_invoked.append(skill_name)
                # Negative-test routing short-circuit: the correct skill was
                # invoked, so the routing verdict is decided. skills_invoked
                # already holds it (recorded just above), so denying the
                # launch and stopping loses no grading signal while skipping
                # the routed-to skill's (often very expensive) execution.
                if skill_name in _short_circuit:
                    routing_resolved["v"] = True
                    routing_resolved["tool_use_id"] = tool_use_id
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
                # Positive-test stub: record the hand-off, skip the callee's
                # execution, but let this run finish its own remaining work —
                # handing back the canned response when the caller reads one.
                if skill_name in _stub_skills:
                    return stub_denial(skill_name, _stub_skills[skill_name])
        # Per-context tool policy: deny a subagent-only tool (see
        # context_policy.SUBAGENT_ONLY_TOOLS — image_read, extraction_append) on
        # the main thread UNLESS this skill declared it itself. Checked BEFORE
        # the max_tool_calls counter — a denied call never executes, so it
        # shouldn't consume the budget (same ordering rationale as the e2e
        # tree-read block).
        violation = subagent_only_violation(input_data, declared_tools)
        if violation:
            blocked_context_calls.append(
                {
                    "tool": violation,
                    "args": dict(input_data.get("tool_input") or {}),
                }
            )
            return subagent_only_denial(violation)
        # Protected-file lockdown: deny a raw Write/Edit/NotebookEdit to
        # research.json / tree.gedcomx.json — creates included — which must go
        # through the MCP writer tools that validate before persisting (issue
        # #1493). Denies identically to the three shipping copies (no
        # bootstrap-create exemption): `project_create` (#1690) now seeds both
        # files in one validated call, so no skill raw-creates them. The decision
        # (protected basename? — with the never-raise fail-open) lives in the
        # unit-tested `protected_file_denial`; here we only record the block.
        # Checked BEFORE the max_tool_calls counter for the same reason as the
        # block above — a denied call never executes, so it must not consume the
        # budget.
        protected_denial = protected_file_denial(
            tool_name, input_data.get("tool_input")
        )
        if protected_denial is not None:
            blocked_protected_writes.append(
                {
                    "tool": tool_name,
                    "args": dict(input_data.get("tool_input") or {}),
                }
            )
            return protected_denial
        # Section-ownership lockdown: deny a `research_append` op the SHIPPED
        # ownership rule refuses — reached through `context_policy`'s re-export of
        # the hook's own predicate, never a second copy of the maps (a copy of
        # this rule drifted once already; see
        # test_no_unregistered_copy_of_the_lockdown_exists).
        #
        # This plane called the predicate nowhere until issue #2022, while the e2e
        # orchestrator, Cowork and the hosted path all bound it. What that cost is
        # PREVENTION, not detection: the universal test_ownership_table already
        # fails such a run after the fact, but cannot stop the write landing (see
        # the field's own comment above). Checked BEFORE the
        # max_tool_calls counter for the same reason as the two blocks above: a
        # denied call never executes, so it must not consume the budget.
        #
        # The decision (which arm, and the caller identity) lives in the
        # unit-tested predicate; the payload text comes from
        # `owned_section_denial`, which branches on `rule` rather than on the
        # shape of the section string — a `declaration` denial carries a dotted
        # `section.field` that keys neither owner map.
        # isinstance-guarded for consistency with the two neighbours: the shipped
        # hook checks this before calling owner_denied, and protected_file_denial
        # above guards it internally. A truthy non-dict raises inside the
        # predicate. Not shown to be reachable — the SDK catches the exception
        # rather than killing the run — so this is consistency, not a bug fix.
        raw_input = input_data.get("tool_input")
        denied = owner_denied(
            tool_name, raw_input if isinstance(raw_input, dict) else {}, input_data
        )
        if denied is not None:
            section, rule, caller = denied
            blocked_owned_section_writes.append(
                {
                    "tool": tool_name,
                    "args": dict(input_data.get("tool_input") or {}),
                    "section": section,
                    "rule": rule,
                    "caller": caller,
                }
            )
            return owned_section_denial(denied)
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
    # Turns counted as they stream, NOT read back off the ResultMessage.
    # `usage` is populated only in the ResultMessage branch below, and a
    # wall-clock timeout cancels this coroutine before that message ever
    # arrives — so on the timeout path `usage` is always `{}` and cannot tell
    # a run that did work from one that never started. This counter is the
    # only progress signal that survives cancellation, and the retry guard
    # in the orchestrator depends on it (`_is_zero_progress_timeout`).
    # A mutable holder because the nested consumer rebinds `usage` wholesale.
    turns_seen: dict[str, int] = {"n": 0}
    # Set on the routing short-circuit path when no ResultMessage arrived, so
    # output_tokens: 0 there is legible as "no real count exists" rather than
    # "the skill used no tokens" (issue #2189). A mutable holder, not read
    # straight off routing_resolved["v"]: guarded on `usage` being empty at
    # the point it is set, so a genuine trailing ResultMessage (raced ahead of
    # the flag becoming visible) is never mistaken for one that never arrived.
    no_result_message_flag: dict[str, bool] = {"v": False}
    # Rate-limit evidence, collected from all three places the SDK offers it and
    # recorded whether or not any fired. Every key stays present-but-None on a
    # healthy run so a future occurrence shows which signals a real subscription
    # quota actually emits — that question is currently unverified and cannot be
    # settled by forcing a quota on demand.
    rate_limit_signals: dict[str, Any] = {
        "api_error_status": None,
        "assistant_error": None,
        "rate_limit_status": None,
        "resets_at": None,
        "rate_limit_type": None,
    }
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
            if isinstance(message, RateLimitEvent):
                # The CLI emits this whenever rate-limit state transitions. It
                # is in the SDK's Message union and streamed straight past this
                # loop until now — `status == "rejected"` is the limit actually
                # being hit, as opposed to `allowed_warning` approaching it.
                info = message.rate_limit_info
                rate_limit_signals["rate_limit_status"] = getattr(info, "status", None)
                rate_limit_signals["resets_at"] = getattr(info, "resets_at", None)
                rate_limit_signals["rate_limit_type"] = getattr(
                    info, "rate_limit_type", None
                )
            elif isinstance(message, AssistantMessage):
                turns_seen["n"] += 1
                # One of the AssistantMessageError literals; "rate_limit" is the
                # one that matters here. Absent on a healthy turn.
                if getattr(message, "error", None):
                    rate_limit_signals["assistant_error"] = message.error
                # Collected per-turn, not appended to text_chunks block by
                # block: multiple TextBlocks in one AssistantMessage are the
                # same utterance, but two different AssistantMessages are two
                # different turns and must not run together (issue #2189 —
                # measured at 4a6cfad44 over every committed run log under
                # eval/runlogs/unit/ (`git ls-files`, no `.ann.json`): 1,385
                # of 1,755 texted runs carried a word-final ./!/?/` against a
                # capital with no boundary between them).
                turn_text_parts: list[str] = []
                # True when THIS message carries the ToolUseBlock the hook
                # denied for routing. Checking message CONTENT rather than
                # the routing_resolved["v"] flag alone is what makes the stop
                # point exact: the flag can already be true by the time a
                # LATER message (the model reacting to the denial) streams
                # in, and stopping on "whatever arrives next" would record
                # that reaction as the skill's own turns and text (review of
                # #2189, round 2).
                routed_call_seen = False
                for block in message.content:
                    if isinstance(block, TextBlock):
                        turn_text_parts.append(block.text)
                    elif isinstance(block, ToolUseBlock):
                        if block.id == routing_resolved["tool_use_id"] or (
                            routing_resolved["v"]
                            and routing_resolved["tool_use_id"] is None
                            and block.name == "Skill"
                            and read_skill_tool_input(dict(block.input or {}))[0]
                            in _short_circuit
                        ):
                            routed_call_seen = True
                        if block.name.startswith("mcp__"):
                            attempted_mcp_calls.append(
                                {"tool": block.name, "args": dict(block.input or {})}
                            )
                if turn_text_parts:
                    text_chunks.append("".join(turn_text_parts))
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
                if routed_call_seen:
                    # Negative-test routing short-circuit: the hook denied the
                    # correct-skill launch the instant it saw the ToolUseBlock
                    # above and set routing_resolved. The SDK does NOT honor
                    # the hook's `continue_: False` to end the run (it just
                    # retries other tools), so we stop consuming here — the
                    # routing verdict is already captured in skills_invoked.
                    #
                    # A quota rejection can arrive as a RateLimitEvent BEFORE
                    # this message — rate_limit_signals is already populated
                    # in that case — and the classification below normally
                    # only runs from a ResultMessage, which this path never
                    # reaches. Check it here too: #2192's whole point is that
                    # the suite must stop submitting once a real subscription
                    # quota is hit, and it can only do that off
                    # aborted_reason, so a quota that happens to coincide with
                    # a routing short-circuit must not go undetected.
                    if aborted_reason is None and _looks_like_quota(
                        rate_limit_signals, None, "".join(text_chunks)
                    ):
                        aborted_reason = QUOTA_ABORT_REASON
                        error = _format_quota_evidence(rate_limit_signals, None)
                    # No ResultMessage will arrive on this path in the common
                    # case (the downstream skill never launched), so `usage`
                    # never gets its SDK-reported fields — UNLESS one already
                    # arrived from an earlier iteration before the flag became
                    # visible here, guarded against by checking `usage` is
                    # still empty before touching it, so a genuine
                    # ResultMessage's real num_turns is never overwritten by
                    # the manufactured count below. turns_seen counts every
                    # AssistantMessage regardless of exit path, the same
                    # counter the wall-clock-timeout path below uses for the
                    # identical reason. output_tokens has no real answer
                    # either way pre-ResultMessage; no_result_message_flag
                    # says so instead of leaving a fabricated 0
                    # indistinguishable from "the skill used no tokens."
                    if not usage:
                        usage["num_turns"] = turns_seen["n"]
                        no_result_message_flag["v"] = True
                    return
            elif isinstance(message, ResultMessage):
                usage = {
                    "duration_ms": message.duration_ms,
                    "duration_api_ms": message.duration_api_ms,
                    "num_turns": message.num_turns,
                    "is_error": message.is_error,
                    "stop_reason": message.stop_reason,
                    "total_cost_usd": message.total_cost_usd,
                    "usage": message.usage,
                    # Per-model ledger, keyed by model id, each entry carrying
                    # inputTokens / outputTokens / cacheReadInputTokens /
                    # cacheCreationInputTokens. This is the authoritative token
                    # count: the CLI documents it as covering the same
                    # query-pipeline calls as `total_cost_usd` and sharing its
                    # lifecycle, whereas `usage` above may be a per-turn
                    # main-loop value. A skill that delegates to a plugin agent
                    # on its own `model:` pin shows up here as a second key and
                    # nowhere in `usage`. See orchestrator._skill_tokens.
                    "model_usage": message.model_usage,
                }
                rate_limit_signals["api_error_status"] = getattr(
                    message, "api_error_status", None
                )
                if message.is_error:
                    # ResultMessage.is_error is the SDK's signal for "the
                    # session ended in a recoverable API/auth/rate-limit
                    # failure." Treat it as an abort so the run doesn't
                    # get scored against the empty/partial output that
                    # landed before the failure.
                    #
                    # Split the rate-limit case back out of that bucket: a
                    # quota is NOT recoverable on this suite's timescale, and
                    # bucketing it under "error" retried it three times in
                    # seconds and then shipped the run as releasable (#2192).
                    error = _format_quota_evidence(
                        rate_limit_signals, message.result or message.stop_reason
                    )
                    if aborted_reason is None:
                        aborted_reason = (
                            QUOTA_ABORT_REASON
                            if _looks_like_quota(
                                rate_limit_signals,
                                message.result or message.stop_reason,
                                "".join(text_chunks),
                            )
                            else "error"
                        )
                if message.stop_reason == "max_turns":
                    aborted_reason = "max_turns"
            # No catch-all fallback keyed on routing_resolved["v"] alone, on
            # purpose: that flag can already be true on the very first
            # iteration (set during hook-driving, before any message is
            # delivered), so a check keyed on the flag alone — checked every
            # iteration regardless of message type — fires on whatever
            # happens to arrive first, not on the message that actually
            # carries the routed tool_use_id. Measured: a RateLimitEvent
            # arriving before the routed AssistantMessage tripped exactly
            # that, returning at turns_seen["n"] == 0 before the hand-off
            # message was ever processed. The AssistantMessage branch above
            # is the only correct stop point for a run that has one.
            #
            # The hook's tool_use_id is `str | None` on the SDK's own hook
            # request type (read with `.get()`), so there can in principle be
            # no id to key on. That case is covered inside the
            # AssistantMessage branch above too — by matching the
            # ToolUseBlock's own Skill name against `_short_circuit` when the
            # id is absent, not by a second flag-only check after the message
            # is processed. A flag-only check here, even gated on the id
            # being absent, still fires on whichever message arrives first
            # once the flag is set (e.g. an earlier RateLimitEvent), dropping
            # the hand-off exactly like the bug this PR fixes — reproduced
            # and removed during review (round 3).
            #
            # The two remaining orderings — the hand-off consumed before the
            # hook runs, or the routed ToolUseBlock never appearing on the
            # stream at all — are accepted rather than closed: closing them
            # with a flag check would bring back the dropped-hand-off bug
            # this PR fixes, since the flag can be true before the hand-off
            # message is ever processed. When routed_call_seen never fires,
            # the loop keeps consuming until the stream ends naturally
            # (StopAsyncIteration, a cap, or a timeout already handle that
            # case).

    start = time.perf_counter()
    try:
        await asyncio.wait_for(_consume_messages(), timeout=max_wall_clock_seconds)
    except asyncio.TimeoutError:
        aborted_reason = "max_wall_clock_seconds"
        error = f"wall-clock timeout after {max_wall_clock_seconds}s"
        # No ResultMessage arrived (the wait_for cancelled the consumer), so
        # `usage` is empty. Record the turns actually streamed so the caller
        # can tell a slow run from one that never started — without this the
        # orchestrator's zero-progress retry guard would fire on EVERY
        # wall-clock abort and retry slow tests until the attempt budget ran
        # out, at 3x the tokens.
        usage["num_turns"] = turns_seen["n"]
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
        aborted_reason = _classify_exception_abort_reason(e)
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
    #
    # Exempt a genuine subscription-quota classification from that clearing:
    # #2192 depends on aborted_reason surviving so the suite-level breaker can
    # see it and stop submitting. A real quota rejection is real regardless of
    # whether routing also happened to resolve on the same run — clearing it
    # here would silently discard the one signal that decision is made from.
    if routing_resolved["v"] and aborted_reason != QUOTA_ABORT_REASON:
        aborted_reason = None
        error = None

    duration_ms = (time.perf_counter() - start) * 1000.0

    return SkillRunResult(
        # Turn-separated, not "".join: two AssistantMessages' text must not
        # run together (issue #2189). Each text_chunks entry is already one
        # turn's own TextBlocks joined with no separator (they're one
        # utterance); "\n\n" is the boundary between separate turns.
        text_response="\n\n".join(text_chunks),
        skills_invoked=skills_invoked,
        tool_calls=call_log,
        duration_ms=duration_ms,
        usage=usage,
        aborted_reason=aborted_reason,
        error=error,
        attempted_mcp_calls=attempted_mcp_calls,
        blocked_context_calls=blocked_context_calls,
        blocked_owned_section_writes=blocked_owned_section_writes,
        blocked_protected_writes=blocked_protected_writes,
        registered_mcp_tools=set(tools_by_name.keys()),
        unread_skill_calls=unread_skill_calls,
        builtin_tool_calls=builtin_tool_calls,
        no_result_message=no_result_message_flag["v"],
    )
