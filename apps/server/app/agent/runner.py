"""agent_runner — runs INSIDE the sandbox (a local subprocess for the POC; a
process in the E2B microVM when hosted). It owns one user's agent for the life
of the session and speaks JSON lines over **stdio** (not a WebSocket server):

  stdin  : {"type":"user_msg","text":"..."} | {"type":"interrupt"}  (one per line)
  stdout : {"type":"agent_event","event":{...}}   (one per line)

stdin is drained concurrently with the running turn (a reader task feeds a
queue), so an interrupt sent mid-turn is acted on immediately rather than read
only after the turn it was meant to stop has already finished — which is what
made interrupt a no-op while the loop blocked inside handle_turn.

The in-sandbox WS server (app/sandbox_server.py) spawns this and pumps its stdio
to/from the browser. Running over stdio (rather than the Agent SDK directly
inside websockets.serve) keeps the SDK in a clean top-level asyncio loop — its
anyio subprocess transport hangs when hosted inside websockets.serve.

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


async def _run_turn(agent, text: str, emit) -> None:
    """One turn. Always ends with exactly one turn_done — the client keys its
    busy state on it, so an error or an interrupt-cancellation must still emit it
    or the UI hangs on a spinner forever."""
    try:
        async for event in agent.handle_turn(text):
            emit(event)
    except asyncio.CancelledError:
        # Interrupt path for agents that cannot self-stop (the mock): the turn
        # task was cancelled. Report the stop, then let turn_done fall through.
        emit({"kind": "error", "text": "(stopped)"})
    except Exception as exc:  # never die on an agent error
        emit({"kind": "error", "text": f"Agent error: {exc}"})
    emit({"kind": "turn_done"})  # sole source of turn_done (mock + real)


async def serve(agent, incoming: "asyncio.Queue", emit) -> None:
    """Dispatch messages from ``incoming`` (a queue fed concurrently with the
    running turn; ``None`` = stdin EOF). At most one turn runs at a time —
    additional user_msgs while busy are dropped (the UI disables Send). An
    interrupt asks the agent to stop; agents that can't (return falsy) are
    cancelled instead. Extracted from main() so it is testable without stdio."""
    turn_task: asyncio.Task | None = None
    while True:
        msg = await incoming.get()
        if msg is None:  # stdin EOF — the control plane closed the connection
            break
        mtype = msg.get("type")
        if mtype == "user_msg":
            if turn_task and not turn_task.done():
                continue  # already busy; the UI prevents concurrent sends
            turn_task = asyncio.create_task(_run_turn(agent, msg.get("text", ""), emit))
        elif mtype == "interrupt":
            if turn_task and not turn_task.done():
                handled = False
                try:
                    handled = bool(await agent.interrupt())
                except Exception as exc:
                    emit({"kind": "error", "text": f"Interrupt failed: {exc}"})
                # The real agent tells the SDK to abort and its stream ends on its
                # own (handled=True). An agent that can't self-stop is cancelled;
                # _run_turn turns that into (stopped) + turn_done.
                if not handled:
                    turn_task.cancel()
    if turn_task and not turn_task.done():
        turn_task.cancel()


async def main() -> None:
    project_dir = Path(os.environ.get("PROJECT_DIR", "/project"))
    agent = _make_agent(project_dir)

    incoming: asyncio.Queue = asyncio.Queue()

    async def reader() -> None:
        # Blocking readline off-thread so the event loop stays free for the
        # agent's async work and for interrupts arriving mid-turn.
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:  # EOF
                await incoming.put(None)
                return
            line = line.strip()
            if not line:
                continue
            try:
                await incoming.put(json.loads(line))
            except json.JSONDecodeError:
                continue

    reader_task = asyncio.create_task(reader())
    try:
        await serve(agent, incoming, _emit)
    finally:
        reader_task.cancel()


if __name__ == "__main__":
    asyncio.run(main())
