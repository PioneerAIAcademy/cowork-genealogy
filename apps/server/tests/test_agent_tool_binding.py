"""A granted tool must actually BIND at runtime — issue #1084.

Every other check stops at spelling. `test_plugin_agents.py` proves the agent is
registered under its bare name and its `tools:` entries name real tools under the
right spellings — but not that the agent can actually CALL them. The silent-failure
mode: the agent spawns fine, `tools:` looks right, the grant never binds, and the
agent quietly falls back to what it does have. That reads as success in every static
check and every eval.

The SDK init handshake cannot close this (it exposes agent name/description/model,
never tools — issue #1084's measurement). The only proof is behavioral: force the
agent to call the tool and read the recorded tool_use.

This is the repo's FIRST check that spends a model turn (`agent-smoke` bills nothing).
It is the most model-dependent thing in the check tier. Per the lead's ruling
(2026-08-27): if it proves flaky, DELETE it — do not loosen the assertion into
something that passes on narration. Scope is deliberately one agent × one tool × one
turn: gps-mentor × wiki_search, the one live case issue #1344 surfaced. A green probe
covers the `mcp__genealogy__` spelling only; it does not close the nothing-checks gap.

Opt-in exactly like `agent-smoke`: skipped under an ordinary suite run, and FAILED
(never skipped) when `make agent-tool-bind` (`AGENT_TOOL_BIND=1`) asked for it by name.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import uuid
from pathlib import Path

import pytest

from app.agent import real_agent

REPO_ROOT = Path(__file__).resolve().parents[3]
PLUGIN_DIR = REPO_ROOT / "packages" / "engine" / "plugin"

_ENGINE_BUILD = Path(
    os.environ.get(
        "ENGINE_MCP_BUILD",
        str(REPO_ROOT / "packages/engine/mcp-server/build/index.js"),
    )
)

# Opt-in, and NOT via ANTHROPIC_API_KEY: conftest.py blanks that var on import.
# `make agent-tool-bind` sources eval/.env and exports it under this name.
_LIVE_KEY = os.environ.get("LIVE_ANTHROPIC_API_KEY", "")

# Set only by the `agent-tool-bind` target — i.e. by someone who asked for THIS
# check. A skip is right for a contributor with no key; it is wrong for the one
# command whose entire job is to run this probe (see test_plugin_agents.py).
_INVOKED_AS_PROBE = bool(os.environ.get("AGENT_TOOL_BIND"))

_TARGET_AGENT = "gps-mentor"
_TARGET_TOOL = "wiki_search"

# Force delegation to gps-mentor and a single wiki_search call. The main session
# also holds wiki_search, so the assertion below reads gps-mentor's OWN transcript,
# not "was the tool called anywhere" — a main-agent call must not pass.
_PROMPT = (
    "Use the Task tool to launch the gps-mentor subagent, and do nothing else "
    "yourself. Give it EXACTLY this instruction: \"Call the wiki_search tool once "
    "with the query 'Ireland civil registration'. Report the title of the first "
    "result verbatim. Call no other tool.\""
)


def _missing_prerequisites() -> list[str]:
    """What stops the live probe from running, each with its remedy. Read twice:
    as the skip reason for an ordinary run, and as the failure message when
    `make agent-tool-bind` asked for this check by name."""
    missing = []
    if not _LIVE_KEY:
        missing.append(
            "no Anthropic key — set ANTHROPIC_API_KEY, or put ANTHROPIC_API_KEY=... "
            "in eval/.env (this probe spends one model turn, so it needs a real key)"
        )
    if not _ENGINE_BUILD.exists():
        missing.append(f"no compiled engine at {_ENGINE_BUILD} — run `make engine-build`")
    if shutil.which("node") is None:
        missing.append("node is not on PATH — the MCP server is a node process")
    return missing


def _bare_tool_name(name: str) -> str:
    """`mcp__genealogy__wiki_search` / `mcp__…__wiki_search` -> `wiki_search`."""
    return (name or "").split("__")[-1]


def _subagent_tool_calls(project_dir: Path, agent_type: str) -> list[str] | None:
    """The bare tool names recorded in `agent_type`'s OWN subagent transcript for
    this run, or None if that agent produced no transcript.

    Subagent transcripts live at
    `~/.claude/projects/<slug>/**/subagents/agent-*.jsonl` (+ a `<stem>.meta.json`
    carrying `agentType`). The CLI slugifies the workspace path into <slug>,
    rewriting `_` / `.` / `/` to `-`, and the match is `slug.endswith(leaf)` — which
    is why the caller's workspace leaf must be dash/alnum only (no underscores), or
    this never matches and every run looks like "agent not spawned" (issue #1084
    plan review). Reimplemented inline rather than importing
    eval/harness/e2e/subagent_capture (a separate uv project, not importable here)."""
    projects = Path.home() / ".claude" / "projects"
    if not projects.is_dir():
        return None
    leaf = project_dir.name
    jsonls: list[Path] = []
    for d in projects.iterdir():
        if d.is_dir() and d.name.endswith(leaf):
            jsonls.extend(d.rglob("agent-*.jsonl"))

    # Pick this agent's transcript by its meta `agentType`. With a single delegated
    # subagent, a missing meta falls back to the sole transcript.
    chosen: Path | None = None
    for jsonl in jsonls:
        meta = jsonl.parent / (jsonl.stem + ".meta.json")
        if meta.exists():
            try:
                at = json.loads(meta.read_text(encoding="utf-8")).get("agentType")
            except (OSError, json.JSONDecodeError):
                continue
            # Observed bare ("gps-mentor") in the passing run; also accept a
            # namespaced form ("genealogy-research:gps-mentor") so the primary
            # match stays live if the SDK ever namespaces it, rather than
            # silently leaning on the sole-transcript fallback below.
            if isinstance(at, str) and at.split(":")[-1] == agent_type:
                chosen = jsonl
                break
    if chosen is None and len(jsonls) == 1:
        chosen = jsonls[0]
    if chosen is None:
        return None

    calls: list[str] = []
    for line in chosen.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        content = (rec.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                calls.append(_bare_tool_name(block.get("name", "")))
    return calls


@pytest.mark.skipif(
    bool(_missing_prerequisites()) and not _INVOKED_AS_PROBE,
    reason="live probe — run `make agent-tool-bind`: " + "; ".join(_missing_prerequisites()),
)
async def test_gps_mentor_wiki_search_grant_binds(monkeypatch):
    """Spawn gps-mentor for real, force one wiki_search call, and assert it appears
    in gps-mentor's OWN tool-call record.

    Asserts on the tool_use RECORD, never the prose: a model that narrates "I would
    call wiki_search" leaves no tool_use and must fail. The recorded call proves the
    grant bound even if the wiki API then errors (the tool_use is the request,
    emitted before the tool runs; any error is a separate tool_result).
    """
    missing = _missing_prerequisites()
    if missing:
        # Reached only under AGENT_TOOL_BIND — the skipif covers every other caller.
        pytest.fail(
            "make agent-tool-bind could not run the ONLY check that proves a granted "
            "tool actually binds at runtime:\n  - " + "\n  - ".join(missing)
        )

    from claude_agent_sdk import ClaudeSDKClient

    monkeypatch.setattr(real_agent, "_PLUGIN_DIR", str(PLUGIN_DIR))
    monkeypatch.setattr(real_agent, "_MCP_BUILD", str(_ENGINE_BUILD))

    # Dash/alnum-only leaf (no `_`): the CLI slug transform + endswith match in
    # _subagent_tool_calls require it — pytest's tmp_path leaf has underscores and
    # would never match (issue #1084 plan review, blocking finding).
    project_dir = Path(tempfile.gettempdir()) / f"agent-tool-bind-{uuid.uuid4().hex}"
    project_dir.mkdir()
    try:
        client = ClaudeSDKClient(
            options=real_agent.build_options(project_dir, api_key=_LIVE_KEY)
        )
        await client.connect()
        cost: float | None = None
        try:
            await client.query(_PROMPT)
            async for message in client.receive_response():
                # The final ResultMessage carries the turn's billed cost — captured
                # so the run can report the figure the target's help text quotes.
                c = getattr(message, "total_cost_usd", None)
                if isinstance(c, (int, float)):
                    cost = c
        finally:
            await client.disconnect()
        if cost is not None:
            print(f"\n[agent-tool-bind] one-turn cost: ${cost:.4f}")

        calls = _subagent_tool_calls(project_dir, _TARGET_AGENT)
        assert calls is not None, (
            f"no {_TARGET_AGENT} subagent transcript for this run — the agent was not "
            f"spawned as itself (Task delegation failed, or it fell back to a "
            f"general-purpose stand-in). This is a spawn failure, not a binding result."
        )
        assert _TARGET_TOOL in calls, (
            f"{_TARGET_AGENT} spawned but never called {_TARGET_TOOL}; its recorded "
            f"tool_use calls were {sorted(set(calls))}. The `{_TARGET_TOOL}` grant in "
            f"its tools: did not bind — the silent fallback this probe exists to catch."
        )
    finally:
        shutil.rmtree(project_dir, ignore_errors=True)
