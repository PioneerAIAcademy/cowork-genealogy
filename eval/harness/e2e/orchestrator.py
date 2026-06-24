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
import sys
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
from e2e.stop_checker import (
    derive_stop_reason,
    read_research_json,
    read_tree_json,
    should_continue_run,
)
from e2e import judge as judge_module


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MCP_SERVER_ENTRY = REPO_ROOT / "packages" / "engine" / "mcp-server" / "build" / "index.js"
DEFAULT_RUNLOG_ROOT = REPO_ROOT / "eval" / "runlogs" / "e2e"
DEFAULT_FIXTURES_ROOT = REPO_ROOT / "eval" / "tests" / "e2e"
DEFAULT_PLUGIN_SKILLS = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"
DEFAULT_PLUGIN_AGENTS = REPO_ROOT / "packages" / "engine" / "plugin" / "agents"


# Tools always allowed alongside MCP tools. See e2e-test-spec.md §6.
# "Task" lets the /research orchestrator delegate to the gps-mentor
# subagent (staged into .claude/agents/ by build_workspace). Without it,
# the main agent cannot spawn the mentor and improvises a verdict that
# never appends to research.json's evaluations[] — see
# docs/specs/gps-mentor-agent-spec.md §8 and the gps-mentor staging note
# in build_workspace below.
BASELINE_ALLOWED_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Skill",
    "Task",
]


# Tools that hand the agent the stripped answer off the LIVE FamilySearch
# tree instead of making it research. The fixture strips the answer from
# the *local* tree.gedcomx.json, but FamilySearch still has it.
#
# The principle: block anything keyed off the SUBJECT PERSON that surfaces
# the answer; allow tools keyed off a record the agent had to find first,
# and tools that read the local stripped tree.
#
#   person_read / person_search / person_ancestors
#       read the subject's facts/relationships/parents straight off the
#       live tree — the most direct leak.
#   person_record_matches(subjectPID)
#       returns the records FamilySearch has matched to the subject —
#       which INCLUDE the answer records, curated and keyed off the PID,
#       with no searching. Same leak, one step indirect.
#   person_person_matches(subjectPID)
#       surfaces tree persons matched to the subject — can leak a stripped
#       relative in a parents/siblings fixture.
#
# NOT blocked (legitimate research): record_search / record_read /
# fulltext_search / image_* / collections_search (the agent must find
# records itself); record_person_matches / record_record_matches (keyed
# off a RECORD the agent already found, not the subject); source_attachments
# (confirms a found record's attachment — real GPS work); person_warnings
# (reads the local stripped tree, not the live one).
#
# See e2e-test-spec.md §6.1. Matched on the bare tool name (after the
# `mcp__<server>__` prefix).
BLOCKED_TREE_TOOLS = frozenset(
    {
        "person_read",
        "person_search",
        "person_ancestors",
        "person_record_matches",
        "person_person_matches",
    }
)


def _bare_tool_name(tool_name: str) -> str:
    """Strip the `mcp__<server>__` prefix to get the advertised tool name."""
    return tool_name.rsplit("__", 1)[-1] if "__" in tool_name else tool_name


def is_turn_cap_error(detail: str | None) -> bool:
    """Whether an SDK error result is really a turn-cap hit.

    The SDK reports a max-turns stop as an *error result* ("Reached
    maximum number of turns (N)") rather than a clean stop_reason, so the
    orchestrator reclassifies it to `max_turns` — a known stop condition,
    not an unexpected error.
    """
    return "maximum number of turns" in str(detail or "").lower()


def is_blocked_tree_tool(tool_name: str) -> bool:
    """Whether a tool call should be denied as a live-tree answer-read.

    Only MCP genealogy tools are candidates; baseline tools (Read, Skill,
    …) are never blocked. Matched on the bare advertised name.
    """
    if not tool_name.startswith("mcp__"):
        return False
    return _bare_tool_name(tool_name) in BLOCKED_TREE_TOOLS


@dataclass
class FixtureCaps:
    # The DEFAULT caps every fixture inherits for any cap it doesn't set.
    # These are the single source of truth — load_fixture fills omitted
    # caps from here (don't re-hardcode the numbers there). Tuned so a real
    # full-GPS run fits: an early fixture hit the 100-turn cap mid-loop
    # (111 tool calls / 101 turns, still not done) — see e2e-test-spec.md §6.
    wall_clock_seconds: int = 3600  # 60 min
    inactivity_seconds: int = 600   # 10 min between SDK messages
    tool_calls: int = 300
    max_turns: int = 250
    max_cost_usd: float = 15.0
    # Voluntary-yield nudges allowed before an autonomous run is permitted to
    # end. The agent sometimes narrates the next step then stops mid-loop; a
    # Stop hook vetoes that, bounded by this cap. See should_continue_run().
    max_continue_nudges: int = 5


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

    # Fill omitted caps from FixtureCaps() — the single source of default
    # values (don't re-hardcode the numbers here, or they drift).
    caps_raw = fixture_json.get("caps") or {}
    defaults = FixtureCaps()
    caps = FixtureCaps(
        wall_clock_seconds=caps_raw.get("wall_clock_seconds", defaults.wall_clock_seconds),
        inactivity_seconds=caps_raw.get("inactivity_seconds", defaults.inactivity_seconds),
        tool_calls=caps_raw.get("tool_calls", defaults.tool_calls),
        max_turns=caps_raw.get("max_turns", defaults.max_turns),
        max_cost_usd=caps_raw.get("max_cost_usd", defaults.max_cost_usd),
        max_continue_nudges=caps_raw.get(
            "max_continue_nudges", defaults.max_continue_nudges
        ),
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


# A fixture may bundle external-evidence captures (PDFs the real /research
# flow expects a USER to upload from sites with no API — Ancestry, Find A
# Grave, …). A headless run has no human, so the harness pre-provides them:
# the docs live in `provided-documents/` and are copied into the workspace
# root, exactly where search-external-sites expects an uploaded capture
# (it reads them by `capture_filename`). See spec §6.2.
PROVIDED_DOCS_DIRNAME = "provided-documents"


def provided_documents(fixture: Fixture) -> list[Path]:
    """The fixture's bundled external-evidence captures (may be empty)."""
    d = fixture.dir / PROVIDED_DOCS_DIRNAME
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.is_file() and not p.name.startswith("."))


def build_workspace(
    fixture: Fixture,
    target: Path,
    skills_dir: Path,
    agents_dir: Path = DEFAULT_PLUGIN_AGENTS,
) -> Path:
    """Populate a temp dir with fixture starting state + plugin skills + agents.

    Plugin subagents (`packages/engine/plugin/agents/*.md`) are staged into
    `.claude/agents/` as project subagents so the /research orchestrator's
    `@plugin:gps-mentor` delegation can resolve to the real agent. Without
    this the agent file is absent from the workspace, the orchestrator falls
    back to an improvised generic subagent, and the mentor's verdict never
    appends to research.json's `evaluations[]` (see
    docs/specs/gps-mentor-agent-spec.md §8). This mirrors how the shipped
    plugin zip carries `agents/` (scripts/package-plugin.sh); the harness
    simply flattens it into the project scope the SDK loads via
    setting_sources=["project"].
    """
    target = Path(target)
    shutil.copy(fixture.starting_research_path, target / "research.json")
    shutil.copy(fixture.starting_tree_path, target / "tree.gedcomx.json")

    skills_target = target / ".claude" / "skills"
    skills_target.mkdir(parents=True, exist_ok=True)
    for skill in Path(skills_dir).iterdir():
        if skill.is_dir() and not skill.name.startswith("."):
            shutil.copytree(skill, skills_target / skill.name, dirs_exist_ok=True)

    # Stage plugin subagents as project subagents (.claude/agents/<name>.md).
    agents_dir = Path(agents_dir)
    if agents_dir.is_dir():
        agents_target = target / ".claude" / "agents"
        agents_target.mkdir(parents=True, exist_ok=True)
        for agent_file in sorted(agents_dir.glob("*.md")):
            shutil.copy(agent_file, agents_target / agent_file.name)

    # Drop bundled captures into the workspace root, where an uploaded PDF
    # would land — the agent reads them by filename like a user upload.
    for doc in provided_documents(fixture):
        shutil.copy(doc, target / doc.name)
    return target


def _render_user_message(fixture: Fixture) -> str:
    """The literal user message sent to the agent. See spec §5.

    If the fixture bundles external-evidence captures, name them so the
    agent reads them instead of pausing to ask the user to upload (which
    can't happen in a headless run).
    """
    base = f"/research --autonomous {fixture.researcher_question}"
    docs = provided_documents(fixture)
    if not docs:
        return base
    names = ", ".join(d.name for d in docs)
    return (
        f"{base}\n\n"
        f"(Pre-provided external captures are in the working directory: {names}. "
        "When research calls for a document from an external site that's among "
        "these, read the local file instead of asking me to upload it.)"
    )


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
) -> tuple[
    list[dict[str, Any]],
    list[str],
    dict[str, Any],
    str | None,
    str | None,
    list[dict[str, Any]],
]:
    """Spawn the agent SDK and consume messages until done or capped.

    Returns (tool_calls, transcript_chunks, usage, aborted_reason, error,
    blocked_tree_reads).
    """
    tool_calls: list[dict[str, Any]] = []
    transcript: list[str] = []
    pending_tool_uses: dict[str, dict[str, Any]] = {}
    usage: dict[str, Any] = {}
    aborted_reason: str | None = None
    error: str | None = None
    tool_call_count = {"n": 0}
    # Every denied attempt to read the answer off the live tree. A
    # non-empty list means the agent tried to shortcut research — surfaced
    # in the result so a reviewer can audit the run. See spec §6.1.
    blocked_tree_reads: list[dict[str, Any]] = []
    # Continue-nudge state: when the agent voluntarily yields before
    # project.status == "completed" (the known "narrated next step then
    # stopped" stall), the Stop hook vetoes the yield and tells it to resume —
    # bounded by max_continue_nudges + a no-progress check (see
    # should_continue_run) so a genuinely stuck run still ends and fails.
    continue_nudges = {"n": 0}
    last_nudge_tool_count = {"n": -1}

    run_started = time.monotonic()

    def _emit(line: str) -> None:
        """Live progress to stderr so a long, otherwise-silent run shows
        roughly where it is. ASCII only (the genealogist team runs on Windows
        cp1252 consoles); stdout stays clean for the CLI's own output."""
        elapsed = int(time.monotonic() - run_started)
        print(
            f"  [{elapsed // 60}m{elapsed % 60:02d}s] {line}",
            file=sys.stderr,
            flush=True,
        )

    async def pretool_hook(input_data, _tool_use_id, _ctx):
        tool_name = input_data.get("tool_name", "")
        if not tool_name.startswith("mcp__"):
            return {}

        # Block tree-reading tools BEFORE counting toward the cap — a denied
        # call never runs, so it shouldn't consume the budget. The run
        # continues (no stopReason); the agent must find a records path.
        bare = _bare_tool_name(tool_name)
        if is_blocked_tree_tool(tool_name):
            blocked_tree_reads.append(
                {"tool": bare, "args": dict(input_data.get("tool_input") or {})}
            )
            transcript.append(
                f"\n**[BLOCKED]** `{bare}` denied — tree-reading tools are "
                "disabled in e2e runs; recover the answer from records.\n"
            )
            _emit(f"[blocked tree-read] {bare}")
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"{bare} is disabled in e2e benchmark runs. Reading the "
                        "tree would hand you the stripped answer for free. "
                        "Recover it through records instead (record_search, "
                        "record_read, fulltext_search, image_search, …)."
                    ),
                },
            }

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

    async def stop_hook(_input_data, _tool_use_id, _ctx):
        # The agent is ending its turn. In an autonomous e2e run the only
        # valid end is project.status == "completed"; an earlier yield is the
        # known stall. Veto it (decision=block) and tell the agent to resume,
        # bounded by should_continue_run() so a stuck run still ends + fails.
        research = read_research_json(workspace)
        if not should_continue_run(
            research=research,
            nudges_used=continue_nudges["n"],
            max_nudges=fixture.caps.max_continue_nudges,
            tool_count=tool_call_count["n"],
            tool_count_at_last_nudge=last_nudge_tool_count["n"],
        ):
            return {}
        continue_nudges["n"] += 1
        last_nudge_tool_count["n"] = tool_call_count["n"]
        transcript.append(
            f"\n**[HARNESS]** continue-nudge {continue_nudges['n']}/"
            f"{fixture.caps.max_continue_nudges}: agent yielded before "
            "project.status=='completed'; instructing it to resume the loop.\n"
        )
        _emit(
            f"[continue-nudge {continue_nudges['n']}/"
            f"{fixture.caps.max_continue_nudges}] agent yielded; resuming"
        )
        return {
            "decision": "block",
            "reason": (
                "You are mid-run in an autonomous /research session and the "
                "project is not yet complete (project.status is not "
                "'completed'). Do not stop to report progress or announce the "
                "next step. Re-read research.json and invoke the next GPS "
                "sub-skill now; keep going until project.status is "
                "'completed' or you hit a genuine, logged blocker."
            ),
        }

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
        # Wildcard form on the mcp__<server>__ prefix. NOTE: the tree-reading
        # tools (BLOCKED_TREE_TOOLS) are advertised here but denied at call
        # time by pretool_hook — the integrity block (§6.1) is enforced in the
        # hook, not the allowlist, so it can deny per-call with arguments.
        allowed_tools=BASELINE_ALLOWED_TOOLS + ["mcp__genealogy"],
        permission_mode="dontAsk",
        model=fixture.agent_model,
        max_turns=fixture.caps.max_turns,
        hooks={
            "PreToolUse": [HookMatcher(matcher=None, hooks=[pretool_hook])],
            "Stop": [HookMatcher(matcher=None, hooks=[stop_hook])],
        },
    )

    user_message = _render_user_message(fixture)
    transcript.append(f"# E2e run: {fixture.id}\n\n## User message\n\n```\n{user_message}\n```\n\n## Trace\n")

    async def _consume():
        nonlocal usage, error, aborted_reason
        iterator = query(prompt=user_message, options=options).__aiter__()
        _emit("agent started")
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
                        narration = " ".join(block.text.split())
                        if narration:
                            _emit(narration[:200])
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
                        if block.name == "Skill":
                            _emit(f">> skill: {(block.input or {}).get('skill', '?')}")
                        elif block.name.startswith("mcp__"):
                            _emit(f"   - {_bare_tool_name(block.name)}")
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
                    detail = message.result or message.stop_reason or ""
                    # The SDK surfaces a turn-cap hit as an *error result*
                    # rather than a clean stop_reason="max_turns". Reclassify.
                    if is_turn_cap_error(detail):
                        aborted_reason = "max_turns"
                        error = str(detail)
                    else:
                        aborted_reason = "error"
                        error = detail
                # Cost cap wins over a plain max_turns end: if the run both
                # hit the turn limit and blew the budget, the budget is the
                # more actionable reason. Neither overwrites an earlier abort
                # (e.g. a mid-stream error).
                if (
                    aborted_reason is None
                    and message.total_cost_usd is not None
                    and message.total_cost_usd > fixture.caps.max_cost_usd
                ):
                    aborted_reason = "cost_cap"
                if aborted_reason is None and message.stop_reason == "max_turns":
                    aborted_reason = "max_turns"

    try:
        await asyncio.wait_for(_consume(), timeout=fixture.caps.wall_clock_seconds)
    except asyncio.TimeoutError:
        aborted_reason = "max_wall_clock_seconds"
        error = f"wall-clock timeout after {fixture.caps.wall_clock_seconds}s"
    except Exception as e:  # noqa: BLE001 — surface any SDK failure cleanly
        detail = f"{type(e).__name__}: {e}"
        # The SDK can raise the turn-cap as an exception rather than a clean
        # ResultMessage; reclassify it to `max_turns` (a known stop) the same
        # way the ResultMessage branch does, so it isn't mislabeled `error`.
        aborted_reason = "max_turns" if is_turn_cap_error(detail) else "error"
        error = detail

    if aborted_reason is None and tool_call_count["n"] > fixture.caps.tool_calls:
        aborted_reason = "max_tool_calls"
        error = f"tool_calls cap ({fixture.caps.tool_calls}) exceeded"

    usage = {**usage, "continue_nudges": continue_nudges["n"]}
    return tool_calls, transcript, usage, aborted_reason, error, blocked_tree_reads


def _find_session_transcript(workspace: Path) -> Path | None:
    """Locate the Agent SDK's raw session JSONL for this run.

    The SDK runs Claude Code as a subprocess, which writes a session transcript
    to ``~/.claude/projects/<cwd-slug>/<session>.jsonl``. That file lives OUTSIDE
    the workspace tempdir, so it survives the TemporaryDirectory cleanup — but it
    is otherwise only discoverable by hand. It is strictly richer than the
    runlog's own ``transcript.md`` (which is a lossy summary): only the JSONL has
    per-message timestamps, per-turn token/cache usage, thinking blocks, and
    untruncated tool payloads — everything needed to diagnose latency and cost.

    Matched on the unique tempdir leaf (``e2e-<id>-<rand>``), which appears
    verbatim in the slug, so this does not depend on the exact path-slug
    transform. Returns the newest matching JSONL, or None if none is found.
    """
    projects = Path.home() / ".claude" / "projects"
    if not projects.is_dir():
        return None
    leaf = workspace.name
    candidates = [
        p
        for d in projects.iterdir()
        if d.is_dir() and d.name.endswith(leaf)
        for p in d.glob("*.jsonl")
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


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

        (
            tool_calls,
            transcript_chunks,
            usage,
            aborted,
            error,
            blocked_tree_reads,
        ) = await _run_agent(
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
            # Both cases produce no verdict: --skip-judge by request, or no
            # tree for the judge to grade (agent crashed before writing one).
            judge_output: dict[str, Any] = {}
            verdict = "skipped"
        else:
            try:
                judge_output = judge_module.run_judge(
                    research_question=fixture.researcher_question,
                    expected_findings=fixture.expected_findings,
                    final_tree=final_tree,
                    final_research=final_research,
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
            blocked_tree_reads=blocked_tree_reads,
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

        # Copy the raw SDK session transcript next to the runlog. The runlog's
        # transcript.md is a lossy summary; this JSONL carries per-message
        # timestamps, per-turn token/cache usage, thinking, and untruncated
        # payloads. Best-effort — a missing session file never fails an
        # otherwise-successful run. Done inside the tempdir block so `workspace`
        # is still in scope (the JSONL itself lives outside the tempdir).
        session_jsonl = _find_session_transcript(workspace)
        if session_jsonl is not None:
            dest = runlog_dir / f"{paths['result'].stem}.session.jsonl"
            shutil.copy(session_jsonl, dest)
            paths["session"] = dest

    return result, paths
