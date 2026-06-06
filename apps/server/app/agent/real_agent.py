"""Real agent: drives the genealogy skills + stdio MCP server via the Claude
Agent SDK (claude-agent-sdk). Loaded only when AGENT_MODE=real.

- Loads the genealogy plugin (skills) directly from the repo's plugin/ via the
  SDK `plugins` option — no copying into the project.
- Forks the existing stdio MCP server (node mcp-server/build/index.js) as
  `mcp_servers.genealogy`; it reads the FS token from
  ~/.familysearch-mcp/tokens.json (HOME is set per-sandbox).
- Uses the one-shot `query()` per turn (runs to completion and terminates
  cleanly). Project state persists in research.json (re-read each turn), so a
  fresh context per turn is fine. Cross-turn CONVERSATION memory (capture the
  ResultMessage.session_id and pass resume=...) is a documented follow-up.

Do NOT set `skills="all"`: the SDK turns it into `--allowedTools Skill`, a
non-empty allowlist that restricts the agent to ONLY the Skill tool (no
Read/Bash/MCP), so turns never complete. With skills unset there is no
allowlist, so bypassPermissions grants every tool AND the built-in Skill tool
can still invoke the plugin's skills.
"""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path

# real_agent.py -> agent -> app -> server -> apps -> <repo root>
_REPO_ROOT = Path(__file__).resolve().parents[4]
_MCP_BUILD = os.environ.get("ENGINE_MCP_BUILD", str(_REPO_ROOT / "mcp-server" / "build" / "index.js"))
_PLUGIN_DIR = os.environ.get("ENGINE_PLUGIN_DIR", str(_REPO_ROOT / "plugin"))


def _event(kind: str, **kw) -> dict:
    return {"kind": kind, **kw}


class RealAgent:
    def __init__(self, project_dir: Path):
        self.dir = project_dir

    def _build_options(self):
        from claude_agent_sdk import ClaudeAgentOptions

        project_note = (
            "You are the hosted genealogy research agent. The active research "
            f"project lives in your current working directory ({self.dir}). It "
            "contains research.json and tree.gedcomx.json — read and update "
            "those files there (do NOT look in the home directory). Follow the "
            "genealogy skills, and apply researcher_profile.narration_guidance "
            "from research.json as your narration style."
        )
        return ClaudeAgentOptions(
            cwd=str(self.dir),
            add_dirs=[str(self.dir)],
            model=os.environ.get("MODEL") or None,
            permission_mode="bypassPermissions",  # operator-controlled, headless
            system_prompt={"type": "preset", "preset": "claude_code", "append": project_note},
            setting_sources=["user", "project"],
            plugins=[{"type": "local", "path": _PLUGIN_DIR}],
            mcp_servers={
                "genealogy": {"type": "stdio", "command": "node", "args": [_MCP_BUILD]},
            },
            env={"ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", "")},
        )

    async def handle_turn(self, text: str) -> AsyncIterator[dict]:
        """Canonical Agent SDK usage. VERIFIED working standalone (loads the
        genealogy plugin + MCP, reads the project, answers, terminates).

        KNOWN INTEGRATION ISSUE (not yet fixed): query() does NOT run correctly
        inside the agent_runner's `websockets.serve` handler — the SDK's anyio
        subprocess transport installs signal handlers / a child watcher that
        only work on the main thread, so query() hangs (no output, no
        ResultMessage) in that context. It also can't be moved to a worker
        thread for the same reason. Recommended fix: isolate query() in its own
        child PROCESS (a `query_worker` that emits JSON-line events to stdout,
        which the runner forwards over the WS), or run the agent loop in a host
        whose main-thread loop owns it. Mock mode is unaffected and is the POC
        default. See docs/plan/hosted-web-workbench-POC-status.md.
        """
        try:
            from claude_agent_sdk import query
        except ImportError:
            yield _event("error", text="claude-agent-sdk not installed; use AGENT_MODE=mock")
            return
        try:
            async for message in query(prompt=text, options=self._build_options()):
                for ev in _map_message(message):
                    yield ev
        except Exception as exc:
            yield _event("error", text=f"Agent error: {exc}")


def _map_message(message) -> list[dict]:
    from claude_agent_sdk import (
        AssistantMessage,
        TextBlock,
        ThinkingBlock,
        ToolResultBlock,
        ToolUseBlock,
    )

    out: list[dict] = []
    if isinstance(message, AssistantMessage):
        for block in message.content:
            if isinstance(block, TextBlock):
                out.append(_event("text", text=block.text))
            elif isinstance(block, ThinkingBlock):
                out.append(_event("thinking", text=getattr(block, "thinking", "")))
            elif isinstance(block, ToolUseBlock):
                out.append(_event("tool_use", tool=block.name, summary="running"))
            elif isinstance(block, ToolResultBlock):
                out.append(_event("tool_result", tool="tool", summary="done"))
    # UserMessage / SystemMessage / ResultMessage carry no chat-visible text;
    # query() terminates after the ResultMessage, so the runner emits turn_done.
    return out
