"""LocalWsRealtime — the dev/default backend. Owns the per-session set of
connected browser WebSockets and fans out to them (the relay ws.py used to
inline). No Ably account / token needed: the client opens /ws/sessions/{id} as
today and the minted token just reports backend="local_ws".
"""
from __future__ import annotations

import json
from collections import defaultdict

from fastapi import WebSocket

from .base import Realtime, RealtimeToken, channel_for


class LocalWsRealtime(Realtime):
    def __init__(self) -> None:
        self._subs: dict[str, set[WebSocket]] = defaultdict(set)

    def attach(self, session_id: str, ws: WebSocket) -> None:
        self._subs[session_id].add(ws)

    def detach(self, session_id: str, ws: WebSocket) -> None:
        self._subs[session_id].discard(ws)
        if not self._subs[session_id]:
            self._subs.pop(session_id, None)

    async def publish(self, session_id: str, message: dict) -> None:
        payload = json.dumps(message)
        dead: list[WebSocket] = []
        for ws in list(self._subs.get(session_id, ())):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.detach(session_id, ws)

    def has_local_subscribers(self, session_id: str) -> bool:
        return bool(self._subs.get(session_id))

    async def mint_token(self, session_id: str) -> RealtimeToken:
        # No token: the client uses the /ws/sessions/{id} socket directly.
        return RealtimeToken(backend="local_ws", channel=channel_for(session_id))
