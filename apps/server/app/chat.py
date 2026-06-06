"""Chat channel: launch the in-sandbox agent_runner. The control plane pumps the
returned Process's stdio (JSON lines) to/from the browser — no in-sandbox
WebSocket server, no expose_port. (Project-file deltas come from the viewer
watch in ws.py, so this channel is chat-only.)

For LocalProvider the agent is a local subprocess; the launch command differs
for E2B (runner baked into the image), which the E2BProvider will supply.
"""
from __future__ import annotations

import sys
from pathlib import Path

from .config import get_settings
from .models import Project
from .sandbox.base import Process, Sandbox

SERVER_ROOT = Path(__file__).resolve().parent.parent  # apps/server


async def start_agent_process(sandbox: Sandbox, project: Project) -> Process:
    settings = get_settings()
    env = {
        "AGENT_MODE": settings.agent_mode,
        "PROJECT_DIR": sandbox.agent_project_dir(),
        # Per-sandbox HOME so the engine MCP server reads this session's
        # ~/.familysearch-mcp/tokens.json (option a token injection).
        "HOME": sandbox.agent_home_dir(),
        "MODEL": project.model,
        "PYTHONPATH": str(SERVER_ROOT),
    }
    if settings.anthropic_api_key:
        env["ANTHROPIC_API_KEY"] = settings.anthropic_api_key
    cmd = f"{sys.executable} -m app.agent.runner"
    return await sandbox.start_process(cmd, env=env)
