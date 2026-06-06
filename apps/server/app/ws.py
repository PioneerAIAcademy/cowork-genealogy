"""The browser WebSocket — the local_ws realtime backend.

Phase 2 of the Ably migration: the watch + agent pump now live in an app-owned
LiveSession (live_session.py); this endpoint just (a) attaches its socket to
LocalWsRealtime so realtime.publish() fans out to it, (b) ensures the session is
live, (c) forwards inbound chat to the agent's stdin, and (d) disposes the
session when the last socket detaches. The Ably backend reaches the same
LiveSession via REST endpoints instead (sessions.py).
"""
from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlmodel import Session

from .auth import COOKIE_NAME, decode_session_token
from .db import get_engine
from .models import Project, utcnow
from .realtime import LocalWsRealtime

router = APIRouter()


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
        project.last_active = utcnow()  # keep active sessions out of idle-suspend
        db.add(project)
        db.commit()
        db.refresh(project)

    await websocket.accept()
    realtime = websocket.app.state.realtime
    manager = websocket.app.state.session_manager

    # Register this socket as a subscriber so realtime.publish() fans out to it,
    # THEN ensure the session is live (so its snapshot/chat_ready reach us).
    if isinstance(realtime, LocalWsRealtime):
        realtime.attach(session_id, websocket)

    live = await manager.ensure(session_id, project)

    # ── receive loop: forward chat to the agent over stdin ───────
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") in ("user_msg", "interrupt"):
                await live.send_input(raw)
    except WebSocketDisconnect:
        pass
    finally:
        if isinstance(realtime, LocalWsRealtime):
            realtime.detach(session_id, websocket)
        # Last socket gone → tear down the live session (matches the prior
        # behavior where disconnect killed the agent). Ably sessions, which have
        # no local socket, are disposed by the idle-suspend loop instead.
        if not realtime.has_local_subscribers(session_id):
            await manager.dispose(session_id)
