"""AblyRealtime (Option A): the control plane publishes outbound frames to a
per-session Ably channel via the Ably REST client; the browser subscribes with a
short-lived, subscribe-only capability token minted here. The server never opens
a realtime connection (REST publish is enough) and the Ably root key never
leaves the server.

`ably` is imported lazily so it's only required when REALTIME=ably.
SDK call shapes follow the documented ably-python surface — verify against the
installed version (see plan §3 caveat).
"""
from __future__ import annotations

import json

from .base import Realtime, RealtimeToken, channel_for

_SUBSCRIBE_TTL_SECONDS = 60 * 60  # 1h; client re-mints via authUrl on expiry


class AblyRealtime(Realtime):
    def __init__(self, api_key: str) -> None:
        from ably import AblyRest  # lazy: only needed when REALTIME=ably

        self._rest = AblyRest(api_key)

    async def publish(self, session_id: str, message: dict) -> None:
        ch = self._rest.channels.get(channel_for(session_id))
        # name = frame type (so clients may filter by name), data = full frame.
        await ch.publish(message.get("type", "message"), message)

    async def mint_token(self, session_id: str) -> RealtimeToken:
        chan = channel_for(session_id)
        token_request = await self._rest.auth.create_token_request(
            {
                "capability": {chan: ["subscribe"]},  # subscribe-only, this channel only
                "ttl": _SUBSCRIBE_TTL_SECONDS * 1000,
                "client_id": session_id,
            }
        )
        # token_request is a TokenRequest object; serialize to JSON for the
        # browser's Ably client (it accepts a token request string).
        as_dict = token_request.to_dict() if hasattr(token_request, "to_dict") else token_request
        return RealtimeToken(
            backend="ably",
            channel=chan,
            token=json.dumps(as_dict),
            ttl_seconds=_SUBSCRIBE_TTL_SECONDS,
        )

    async def aclose(self) -> None:
        close = getattr(self._rest, "close", None)
        if close:
            result = close()
            if hasattr(result, "__await__"):
                await result
