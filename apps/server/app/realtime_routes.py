"""Realtime token endpoint (Phase 2). Mints a per-session, subscribe-only
capability token for the browser. The ownership check IS the security boundary —
the Ably root key never leaves the server. For local_ws the minted token just
reports backend="local_ws" and the client uses the WS path instead.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlmodel import Session

from .auth import get_current_user
from .db import get_session
from .models import User
from .sessions import _owned

router = APIRouter(prefix="/api/realtime", tags=["realtime"])


def get_realtime(request: Request):
    return request.app.state.realtime


@router.get("/token")
async def realtime_token(
    sessionId: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    realtime=Depends(get_realtime),
) -> dict:
    _owned(session, user, sessionId)  # 404 if not owned; the security boundary
    tok = await realtime.mint_token(sessionId)
    return tok.to_dict()
