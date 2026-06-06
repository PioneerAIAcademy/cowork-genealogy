"""Chat path — launches/relays the in-sandbox agent_runner and streams
agent_event messages. Filled in M4. For M3 (viewer-only) this acknowledges
that chat is not wired yet.
"""
from __future__ import annotations

import json

from fastapi import WebSocket

from .models import Project
from .sandbox.base import Sandbox


async def handle_user_message(
    ws: WebSocket, sandbox: Sandbox, project: Project, text: str
) -> None:
    await ws.send_text(
        json.dumps(
            {
                "type": "agent_event",
                "event": {"kind": "notice", "text": "Chat is enabled in M4."},
            }
        )
    )
