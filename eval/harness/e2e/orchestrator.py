"""E2e orchestrator: load fixture → spawn agent → judge → persist.

Skeleton implementation per docs/specs/e2e-test-spec.md. The harness
is single-fixture-focused for now; the CLI wraps it for one-test or
all-tests invocation.

Real MCP server (the built TypeScript MCP server at
packages/engine/mcp-server/build/index.js) is spawned via stdio so the agent's tool
calls go to live FamilySearch. Auth comes from the host's pre-existing
~/.familysearch-mcp/tokens.json (the user must have logged in before
running tests).
"""

from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    HookMatcher,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    query,
)

from e2e.result import E2eResult, timestamp_slug, write_result_files
from e2e.stop_checker import derive_stop_reason, read_research_json, read_tree_json
from e2e import judge as judge_module


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MCP_SERVER_ENTRY = REPO_ROOT / "packages" / "engine" / "mcp-server" / "build" / "index.js"
DEFAULT_RUNLOG_ROOT = REPO_ROOT / "eval" / "runlogs" / "e2e"
DEFAULT_FIXTURES_ROOT = REPO_ROOT / "eval" / "tests" / "e2e"
DEFAULT_PLUGIN_SKILLS = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"


# Tools always allowed alongside MCP tools. See e2e-test-spec.md §6.
BASELINE_ALLOWED_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Skill",
]


@dataclass
class FixtureCaps:
    wall_clock_seconds: int = 3600
    inactivity_seconds: int = 600
    tool_calls: int = 200
    max_turns: int = 100
    max_cost_usd: float = 15.0


@dataclass
class Fixture:
    """In-memory representation of one fixture directory."""
    id: str
    dir: Path
    researcher_question: str
    tags: dict[str, str]
    agent_model: str
    judge_model: str
    caps: FixtureCaps
    expected_findings: dict[str, Any]
    starting_research_path: Path
    starting_tree_path: Path


def load_fixture(fixture_dir: Path) -> Fixture:
    """Read fixture.json + expected-findings.json from a fixture directory."""
    fixture_dir = Path(fixture_dir)
    fixture_json = json.loads((fixture_dir / "fixture.json").read_text(encoding="utf-8"))
    expected = json.loads((fixture_dir / "expected-findings.json").read_text(encoding="utf-8"))

    caps_raw = fixture_json.get("caps") or {}
    caps = FixtureCaps(
        wall_clock_seconds=caps_raw.get("wall_clock_seconds", 3600),
        inactivity_seconds=caps_raw.get("inactivity_seconds", 600),
        tool_calls=caps_raw.get("tool_calls", 200),
        max_turns=caps_raw.get("max_turns", 100),
        max_cost_usd=caps_raw.get("max_cost_usd", 15.0),
    )
    model = fixture_json.get("model") or {}
    return Fixture(
        id=fixture_json["id"],
        dir=fixture_dir,
        researcher_question=fixture_json["researcher_question"],
        tags=fixture_json.get("tags") or {},
        agent_model=model.get("agent", "claude-sonnet-4-6"),
        judge_model=model.get("judge", judge_module.DEFAULT_JUDGE_MODEL),
        caps=caps,
        expected_findings=expected,
        starting_research_path=fixture_dir / "starting-research.json",
        starting_tree_path=fixture_dir / "starting-tree.gedcomx.json",
    )


def build_workspace(fixture: Fixture, target: Path, skills_dir: Path) -> Path:
    """Populate a temp dir with fixture starting state + plugin skills."""
    target = Path(target)
    shutil.copy(fixture.starting_research_path, target / "research.json")
    shutil.copy(fixture.starting_tree_path, target / "tree.gedcomx.json")

    skills_target = target / ".claude" / "skills"
    skills_target.mkdir(parents=True, exist_ok=True)
    for skill in Path(skills_dir).iterdir():
        if skill.is_dir() and not skill.name.startswith("."):
            shutil.copytree(skill, skills_target / skill.name, dirs_exist_ok=True)
    return target


def _render_user_message(fixture: Fixture) -> str:
    """The literal user message sent to the agent. See spec §5."""
    return f"/research --autonomous {fixture.researcher_question}"


def _summarize_tool_response(content: Any) -> str:
    """Short stringification of a tool result for the run log.

    We don't need the full response in the runlog — just enough to
    diff across runs when investigating drift. ~500 chars is plenty.
    """
    try:
        text = content if isinstance(content, str) else json.dumps(content)
    except (TypeError, ValueError):
        text = repr(content)
    if len(text) > 500:
        text = text[:497] + "..."
    return text


async def _run_agent(
    *,
    fixture: Fixture,
    workspace: Path,
    mcp_server_entry: Path,
) -> tuple[list[dict[str, Any]], list[str], dict[str, Any], str | None, str | None]:
    """Spawn the agent SDK and consume messages until done or capped.

    Returns (tool_calls, transcript_chunks, usage, aborted_reason, error).
    """
    tool_calls: list[dict[str, Any]] = []
    transcript: list[str] = []
    pending_tool_uses: dict[str, dict[str, Any]] = {}
    usage: dict[str, Any] = {}
    aborted_reason: str | None = None
    error: str | None = None
    tool_call_count = {"n": 0}

    async def pretool_hook(input_data, _tool_use_id, _ctx):
        tool_name = input_data.get("tool_name", "")
        if tool_name.startswith("mcp__"):
            tool_call_count["n"] += 1
            if tool_call_count["n"] > fixture.caps.tool_calls:
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": (
                            f"tool_calls cap ({fixture.caps.tool_calls}) exceeded"
                        ),
                    },
                    "continue_": False,
                    "stopReason": "max_tool_calls",
                }
        return {}

    options = ClaudeAgentOptions(
        cwd=str(workspace),
        setting_sources=["project"],
        mcp_servers={
            "genealogy": {
                "type": "stdio",
                "command": "node",
                "args": [str(mcp_server_entry)],
            },
        },
        # Allow all genealogy MCP tools + baseline filesystem/Skill tools.
        # Wildcard form on the mcp__<server>__ prefix.
        allowed_tools=BASELINE_ALLOWED_TOOLS + ["mcp__genealogy"],
        permission_mode="dontAsk",
        model=fixture.agent_model,
        max_turns=fixture.caps.max_turns,
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[pretool_hook])]},
    )

    user_message = _render_user_message(fixture)
    transcript.append(f"# E2e run: {fixture.id}\n\n## User message\n\n```\n{user_message}\n```\n\n## Trace\n")

    async def _consume():
        nonlocal usage, error, aborted_reason
        iterator = query(prompt=user_message, options=options).__aiter__()
        while True:
            try:
                message = await asyncio.wait_for(
                    iterator.__anext__(),
                    timeout=fixture.caps.inactivity_seconds,
                )
            except StopAsyncIteration:
                return
            except asyncio.TimeoutError:
                aborted_reason = "sdk_stream_silence"
                error = (
                    f"no SDK message within {fixture.caps.inactivity_seconds}s "
                    "(inactivity)"
                )
                return

            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        transcript.append(f"\n**assistant:** {block.text}\n")
                    elif isinstance(block, ToolUseBlock):
                        entry = {
                            "tool": block.name,
                            "args": dict(block.input or {}),
                            "response_summary": None,
                        }
                        tool_calls.append(entry)
                        pending_tool_uses[block.id] = entry
                        args_short = _summarize_tool_response(block.input)
                        transcript.append(
                            f"\n**tool_use** `{block.name}` — args: {args_short}\n"
                        )
            elif isinstance(message, UserMessage):
                # Tool results return as UserMessages with ToolResultBlock content.
                content = message.content
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, ToolResultBlock):
                            entry = pending_tool_uses.pop(block.tool_use_id, None)
                            summary = _summarize_tool_response(block.content)
                            if entry is not None:
                                entry["response_summary"] = summary
                            transcript.append(f"\n**tool_result:** {summary}\n")
            elif isinstance(message, SystemMessage):
                # Init / config / hint messages from the SDK. Not interesting
                # for the transcript.
                pass
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
                if message.is_error and aborted_reason is None:
                    aborted_reason = "error"
                    error = message.result or message.stop_reason
                if message.stop_reason == "max_turns":
                    aborted_reason = "max_turns"
                if (
                    message.total_cost_usd is not None
                    and message.total_cost_usd > fixture.caps.max_cost_usd
                ):
                    aborted_reason = "cost_cap"

    try:
        await asyncio.wait_for(_consume(), timeout=fixture.caps.wall_clock_seconds)
    except asyncio.TimeoutError:
        aborted_reason = "max_wall_clock_seconds"
        error = f"wall-clock timeout after {fixture.caps.wall_clock_seconds}s"
    except Exception as e:  # noqa: BLE001 — surface any SDK failure cleanly
        aborted_reason = "error"
        error = f"{type(e).__name__}: {e}"

    if aborted_reason is None and tool_call_count["n"] > fixture.caps.tool_calls:
        aborted_reason = "max_tool_calls"
        error = f"tool_calls cap ({fixture.caps.tool_calls}) exceeded"

    return tool_calls, transcript, usage, aborted_reason, error


async def run_e2e_test(
    *,
    fixture_dir: Path,
    runlog_root: Path = DEFAULT_RUNLOG_ROOT,
    mcp_server_entry: Path = DEFAULT_MCP_SERVER_ENTRY,
    skills_dir: Path = DEFAULT_PLUGIN_SKILLS,
    skip_judge: bool = False,
) -> tuple[E2eResult, dict[str, Path]]:
    """Run one e2e fixture end-to-end. Returns (result, written-paths)."""
    fixture = load_fixture(fixture_dir)
    if not mcp_server_entry.exists():
        raise FileNotFoundError(
            f"MCP server build not found at {mcp_server_entry}. "
            "Run `npm run build` in packages/engine/mcp-server/ first."
        )

    started_at = time.time()
    with tempfile.TemporaryDirectory(prefix=f"e2e-{fixture.id}-") as tmp:
        workspace = build_workspace(fixture, Path(tmp), skills_dir)

        tool_calls, transcript_chunks, usage, aborted, error = await _run_agent(
            fixture=fixture,
            workspace=workspace,
            mcp_server_entry=mcp_server_entry,
        )

        final_research = read_research_json(workspace)
        final_tree = read_tree_json(workspace)
        stop_reason = derive_stop_reason(
            sdk_aborted_reason=aborted, research=final_research
        )

        if skip_judge or final_tree is None:
            judge_output: dict[str, Any] = {}
            verdict = "skipped" if final_tree is None else "skipped"
        else:
            try:
                judge_output = judge_module.run_judge(
                    research_question=fixture.researcher_question,
                    expected_findings=fixture.expected_findings,
                    final_tree=final_tree,
                    model=fixture.judge_model,
                )
                verdict = str(judge_output.get("verdict") or "fail")
            except Exception as e:  # noqa: BLE001 — keep the run loggable
                judge_output = {"error": f"{type(e).__name__}: {e}"}
                verdict = "skipped"

        wall_clock_seconds = time.time() - started_at
        usage = {**usage, "wall_clock_seconds": wall_clock_seconds}

        result = E2eResult(
            test_id=fixture.id,
            captured_at=timestamp_slug(),
            verdict=verdict,
            stop_reason=stop_reason,
            judge_output=judge_output,
            usage=usage,
            tool_calls=tool_calls,
            error=error,
            tags=fixture.tags,
        )

        runlog_dir = runlog_root / fixture.id
        paths = write_result_files(
            result=result,
            runlog_dir=runlog_dir,
            transcript="".join(transcript_chunks),
            final_tree=final_tree,
            final_research=final_research,
            timestamp=result.captured_at,
        )

    return result, paths
