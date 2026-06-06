"""MockRealtime — an in-process pub/sub that mimics the Ably backend's contract
without an Ably account. Used by server tests to exercise the publish/fanout +
token flow (and to develop the Option-A server path before ABLY_API_KEY exists).
Records every published frame per session and delivers to registered callbacks.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Awaitable, Callable

from .base import Realtime, RealtimeToken, channel_for

Subscriber = Callable[[dict], Awaitable[None] | None]


class MockRealtime(Realtime):
    def __init__(self) -> None:
        self.published: dict[str, list[dict]] = defaultdict(list)
        self._subs: dict[str, set[Subscriber]] = defaultdict(set)

    def subscribe(self, session_id: str, cb: Subscriber) -> Callable[[], None]:
        self._subs[session_id].add(cb)
        return lambda: self._subs[session_id].discard(cb)

    async def publish(self, session_id: str, message: dict) -> None:
        self.published[session_id].append(message)
        for cb in list(self._subs.get(session_id, ())):
            result = cb(message)
            if hasattr(result, "__await__"):
                await result  # type: ignore[misc]

    async def mint_token(self, session_id: str) -> RealtimeToken:
        return RealtimeToken(
            backend="ably_mock", channel=channel_for(session_id), ttl_seconds=3600
        )
