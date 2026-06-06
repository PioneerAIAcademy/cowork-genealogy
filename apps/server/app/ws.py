"""The browser WebSocket: viewer deltas (M3) + chat proxy (M4), multiplexed on
one socket per active session.

Viewer path (M3) is independent of chat: on connect the control plane reads
/project from the sandbox and pushes a snapshot, then watches the project dir
(LocalProvider polls; E2BProvider will use files.watch_dir) and streams
research_updated / gedcomx_updated / sidecar_updated. This is the spec's
decoupled read path — the viewer updates even with no conversation.

Realtime backend: this is the "local_ws" relay. The production path
(REALTIME=ably/pusher) would instead have the agent_runner publish deltas to a
per-session channel the browser subscribes to directly, leaving this endpoint
(and the whole control plane) free of long-lived sockets — see config.realtime.
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlmodel import Session

from .auth import COOKIE_NAME, decode_session_token
from .chat import connect_agent, start_agent_runner
from .db import get_engine
from .models import Project
from .sandbox.base import PROJECT_DIR, Sandbox

router = APIRouter()


async def _send(ws: WebSocket, **payload) -> None:
    await ws.send_text(json.dumps(payload))


async def _read_json(sandbox: Sandbox, path: str):
    raw = await sandbox.read_file(path)
    if raw is None:
        return None
    return json.loads(raw.decode("utf-8"))


async def push_full_snapshot(ws: WebSocket, sandbox: Sandbox) -> None:
    """Initial hydration: research + gedcomx + the sidecar pointers."""
    try:
        research = await _read_json(sandbox, f"{PROJECT_DIR}/research.json")
        if research is not None:
            await _send(ws, type="research_updated", data=research)
    except json.JSONDecodeError:
        await _send(ws, type="error", message="research.json is not valid JSON")
    try:
        gedcomx = await _read_json(sandbox, f"{PROJECT_DIR}/tree.gedcomx.json")
        if gedcomx is not None:
            await _send(ws, type="gedcomx_updated", data=gedcomx)
    except json.JSONDecodeError:
        await _send(ws, type="error", message="tree.gedcomx.json is not valid JSON")
    for entry in await sandbox.list_dir(f"{PROJECT_DIR}/results"):
        if entry.is_dir or not entry.name.endswith(".json"):
            continue
        mtime = await sandbox.file_mtime(entry.path) or 0
        await _send(ws, type="sidecar_updated", logId=entry.name[:-5], mtime=mtime)


async def push_change(ws: WebSocket, sandbox: Sandbox, rel: str) -> None:
    """A single /project file changed (relative path under /project)."""
    if rel == "research.json":
        try:
            data = await _read_json(sandbox, f"{PROJECT_DIR}/research.json")
            if data is not None:
                await _send(ws, type="research_updated", data=data)
        except json.JSONDecodeError:
            pass  # mid-write; the next poll picks up the settled file
    elif rel == "tree.gedcomx.json":
        try:
            data = await _read_json(sandbox, f"{PROJECT_DIR}/tree.gedcomx.json")
            if data is not None:
                await _send(ws, type="gedcomx_updated", data=data)
        except json.JSONDecodeError:
            pass
    elif rel.startswith("results/") and rel.endswith(".json"):
        log_id = rel[len("results/") : -len(".json")]
        mtime = await sandbox.file_mtime(f"{PROJECT_DIR}/{rel}") or 0
        await _send(ws, type="sidecar_updated", logId=log_id, mtime=mtime)


@router.websocket("/ws/sessions/{session_id}")
async def session_ws(websocket: WebSocket, session_id: str) -> None:
    # ── auth (cookie) + ownership ────────────────────────────────
    user_id = decode_session_token(websocket.cookies.get(COOKIE_NAME))
    if not user_id:
        await websocket.close(code=4401)
        return
    with Session(get_engine()) as db:
        project = db.get(Project, session_id)
        if project is None or project.user_id != user_id:
            await websocket.close(code=4404)
            return

    await websocket.accept()
    provider = websocket.app.state.provider
    sandbox = await provider.resume(project.sandbox_id)

    await _send(websocket, type="status", state="ready")
    await push_full_snapshot(websocket, sandbox)

    # ── watch /project → push deltas (the decoupled viewer path) ─
    queue: asyncio.Queue[str] = asyncio.Queue()
    stop_watch = sandbox.watch_project(lambda rel: queue.put_nowait(rel))

    async def pump_changes() -> None:
        while True:
            rel = await queue.get()
            await push_change(websocket, sandbox, rel)

    pump_task = asyncio.create_task(pump_changes())

    # ── chat: launch + proxy the in-sandbox agent_runner ─────────
    agent_ws = None
    agent_proc = None
    agent_task = None
    try:
        agent_url, agent_proc = await start_agent_runner(sandbox, project)
        agent_ws = await connect_agent(agent_url)

        async def pump_agent() -> None:
            try:
                async for raw in agent_ws:  # agent_event / turn_done frames
                    await websocket.send_text(raw)
            except Exception:
                pass

        agent_task = asyncio.create_task(pump_agent())
        await _send(websocket, type="status", state="chat_ready")
    except Exception as exc:
        await _send(websocket, type="status", state="chat_error", message=str(exc))

    # ── receive loop: forward chat to the agent ──────────────────
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") in ("user_msg", "interrupt") and agent_ws is not None:
                try:
                    await agent_ws.send(raw)
                except Exception:
                    await _send(websocket, type="status", state="chat_error",
                                message="agent connection lost")
    except WebSocketDisconnect:
        pass
    finally:
        stop_watch()
        pump_task.cancel()
        if agent_task is not None:
            agent_task.cancel()
        if agent_ws is not None:
            try:
                await agent_ws.close()
            except Exception:
                pass
        if agent_proc is not None:
            try:
                await agent_proc.kill()
            except Exception:
                pass
