"""agent_runner — runs INSIDE the sandbox (a local subprocess for the POC; a
process in the E2B microVM when hosted). A tiny WebSocket server that owns one
user's agent and streams agent_event messages. The control plane reaches it via
the sandbox's exposed port and proxies the browser socket to it.

Protocol (JSON over WS):
  in : {"type":"user_msg","text":"..."}
  out: {"type":"agent_event","event":{"kind":"text"|"tool_use"|"tool_result"|
        "thinking"|"turn_done"|"error", ...}}

Project-file changes are NOT pushed here — the control plane watches /project
and streams viewer deltas separately (the decoupled viewer path). This runner
is the chat channel only.

Run as:  python -m app.agent.runner     (env: AGENT_PORT, AGENT_MODE, PROJECT_DIR,
         MODEL, ANTHROPIC_API_KEY)
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import websockets

try:  # package context (python -m app.agent.runner)
    from .mock_agent import MockAgent
except ImportError:  # loose script alongside mock_agent.py (baked E2B image)
    from mock_agent import MockAgent  # type: ignore


def _make_agent(project_dir: Path):
    mode = os.environ.get("AGENT_MODE", "mock")
    if mode == "real":
        try:
            from .real_agent import RealAgent  # type: ignore
        except ImportError:
            from real_agent import RealAgent  # type: ignore
        return RealAgent(project_dir)
    return MockAgent(project_dir)


async def _handler(ws) -> None:
    project_dir = Path(os.environ.get("PROJECT_DIR", "/project"))
    agent = _make_agent(project_dir)
    async for raw in ws:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if msg.get("type") != "user_msg":
            continue
        try:
            async for event in agent.handle_turn(msg.get("text", "")):
                await ws.send(json.dumps({"type": "agent_event", "event": event}))
        except Exception as exc:  # never kill the socket on an agent error
            await ws.send(json.dumps(
                {"type": "agent_event",
                 "event": {"kind": "error", "text": f"Agent error: {exc}"}}
            ))
            await ws.send(json.dumps(
                {"type": "agent_event", "event": {"kind": "turn_done"}}
            ))


async def main() -> None:
    port = int(os.environ.get("AGENT_PORT", "8765"))
    async with websockets.serve(_handler, "127.0.0.1", port):
        # Readiness marker on stdout so a supervisor can wait if it wants.
        print(f"agent_runner listening on 127.0.0.1:{port}", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
