"""agent_runner — runs INSIDE the sandbox (a local subprocess for the POC; a
process in the E2B microVM when hosted). It owns one user's agent for the life
of the session and speaks JSON lines over **stdio** (not a WebSocket server):

  stdin  : {"type":"user_msg","text":"..."}   (one per line)
  stdout : {"type":"agent_event","event":{...}}   (one per line)

The control plane spawns this via SandboxProvider.start_process and pumps its
stdio to/from the browser. Running over stdio (rather than an in-sandbox
websockets server) keeps the Agent SDK in a clean top-level asyncio loop — the
SDK's anyio subprocess transport hangs when hosted inside websockets.serve.

Project-file changes are NOT emitted here — the control plane watches /project
and streams viewer deltas separately. This runner is the chat channel only.

Run as:  python -m app.agent.runner   (env: AGENT_MODE, PROJECT_DIR, MODEL,
          ANTHROPIC_API_KEY, HOME)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

try:  # package context (python -m app.agent.runner)
    from .mock_agent import MockAgent
except ImportError:  # loose script alongside mock_agent.py (baked E2B image)
    from mock_agent import MockAgent  # type: ignore


def _make_agent(project_dir: Path):
    if os.environ.get("AGENT_MODE", "mock") == "real":
        try:
            from .real_agent import RealAgent  # type: ignore
        except ImportError:
            from real_agent import RealAgent  # type: ignore
        return RealAgent(project_dir)
    return MockAgent(project_dir)


def _emit(event: dict) -> None:
    sys.stdout.write(json.dumps({"type": "agent_event", "event": event}) + "\n")
    sys.stdout.flush()


async def main() -> None:
    project_dir = Path(os.environ.get("PROJECT_DIR", "/project"))
    agent = _make_agent(project_dir)

    # Read user messages from stdin (blocking readline off-thread so the event
    # loop stays free for the agent's async work).
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:  # EOF — the control plane closed the connection
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("type") != "user_msg":
            continue  # interrupt/other types: handled in a later pass

        try:
            async for event in agent.handle_turn(msg.get("text", "")):
                _emit(event)
        except Exception as exc:  # never die on an agent error
            _emit({"kind": "error", "text": f"Agent error: {exc}"})
        _emit({"kind": "turn_done"})  # sole source of turn_done (mock + real)


if __name__ == "__main__":
    asyncio.run(main())
