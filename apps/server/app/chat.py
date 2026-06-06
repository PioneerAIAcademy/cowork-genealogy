"""Chat channel: launch the in-sandbox agent_runner and connect to its WebSocket
so the control plane can proxy browser <-> agent for chat. Project-file deltas
are handled separately by the viewer watch (ws.py), so this is chat only.

This exercises the spec's WS-port round-trip (decision #3): start_process ->
expose_port -> proxy. For LocalProvider the agent is a local subprocess; the
launch command differs for E2B (runner baked into the image), which the
E2BProvider will supply when implemented.
"""
from __future__ import annotations

import asyncio
import socket
import sys
from pathlib import Path

import websockets
from websockets.exceptions import WebSocketException

from .config import get_settings
from .models import Project
from .sandbox.base import Process, Sandbox

SERVER_ROOT = Path(__file__).resolve().parent.parent  # apps/server


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


async def start_agent_runner(sandbox: Sandbox, project: Project) -> tuple[str, Process]:
    """Launch the agent_runner inside the sandbox; return (ws_url, process)."""
    settings = get_settings()
    port = _free_port()
    env = {
        "AGENT_PORT": str(port),
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
    proc = await sandbox.start_process(cmd, env=env)
    conn = await sandbox.expose_port(port)
    return conn.url, proc


async def connect_agent(url: str, *, attempts: int = 40, delay: float = 0.2):
    """Connect to the agent_runner WS, retrying until it's listening."""
    last: Exception | None = None
    for _ in range(attempts):
        try:
            return await websockets.connect(url, open_timeout=2)
        except (OSError, asyncio.TimeoutError, WebSocketException) as exc:
            last = exc
            await asyncio.sleep(delay)
    raise RuntimeError(f"agent_runner did not come up at {url}: {last}")
