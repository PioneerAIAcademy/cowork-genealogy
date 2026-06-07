"""Real agent: drives the genealogy skills + stdio MCP server via the Claude
Agent SDK (claude-agent-sdk). Loaded only when AGENT_MODE=real.

Runs inside the agent_runner — a long-lived, clean `asyncio.run` stdio loop (one
per session). So it holds a PERSISTENT ClaudeSDKClient: connect once, query per
turn. That gives **cross-turn conversation memory** for free (the SDK keeps the
session across queries), which the conversational flows need — notably the
multi-turn init-project onboarding interview and follow-ups ("explain that").
The research work itself is state-driven (the skills re-read research.json), so
project state never depended on conversation memory; this adds the conversation.

Durability across a sandbox pause/resume (or any agent_runner restart): the
ResultMessage's session_id is persisted to /project/.agent_session, and a
relaunched RealAgent passes it as resume= so the SDK reloads the prior
conversation from the on-disk transcript (which survives the E2B pause). See
docs/plan/ably-realtime-migration.md is unrelated; the resume contract is
sandbox-provider-interface.md decision #1.

Config (build_options) — two load-bearing choices: do NOT set skills="all" (the
SDK turns it into `--allowedTools Skill`, restricting to only the Skill tool);
append the project path via system_prompt so the agent reads research.json from
cwd, not HOME.
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


def build_options(project_dir: Path, resume: str | None = None):
    from claude_agent_sdk import ClaudeAgentOptions

    project_note = (
        "You are the hosted genealogy research agent. The active research "
        f"project lives in your current working directory ({project_dir}). It "
        "contains research.json and tree.gedcomx.json — read and update those "
        "files there (do NOT look in the home directory). Follow the genealogy "
        "skills, and apply researcher_profile.narration_guidance from "
        "research.json as your narration style."
    )
    kwargs = dict(
        cwd=str(project_dir),
        add_dirs=[str(project_dir)],
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
    if resume:
        kwargs["resume"] = resume  # reload the prior conversation transcript
    return ClaudeAgentOptions(**kwargs)


def map_message(message) -> list[dict]:
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
                out.append(_event("tool_use", tool=block.name, summary=_tool_summary(getattr(block, "input", None))))
            elif isinstance(block, ToolResultBlock):
                out.append(_event("tool_result", tool="tool", summary=_result_summary(getattr(block, "content", None))))
    return out


def _tool_summary(inp: object) -> str:
    """A short, human-readable view of a tool's input for the chip + timeline —
    the Bash command, the search query, etc. — instead of a bare 'running'."""
    if not isinstance(inp, dict) or not inp:
        return "running"
    if "command" in inp:  # Bash
        return str(inp["command"])[:160]
    return ", ".join(f"{k}={v}" for k, v in list(inp.items())[:4])[:160] or "running"


def _result_summary(content: object) -> str:
    if isinstance(content, list):  # list of content blocks
        content = " ".join(getattr(c, "text", "") for c in content if hasattr(c, "text"))
    s = str(content or "").strip().replace("\n", " ")
    return s[:160] if s else "done"


class RealAgent:
    def __init__(self, project_dir: Path):
        self.dir = project_dir
        self._client = None
        self._session_file = project_dir / ".agent_session"
        self._resume_id: str | None = None
        if self._session_file.exists():
            try:
                self._resume_id = self._session_file.read_text().strip() or None
            except OSError:
                self._resume_id = None

    async def _ensure_client(self):
        if self._client is None:
            from claude_agent_sdk import ClaudeSDKClient

            self._client = ClaudeSDKClient(
                options=build_options(self.dir, resume=self._resume_id)
            )
            await self._client.connect()
        return self._client

    def _remember_session(self, message) -> None:
        sid = getattr(message, "session_id", None)
        if sid and sid != self._resume_id:
            self._resume_id = sid
            try:
                self._session_file.write_text(sid)
            except OSError:
                pass

    async def handle_turn(self, text: str) -> AsyncIterator[dict]:
        try:
            from claude_agent_sdk import ResultMessage
        except ImportError:
            yield _event("error", text="claude-agent-sdk not installed; use AGENT_MODE=mock")
            return
        try:
            client = await self._ensure_client()
        except Exception as exc:
            yield _event("error", text=f"Failed to start the agent: {exc}")
            return
        try:
            await client.query(text)
            async for message in client.receive_response():
                for ev in map_message(message):
                    yield ev
                if isinstance(message, ResultMessage):
                    self._remember_session(message)  # persist for resume on relaunch
                    break  # turn complete; the runner emits turn_done
        except Exception as exc:
            yield _event("error", text=f"Agent error: {exc}")
