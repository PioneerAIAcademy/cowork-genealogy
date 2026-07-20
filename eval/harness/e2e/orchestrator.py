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
import re
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass, replace
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

from harness.auth import env_for_sdk, resolve_auth
from harness.context_policy import (
    bare_tool_name as _bare_tool_name,  # re-exported: callers + tests import it from here
)

from e2e.result import E2eResult, timestamp_slug, write_result_files
from e2e.stop_checker import (
    derive_stop_reason,
    read_research_json,
    read_tree_json,
    should_continue_run,
)
from e2e.subagent_capture import collect_subagents
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


def is_fixture_blocked_tool(tool_name: str, blocked_tools: frozenset) -> bool:
    """Whether a tool call is denied by THIS fixture's `blocked_tools`.

    Same matching rules as the universal tree block: MCP tools only,
    matched on the bare advertised name. Used for fixtures whose ground
    truth a specific tool can surface directly (e.g. `wiki_search` on a
    fixture built from a wiki case-study article that names the answer).
    """
    if not tool_name.startswith("mcp__"):
        return False
    return _bare_tool_name(tool_name) in blocked_tools


@dataclass
class FixtureCaps:
    # The DEFAULT caps every fixture inherits for any cap it doesn't set.
    # These are the single source of truth — load_fixture fills omitted
    # caps from here (don't re-hardcode the numbers there). Tuned so a real
    # full-GPS run fits: an early fixture hit the 100-turn cap mid-loop
    # (111 tool calls / 101 turns, still not done) — see e2e-test-spec.md §6.
    wall_clock_seconds: int = 7200  # 120 min — the formal GPS apparatus
    # (research-exhaustiveness + gps-mentor gates + proof-conclusion) pushes a
    # real full-GPS run well past 60 min; kenneth/elizabeth/teitje all hit the
    # old 3600 cap mid-proof-conclusion (morris already overrode to 4800).
    inactivity_seconds: int = 600   # 10 min with NO SDK message at all (silence)
    # Abort (or, with resume_on_stall, resume) when the agent makes no PROGRESS
    # — no assistant text and no tool call/result — for this long, even while the
    # SDK keeps emitting non-progress messages (so the inactivity timer never
    # fires). The observed stalls were exactly this: the stream stayed alive but
    # the model made no progress for ~40 min until the wall-clock cap. Conservative
    # default; tune down once the per-turn `timeline` shows the normal max gap.
    progress_stall_seconds: int = 600
    tool_calls: int = 300
    max_turns: int = 250
    max_cost_usd: float = 15.0
    # Voluntary-yield nudges allowed before an autonomous run is permitted to
    # end. The agent sometimes narrates the next step then stops mid-loop; a
    # Stop hook vetoes that, bounded by this cap. See should_continue_run().
    # Generous by design: a full GPS proof yields after each of ~10+ sub-skill
    # steps, so a stingy cap ends the loop before proof-conclusion. The
    # no-progress check (see should_continue_run) is the real backstop against
    # a genuinely idle agent; this cap only bounds the worst case.
    max_continue_nudges: int = 20


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
    # Extra tools denied for THIS fixture's runs, beyond the universal
    # BLOCKED_TREE_TOOLS — bare advertised names (e.g. "wiki_search").
    # For fixtures whose ground truth derives from a source an MCP tool
    # can surface directly (a wiki case-study article naming the answer).
    # See e2e-test-spec.md §6.1 "Per-fixture blocked tools".
    blocked_tools: frozenset = frozenset()
    # The fixture's subject person id(s), from starting-research.json's
    # project.subject_person_ids (plus a real source_pid). Passed to the
    # avoid-guard so a same-name subject isn't mis-flagged as the avoided
    # namesake in a look-alike fixture.
    subject_person_ids: frozenset = frozenset()


def load_fixture(fixture_dir: Path) -> Fixture:
    """Read fixture.json + expected-findings.json from a fixture directory."""
    fixture_dir = Path(fixture_dir)
    fixture_json = json.loads((fixture_dir / "fixture.json").read_text(encoding="utf-8"))
    expected = json.loads((fixture_dir / "expected-findings.json").read_text(encoding="utf-8"))

    # Subject person id(s) for the avoid-guard's subject exemption. Primary
    # source is starting-research.json's project.subject_person_ids; source_pid
    # is added when it's a real PID (not the "PID-TODO" marker).
    subject_ids: set[str] = set()
    try:
        starting_research = json.loads(
            (fixture_dir / "starting-research.json").read_text(encoding="utf-8")
        )
        for sid in (starting_research.get("project") or {}).get("subject_person_ids") or []:
            subject_ids.add(str(sid))
    except (OSError, json.JSONDecodeError):
        pass
    src = fixture_json.get("source_pid")
    if src and "TODO" not in str(src):
        subject_ids.add(str(src))

    # Fill omitted caps from FixtureCaps() — the single source of default
    # values (don't re-hardcode the numbers here, or they drift).
    caps_raw = fixture_json.get("caps") or {}
    defaults = FixtureCaps()
    caps = FixtureCaps(
        wall_clock_seconds=caps_raw.get("wall_clock_seconds", defaults.wall_clock_seconds),
        inactivity_seconds=caps_raw.get("inactivity_seconds", defaults.inactivity_seconds),
        progress_stall_seconds=caps_raw.get(
            "progress_stall_seconds", defaults.progress_stall_seconds
        ),
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
        blocked_tools=frozenset(fixture_json.get("blocked_tools") or ()),
        subject_person_ids=frozenset(subject_ids),
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


def _override_agent_model(md_text: str, model: str) -> str:
    """Rewrite a staged subagent's ``model:`` frontmatter to ``model``.

    Overrides the agent's own pin (e.g. record-extractor's ``claude-sonnet-5``)
    so an e2e run can be executed against a different model — e.g. to test
    whether the sonnet-5 record-extractor freeze reproduces under sonnet-4-6,
    the model Cowork uses. Inserts a ``model:`` line if the agent has none.
    """
    if re.search(r"(?m)^model:[ \t]*.*$", md_text):
        return re.sub(r"(?m)^model:[ \t]*.*$", f"model: {model}", md_text, count=1)
    if md_text.startswith("---\n"):
        return f"---\nmodel: {model}\n" + md_text[len("---\n"):]
    return md_text  # no frontmatter to pin into


def build_workspace(
    fixture: Fixture,
    target: Path,
    skills_dir: Path,
    agents_dir: Path = DEFAULT_PLUGIN_AGENTS,
    effort_level: str | None = None,
    agent_model: str | None = None,
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
            dest = agents_target / agent_file.name
            if agent_model is None:
                shutil.copy(agent_file, dest)
            else:
                # Override every staged subagent's model pin (see agent_model).
                dest.write_text(
                    _override_agent_model(agent_file.read_text(encoding="utf-8"), agent_model),
                    encoding="utf-8",
                )

    # Optionally pin the run's reasoning effort via a PROJECT-level setting.
    # setting_sources=["project"] reads this file; the CLAUDE_EFFORT env var does
    # NOT (it's output-only — verified). This is the only working effort lever
    # from the harness. Session-wide (parent + every subagent). Left unset, the
    # run uses the CLI's bare default, which for sonnet-5 resolves to 'high' —
    # deep enough that the record-extractor subagent can spend its whole output
    # budget on one thinking turn (stop_reason=max_tokens, no tool call) and
    # freeze the run; lower it here to A/B whether that clears (read the runlog's
    # `subagents[].runaway_thinking`). Valid: low | medium | high | xhigh | max.
    if effort_level is not None:
        claude_dir = target / ".claude"
        claude_dir.mkdir(parents=True, exist_ok=True)
        (claude_dir / "settings.json").write_text(
            json.dumps({"effortLevel": effort_level}, indent=2) + "\n", encoding="utf-8"
        )

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


_USAGE_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)


def _accumulate_usage(acc: dict[str, dict[str, int]], message: Any) -> None:
    """Record one AssistantMessage's usage, keyed by its message id.

    Do NOT sum on arrival. The SDK re-emits the same assistant message once
    per content block, and every copy carries the SAME cumulative usage for
    that message — so adding each time multiplies the totals (verified by
    replaying a real run: naive summing reported 358,610 output tokens
    against a true 106,661, and 226 messages against 87 distinct ones).
    Keying by message id and letting the last write win reproduces the
    ResultMessage token totals exactly.

    Best-effort by design: the SDK types `usage` loosely (a dict on the
    observed path, an object on some versions) and a malformed or absent
    block must never take down a run.
    """
    msg_id = getattr(message, "message_id", None)
    # No id to dedupe on — count it once under a synthetic key rather than
    # dropping it or letting it collide with another anonymous message.
    key = msg_id if msg_id else f"__anon_{len(acc)}"
    usage = getattr(message, "usage", None)

    def _get(field: str) -> int:
        if usage is None:
            return 0
        raw = usage.get(field) if isinstance(usage, dict) else getattr(usage, field, 0)
        return raw if isinstance(raw, int) else 0

    acc[key] = {field: _get(field) for field in _USAGE_FIELDS}


def _fallback_usage(acc: dict[str, dict[str, int]], elapsed_ms: int) -> dict[str, Any]:
    """Usage block reconstructed from the stream when no ResultMessage came.

    Two fields are deliberately left null rather than synthesized:

    `total_cost_usd` — a run spans several models (the parent plus each
    subagent on its own `.md` pin), so one price lookup would be wrong, and a
    plausible-but-wrong dollar figure is worse than a null here: it would be
    silently compared against real costs from clean runs. Token counts are
    exact, so cost stays derivable later from a per-model breakdown.

    `num_turns` — the SDK counts turns differently from distinct assistant
    messages (118 vs 87 on the replayed run), and `latency_report` divides
    output tokens by it. Publishing the smaller number under the same name
    would inflate tokens-per-turn by ~1.4x in exactly the metric the latency
    work depends on. The exact count we DO have is reported separately as
    `assistant_messages`.

    `duration_api_ms` is absent for the same reason: only the SDK knows the
    API/local split, and a monotonic clock can't recover it.
    """
    return {
        "duration_ms": elapsed_ms,
        "duration_api_ms": None,
        "num_turns": None,
        "assistant_messages": len(acc),
        "is_error": True,
        "stop_reason": None,
        "total_cost_usd": None,
        "usage": {
            field: sum(m[field] for m in acc.values()) for field in _USAGE_FIELDS
        },
    }


async def _run_agent(
    *,
    fixture: Fixture,
    workspace: Path,
    mcp_server_entry: Path,
    resume_on_stall: bool = False,
    max_output_tokens: int | None = None,
    agent_model: str | None = None,
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
    # mcp__-only, for the tool_calls budget cap. Distinct from activity_count
    # below, which powers the no-progress stop check.
    tool_call_count = {"n": 0}
    # Any-tool counter (Skill, Read, mcp__, …) for the no-progress check. A
    # read-only sub-skill step (e.g. research-exhaustiveness deciding "not yet
    # exhaustive" and writing nothing) is real progress, not a stuck agent —
    # gating no-progress on mcp__-only calls false-killed runs mid-loop.
    activity_count = {"n": 0}
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
    last_nudge_activity_count = {"n": -1}

    run_started = time.monotonic()

    # Per-message timeline for forensics: [elapsed_seconds, kind]. Lets a later
    # analysis split a run into structural vs stall time and pinpoint a
    # no-progress gap WITHOUT a session.jsonl (which isn't reliably copied).
    timeline: list[list[Any]] = []
    # Stall detection tracks time since the last PROGRESS message (assistant
    # text, a tool call, or a tool result) — not since any message, because the
    # SDK keeps emitting non-progress messages during a hang, so a plain
    # inactivity timer misses it (the observed stall ran to the wall-clock cap).
    last_progress = {"t": run_started}
    # session_id from the SDK init message — required to resume a stalled run.
    session_id: dict[str, str | None] = {"id": None}
    # Claude Code CLI version from the init message. Logged so a harness-vs-Cowork
    # discrepancy can be checked against a version delta (the local CLI the SDK
    # spawns may differ from Cowork's bundled one).
    cli_version: dict[str, str | None] = {"v": None}
    resumes = {"n": 0}  # how many times we resumed after a stall (capped)
    MAX_RESUME = 2

    # Streamed usage accumulator. The SDK's ResultMessage carries the
    # authoritative duration/turns/cost, but it only arrives on a CLEAN end —
    # a wall-clock timeout, an inactivity abort or a no-progress stall cuts the
    # stream before it, so `usage` stayed {} and the run landed in the runlog
    # with no turns, no duration and no tokens at all. That silently blinded
    # every `timeout` run (9 of 9 in the corpus as of 2026-07-20) — exactly the
    # runs whose cost and turn count you most want to see. Accumulating per
    # AssistantMessage gives a fallback that is always available. See
    # _fallback_usage below for what is and isn't recoverable this way.
    streamed: dict[str, dict[str, int]] = {}

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
        # Count EVERY tool the agent issues (Skill, Read, mcp__, …) toward the
        # no-progress signal — invoking a sub-skill is progress even when that
        # skill writes nothing. The mcp__-only budget cap is tool_call_count,
        # incremented separately below.
        activity_count["n"] += 1
        if not tool_name.startswith("mcp__"):
            return {}

        # NOTE: the per-context tool policy (harness/context_policy.py) is
        # deliberately NOT enforced here — see docs/plan/image-read-context-policy.md
        # §4.1. It is unit-only because the guard needs to know which SKILL is
        # active, and e2e cannot know: sub-skills run in this same session via
        # the Skill tool (no `agent_id` to attribute them), so a legitimate
        # `search-images` browse — which declares `image_read` and pages through
        # volumes itself — is indistinguishable from a record-extraction router
        # violation. Denying on the bare tool name would break real browsing.

        # Block tree-reading tools BEFORE counting toward the cap — a denied
        # call never runs, so it shouldn't consume the budget. The run
        # continues (no stopReason); the agent must find a records path.
        bare = _bare_tool_name(tool_name)
        if is_blocked_tree_tool(tool_name):
            blocked_tree_reads.append(
                {
                    "tool": bare,
                    "args": dict(input_data.get("tool_input") or {}),
                    "blocked_by": "tree",
                }
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
        if is_fixture_blocked_tool(tool_name, fixture.blocked_tools):
            blocked_tree_reads.append(
                {
                    "tool": bare,
                    "args": dict(input_data.get("tool_input") or {}),
                    "blocked_by": "fixture",
                }
            )
            transcript.append(
                f"\n**[BLOCKED]** `{bare}` denied — disabled by this fixture "
                "(fixture.json `blocked_tools`).\n"
            )
            _emit(f"[blocked fixture tool] {bare}")
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"{bare} is disabled for this benchmark fixture: its "
                        "ground truth derives from a source this tool can "
                        "surface directly. Recover the answer through record "
                        "research instead (record_search, record_read, "
                        "fulltext_search, image_search, …)."
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
            tool_count=activity_count["n"],
            tool_count_at_last_nudge=last_nudge_activity_count["n"],
        ):
            return {}
        continue_nudges["n"] += 1
        last_nudge_activity_count["n"] = activity_count["n"]
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
        # Idea 3a (speedup plan §3a): eager-load the genealogy MCP tool schemas.
        # The bundled CLI defers MCP tool schemas above a token threshold (the
        # ~38-tool genealogy server trips it), forcing repeated ToolSearch
        # re-discovery (17x in the spriggs run). Forcing tool search off loads
        # them once at session start. `env` MERGES onto the inherited environment
        # (claude_agent_sdk subprocess_cli merges os.environ, then options.env),
        # so this adds the var without dropping PATH.
        #
        # env_for_sdk(resolve_auth()) routes the agent run to the operator's
        # subscription when one is available (suppressing the ANTHROPIC_API_KEY
        # that run_e2e.load_env_file pushed into os.environ for the judge), and
        # falls back to injecting the key when there's no subscription. The
        # judge keeps using the key from os.environ — only the agent subprocess
        # env is overridden here.
        # CLAUDE_CODE_MAX_OUTPUT_TOKENS caps the model's output budget. Unlike
        # CLAUDE_EFFORT (output-only, verified inert as input), this env var IS
        # read as input by the CLI. Left unset the run uses the CLI default (for
        # sonnet-5, 32000). Set it to bound a runaway-thinking subagent that
        # fills the output budget with thinking (see subagent_capture); recorded
        # in the runlog. Applies session-wide (parent + every subagent).
        env={
            "ENABLE_TOOL_SEARCH": "true",
            **({"CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(max_output_tokens)} if max_output_tokens else {}),
            **env_for_sdk(resolve_auth()),
        },
        # Parent model: the --agent-model override (also applied to staged
        # subagents in build_workspace) or the fixture's default.
        model=agent_model or fixture.agent_model,
        max_turns=fixture.caps.max_turns,
        # The SDK's stdio transport defaults to a 1 MiB max_buffer_size for a
        # single JSON message (claude_agent_sdk _DEFAULT_MAX_BUFFER_SIZE). A
        # live image_read response (base64, ~1.33x the raw bytes) plus its
        # JSON-RPC/MCP envelope can exceed that even when the tool's own
        # 700KB inline-image guard (packages/engine/mcp-server/src/tools/
        # image-read.ts MAX_INLINE_IMAGE_BYTES) has already passed the image
        # through — observed killing this exact e2e run on a real FamilySearch
        # death-certificate image (2026-07-08). Raised generously here since
        # this is eval-harness-only config; it does not change production
        # Cowork behavior or the tool's own inline-image ceiling.
        max_buffer_size=10 * 1024 * 1024,
        hooks={
            "PreToolUse": [HookMatcher(matcher=None, hooks=[pretool_hook])],
            "Stop": [HookMatcher(matcher=None, hooks=[stop_hook])],
        },
    )

    user_message = _render_user_message(fixture)
    transcript.append(f"# E2e run: {fixture.id}\n\n## User message\n\n```\n{user_message}\n```\n\n## Trace\n")

    def _should_resume() -> bool:
        # Resume only in a provably-safe state: the flag is on, we have a session
        # id, no tool call is in flight (so we can't double-apply a write whose
        # result hadn't returned), and we're under the retry cap. When unsure,
        # DON'T resume — fall back to a clean abort. (Residual: a write that
        # committed in the MCP server before its tool_result arrived would still
        # look "not pending"; this gate narrows but doesn't fully close that
        # window — acceptable for a flagged first cut.)
        return (
            resume_on_stall
            and session_id["id"] is not None
            and not pending_tool_uses
            and resumes["n"] < MAX_RESUME
        )

    async def _consume():
        nonlocal usage, error, aborted_reason
        current_options = options
        current_prompt = user_message
        while True:  # session (re)start loop — re-entered only to resume a stall
            iterator = query(prompt=current_prompt, options=current_options).__aiter__()
            _emit("agent started" if resumes["n"] == 0
                  else f"resumed session (attempt {resumes['n']}) after stall")
            restart = False
            while True:  # message loop
                try:
                    message = await asyncio.wait_for(
                        iterator.__anext__(),
                        timeout=fixture.caps.inactivity_seconds,
                    )
                except StopAsyncIteration:
                    return
                except asyncio.TimeoutError:
                    # No SDK message at all within the window (true silence).
                    if _should_resume():
                        restart = True
                        break
                    aborted_reason = "sdk_stream_silence"
                    error = (
                        f"no SDK message within {fixture.caps.inactivity_seconds}s "
                        "(inactivity)"
                    )
                    return

                now = time.monotonic()
                progressed = False

                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            transcript.append(f"\n**assistant:** {block.text}\n")
                            narration = " ".join(block.text.split())
                            if narration:
                                _emit(narration[:200])
                            progressed = True
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
                            progressed = True
                    # Record before the timeline append so a message that
                    # arrives moments before a timeout still counts.
                    _accumulate_usage(streamed, message)
                    timeline.append([round(now - run_started, 1), "assistant"])
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
                                progressed = True
                    timeline.append([round(now - run_started, 1), "tool_result"])
                elif isinstance(message, SystemMessage):
                    # Init / config / hint messages. Capture the session id (for
                    # resume) and the CLI version (for the runlog); neither counts
                    # as progress.
                    data = getattr(message, "data", None) or {}
                    sid = data.get("session_id")
                    if sid:
                        session_id["id"] = sid
                    ver = data.get("version") or data.get("cli_version")
                    if ver:
                        cli_version["v"] = ver
                    timeline.append(
                        [round(now - run_started, 1), f"system:{message.subtype}"]
                    )
                elif isinstance(message, ResultMessage):
                    timeline.append([round(now - run_started, 1), "result"])
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

                # Progress watchdog: a stall is "stream alive, no progress". The
                # plain inactivity timer above misses it (messages keep arriving),
                # which is why the observed stall burned to the wall-clock cap.
                if progressed:
                    last_progress["t"] = now
                elif now - last_progress["t"] > fixture.caps.progress_stall_seconds:
                    if _should_resume():
                        restart = True
                        break
                    aborted_reason = "no_progress_stall"
                    error = (
                        "no progress (assistant text / tool call) for "
                        f"{fixture.caps.progress_stall_seconds}s"
                    )
                    return

            # Reached only on a stall in a provably-safe state: tear down the
            # hung query and resume the same session from where it left off.
            if not restart:
                return
            resumes["n"] += 1
            try:
                await asyncio.wait_for(iterator.aclose(), timeout=15)
            except Exception:  # noqa: BLE001 — best-effort teardown of a hung subprocess
                pass
            _emit(f"stall — resuming session {session_id['id']!r} (attempt {resumes['n']})")
            current_options = replace(options, resume=session_id["id"], fork_session=False)
            current_prompt = (
                "Continue from where you left off — resume the research workflow."
            )
            last_progress["t"] = time.monotonic()

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

    # A ResultMessage populates `usage` with the SDK's authoritative numbers.
    # Every abort path (wall-clock timeout, inactivity silence, no-progress
    # stall) cuts the stream before it, leaving `usage` empty — so fall back to
    # what the stream already told us. `usage_source` marks which one you're
    # reading: a fallback block has exact token counts but a null cost, and
    # must not be compared against a clean run's `total_cost_usd`.
    result_message_seen = "num_turns" in usage
    if not result_message_seen:
        usage = _fallback_usage(
            streamed, int((time.monotonic() - run_started) * 1000)
        )

    usage = {
        **usage,
        "usage_source": "result_message" if result_message_seen else "streamed_fallback",
        "continue_nudges": continue_nudges["n"],
        # Stall-resume + forensics (added with the progress watchdog). `timeline`
        # is [elapsed_seconds, kind] per SDK message — split structural vs stall
        # time and locate a no-progress gap without a session.jsonl. `caps` makes
        # the runlog self-describing so a `timeout` is never ambiguous again.
        "session_id": session_id["id"],
        "resumes": resumes["n"],
        "resume_on_stall": resume_on_stall,
        "timeline": timeline,
        # Reasoning knobs actually used, so a run is self-describing when we
        # A/B effort × output-budget against subagent behavior. `effort_level`
        # and `agent_model` are added in run_e2e_test; `max_output_tokens` None
        # means the CLI default (sonnet-5 -> 32000).
        "max_output_tokens": max_output_tokens,
        "cli_version": cli_version["v"],
        "caps": {
            "wall_clock_seconds": fixture.caps.wall_clock_seconds,
            "inactivity_seconds": fixture.caps.inactivity_seconds,
            "progress_stall_seconds": fixture.caps.progress_stall_seconds,
            "tool_calls": fixture.caps.tool_calls,
            "max_turns": fixture.caps.max_turns,
            "max_cost_usd": fixture.caps.max_cost_usd,
        },
    }
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
    resume_on_stall: bool = False,
    effort_level: str | None = "high",
    max_output_tokens: int | None = None,
    agent_model: str | None = None,
) -> tuple[E2eResult, dict[str, Path]]:
    """Run one e2e fixture end-to-end. Returns (result, written-paths).

    Reasoning is pinned deliberately so runs don't inherit the launching Claude
    Code session / shell (which made verdicts non-reproducible):
    ``effort_level`` (low|medium|high|xhigh|max, default "high" to match Cowork)
    via a project-level setting; ``max_output_tokens`` (None = CLI default,
    sonnet-5 → 32000) via CLAUDE_CODE_MAX_OUTPUT_TOKENS. ``agent_model`` (None =
    fixture default for the parent + each subagent's own `.md` pin) overrides the
    model for BOTH the parent and every staged subagent — e.g. run the whole flow
    under claude-sonnet-4-6 to test whether the sonnet-5 record-extractor freeze
    reproduces under Cowork's model. All are logged.
    """
    fixture = load_fixture(fixture_dir)
    if not mcp_server_entry.exists():
        raise FileNotFoundError(
            f"MCP server build not found at {mcp_server_entry}. "
            "Run `npm run build` in packages/engine/mcp-server/ first."
        )

    started_at = time.time()  # real clock (counts system sleep)
    started_mono = time.monotonic()  # active clock (pauses during macOS sleep)
    with tempfile.TemporaryDirectory(prefix=f"e2e-{fixture.id}-") as tmp:
        workspace = build_workspace(
            fixture, Path(tmp), skills_dir, effort_level=effort_level, agent_model=agent_model
        )

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
            resume_on_stall=resume_on_stall,
            max_output_tokens=max_output_tokens,
            agent_model=agent_model,
        )

        final_research = read_research_json(workspace)
        final_tree = read_tree_json(workspace)
        stop_reason = derive_stop_reason(
            sdk_aborted_reason=aborted, research=final_research
        )

        judge_seconds = 0.0
        if skip_judge or final_tree is None:
            # Both cases produce no verdict: --skip-judge by request, or no
            # tree for the judge to grade (agent crashed before writing one).
            judge_output: dict[str, Any] = {}
            verdict = "skipped"
        else:
            judge_start = time.monotonic()
            try:
                judge_output = judge_module.run_judge(
                    research_question=fixture.researcher_question,
                    expected_findings=fixture.expected_findings,
                    final_tree=final_tree,
                    final_research=final_research,
                    model=fixture.judge_model,
                )
                # Deterministic §3.4.1 backstop: an `avoid` finding whose
                # target is still in the final tree is forced to matched:
                # "false" and the verdict recomputed (downgrade-only).
                judge_output = judge_module.apply_avoid_guard(
                    judge_output,
                    expected_findings=fixture.expected_findings,
                    final_tree=final_tree,
                    subject_person_ids=fixture.subject_person_ids,
                )
                verdict = str(judge_output.get("verdict") or "fail")
            except Exception as e:  # noqa: BLE001 — keep the run loggable
                judge_output = {"error": f"{type(e).__name__}: {e}"}
                verdict = "skipped"
            judge_seconds = time.monotonic() - judge_start

        # `wall_clock_seconds` is the ACTIVE wall-clock (time.monotonic), so it
        # matches the wall-clock cap and the stall watchdog (also monotonic) and
        # is NOT inflated by laptop sleep. `real_clock_seconds` is the literal
        # elapsed (time.time); `slept_seconds` (their gap) is ≈ time the machine
        # slept, so a long idle never masquerades as a stall again. `judge_seconds`
        # is the post-agent judge call, kept separate from the agent run.
        active_seconds = time.monotonic() - started_mono
        real_seconds = time.time() - started_at
        usage = {
            **usage,
            "wall_clock_seconds": active_seconds,
            "real_clock_seconds": real_seconds,
            "slept_seconds": max(0.0, real_seconds - active_seconds),
            "judge_seconds": judge_seconds,
            # Reasoning config, so a run is self-describing when A/B'ing effort ×
            # output-budget × model vs subagents[] behavior. `agent_model` is the
            # effective PARENT model. `subagent_model_override` is non-null only
            # when --agent-model forced every staged subagent off its own `.md`
            # pin (record-extractor's default is sonnet-5); null means each
            # subagent used its pin. `max_output_tokens` / `cli_version` come from
            # _run_agent.
            "agent_model": agent_model or fixture.agent_model,
            "subagent_model_override": agent_model,
            "effort_level": effort_level,
        }

        # Summarize any subagent transcripts (record-extractor, image-reader, …)
        # from the SDK's ephemeral cache while `workspace` is still in scope (the
        # cache lives outside the tempdir, keyed on workspace.name). Best-effort;
        # surfaces a runaway-thinking subagent freeze directly in the committed
        # runlog, which tool_calls alone can't show. See subagent_capture.py.
        subagents = collect_subagents(workspace)

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
            subagents=subagents,
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
