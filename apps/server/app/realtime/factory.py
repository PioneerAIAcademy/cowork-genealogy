"""Config-selected realtime backend (mirrors sandbox.make_provider)."""
from __future__ import annotations

from ..config import get_settings
from .base import Realtime
from .local_ws import LocalWsRealtime


def make_realtime() -> Realtime:
    s = get_settings()
    if s.realtime == "ably":
        if not s.ably_api_key:
            raise RuntimeError("REALTIME=ably requires ABLY_API_KEY")
        from .ably import AblyRealtime

        return AblyRealtime(s.ably_api_key)
    if s.realtime == "ably_mock":
        from .mock import MockRealtime

        return MockRealtime()
    return LocalWsRealtime()
