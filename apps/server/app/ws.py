"""The browser WebSocket (the local_ws realtime backend): viewer deltas + chat,
multiplexed on one socket per active session.

Phase 1 of the Ably migration (docs/plan/ably-realtime-migration.md): all
outbound frames now go through `realtime.publish(session_id, frame)` instead of
writing the socket directly, so the watch/pump code is backend-agnostic and the
two backends share one fanout path. For the local_ws backend, publish() fans out
to the WebSocket(s) attached here. Inbound chat (user_msg/interrupt → agent
stdin) stays on this socket for local_ws. The Ably backend (Phase 2-3) reaches
the same publish() from a per-session manager + REST endpoints instead.

Viewer path is independent of chat: read /project, push a snapshot, watch the
dir, stream research_updated / gedcomx_updated / sidecar_updated.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlmodel import Session

from .auth import COOKIE_NAME, decode_session_token
from .chat import start_agent_process
from .config import get_settings
from .db import get_engine
from .models import Project
from .realtime import LocalWsRealtime
from .sandbox.base import PROJECT_DIR, Sandbox

router = APIRouter()

Publish = Callable[[dict], Awaitable[None]]


async def mirror_to_backup(sandbox: Sandbox, rel: str) -> None:
    """Mirror a /project file to the server's local backup dir as it streams —
    cheap insurance against losing a sandbox (POC stand-in for object-store
    sync). rel is relative to /project, e.g. 'research.json'."""
    raw = await sandbox.read_file(f"{PROJECT_DIR}/{rel}")
    if raw is None:
        return
    dest = get_settings().backup_dir / sandbox.id / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)


async def _read_json(sandbox: Sandbox, path: str):
    raw = await sandbox.read_file(path)
    if raw is None:
        return None
    return json.loads(raw.decode("utf-8"))


async def push_full_snapshot(publish: Publish, sandbox: Sandbox) -> None:
    """Initial hydration: research + gedcomx + the sidecar pointers."""
    research = None
    gedcomx = None
    try:
        research = await _read_json(sandbox, f"{PROJECT_DIR}/research.json")
        if research is not None:
            await publish({"type": "research_updated", "data": research})
    except json.JSONDecodeError:
        await publish({"type": "error", "message": "research.json is not valid JSON"})
    try:
        gedcomx = await _read_json(sandbox, f"{PROJECT_DIR}/tree.gedcomx.json")
        if gedcomx is not None:
            await publish({"type": "gedcomx_updated", "data": gedcomx})
    except json.JSONDecodeError:
        await publish({"type": "error", "message": "tree.gedcomx.json is not valid JSON"})
    if research is not None:
        await mirror_to_backup(sandbox, "research.json")
    if gedcomx is not None:
        await mirror_to_backup(sandbox, "tree.gedcomx.json")
    for entry in await sandbox.list_dir(f"{PROJECT_DIR}/results"):
        if entry.is_dir or not entry.name.endswith(".json"):
            continue
        mtime = await sandbox.file_mtime(entry.path) or 0
        await publish({"type": "sidecar_updated", "logId": entry.name[:-5], "mtime": mtime})
        await mirror_to_backup(sandbox, f"results/{entry.name}")


async def push_change(publish: Publish, sandbox: Sandbox, rel: str) -> None:
    """A single /project file changed (relative path under /project)."""
    if rel == "research.json":
        try:
            data = await _read_json(sandbox, f"{PROJECT_DIR}/research.json")
            if data is not None:
                await publish({"type": "research_updated", "data": data})
        except json.JSONDecodeError:
            return  # mid-write; the next poll picks up the settled file
    elif rel == "tree.gedcomx.json":
        try:
            data = await _read_json(sandbox, f"{PROJECT_DIR}/tree.gedcomx.json")
            if data is not None:
                await publish({"type": "gedcomx_updated", "data": data})
        except json.JSONDecodeError:
            return
    elif rel.startswith("results/") and rel.endswith(".json"):
        log_id = rel[len("results/") : -len(".json")]
        mtime = await sandbox.file_mtime(f"{PROJECT_DIR}/{rel}") or 0
        await publish({"type": "sidecar_updated", "logId": log_id, "mtime": mtime})
    else:
        return  # not a viewer-relevant file
    await mirror_to_backup(sandbox, rel)


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
        from .models import utcnow

        project.last_active = utcnow()  # keep active sessions out of idle-suspend
        db.add(project)
        db.commit()
        db.refresh(project)

    await websocket.accept()
    websocket.app.state.active_sessions.add(session_id)
    realtime = websocket.app.state.realtime
    # The /ws endpoint is the local_ws backend: register this socket as a
    # subscriber so realtime.publish() fans out to it.
    if isinstance(realtime, LocalWsRealtime):
        realtime.attach(session_id, websocket)

    async def publish(msg: dict) -> None:
        await realtime.publish(session_id, msg)

    provider = websocket.app.state.provider
    sandbox = await provider.resume(project.sandbox_id)

    await publish({"type": "status", "state": "ready"})
    await push_full_snapshot(publish, sandbox)

    # ── watch /project → publish deltas (the decoupled viewer path) ─
    queue: asyncio.Queue[str] = asyncio.Queue()
    stop_watch = sandbox.watch_project(lambda rel: queue.put_nowait(rel))

    async def pump_changes() -> None:
        while True:
            rel = await queue.get()
            await push_change(publish, sandbox, rel)

    pump_task = asyncio.create_task(pump_changes())

    # ── chat: launch the in-sandbox agent_runner, publish its stdio ─
    agent_proc = None
    agent_task = None
    try:
        agent_proc = await start_agent_process(sandbox, project)

        async def pump_agent() -> None:
            # Each stdout line is a JSON {"type":"agent_event",...} frame;
            # publish it (parsed) through the same fanout path.
            try:
                async for line in agent_proc.stdout():
                    if not line:
                        continue
                    try:
                        await publish(json.loads(line))
                    except json.JSONDecodeError:
                        continue
            except Exception:
                pass

        agent_task = asyncio.create_task(pump_agent())
        await publish({"type": "status", "state": "chat_ready"})
    except Exception as exc:
        await publish({"type": "status", "state": "chat_error", "message": str(exc)})

    # ── receive loop: forward chat to the agent over stdin ───────
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") in ("user_msg", "interrupt") and agent_proc is not None:
                try:
                    await agent_proc.write_stdin(raw + "\n")
                except Exception:
                    await publish({"type": "status", "state": "chat_error",
                                   "message": "agent connection lost"})
    except WebSocketDisconnect:
        pass
    finally:
        websocket.app.state.active_sessions.discard(session_id)
        if isinstance(realtime, LocalWsRealtime):
            realtime.detach(session_id, websocket)
        stop_watch()
        pump_task.cancel()
        if agent_task is not None:
            agent_task.cancel()
        if agent_proc is not None:
            try:
                await agent_proc.kill()
            except Exception:
                pass
