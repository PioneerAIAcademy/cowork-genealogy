"""Real agent: drives the genealogy skills + stdio MCP server via the Claude
Agent SDK. Loaded only when AGENT_MODE=real.

Status: best-effort, UNVERIFIED end-to-end (needs `claude-agent-sdk` installed +
the Claude Code CLI on PATH + an ANTHROPIC_API_KEY + the engine build). It
degrades gracefully — if the SDK is missing it streams a clear message instead
of crashing the runner. The mock agent proves the whole harness around it
(proxy, file-watch → viewer, resume); this is the one net-new piece to verify
once the SDK is provisioned. Event mapping follows the Agent SDK message shape
(sandbox-provider-interface.md §6) and may need refinement against the installed
SDK version.
"""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path

# The genealogy MCP server build (host repo layout: apps/server/app/agent ->
# repo root -> mcp-server/build/index.js).
_DEFAULT_MCP_BUILD = (
    Path(__file__).resolve().parents[3] / "mcp-server" / "build" / "index.js"
)


def _event(kind: str, **kw) -> dict:
    return {"kind": kind, **kw}


class RealAgent:
    def __init__(self, project_dir: Path):
        self.dir = project_dir

    async def handle_turn(self, text: str) -> AsyncIterator[dict]:
        try:
            from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
        except ImportError:
            yield _event(
                "error",
                text=(
                    "Real agent mode needs `claude-agent-sdk` (uv add "
                    "claude-agent-sdk) + the Claude Code CLI + ANTHROPIC_API_KEY. "
                    "Use AGENT_MODE=mock until those are provisioned."
                ),
            )
            return

        mcp_build = os.environ.get("ENGINE_MCP_BUILD", str(_DEFAULT_MCP_BUILD))
        options = ClaudeAgentOptions(
            cwd=str(self.dir),
            setting_sources=["project"],  # load .claude/skills from the project
            skills="all",
            permission_mode="bypassPermissions",
            model=os.environ.get("MODEL"),
            env={"ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", "")},
            mcp_servers={
                "genealogy": {
                    "command": "node",
                    "args": [mcp_build],
                    # The MCP server reads the FS token from
                    # ~/.familysearch-mcp/tokens.json (HOME is set per-sandbox).
                    "env": {},
                }
            },
        )

        try:
            async with ClaudeSDKClient(options=options) as client:
                await client.query(text)
                async for message in client.receive_response():
                    for ev in _map_message(message):
                        yield ev
        except Exception as exc:  # surface, don't crash the runner
            yield _event("error", text=f"Agent SDK error: {exc}")


def _map_message(message) -> list[dict]:
    """Map an Agent SDK message to chat events. Defensive — the exact classes
    vary by SDK version, so probe by attribute."""
    out: list[dict] = []
    content = getattr(message, "content", None)
    if content is None:
        text = getattr(message, "text", None)
        if text:
            out.append(_event("text", text=str(text)))
        return out
    for block in content if isinstance(content, list) else [content]:
        btype = getattr(block, "type", None)
        if btype == "text" or hasattr(block, "text"):
            out.append(_event("text", text=getattr(block, "text", "")))
        elif btype == "tool_use" or hasattr(block, "name"):
            out.append(_event("tool_use", tool=getattr(block, "name", "tool"),
                              summary=""))
        elif btype == "tool_result":
            out.append(_event("tool_result", tool="tool", summary="done"))
    return out
