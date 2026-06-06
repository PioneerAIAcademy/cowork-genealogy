"""Realtime fanout seam (see docs/plan/ably-realtime-migration.md §3).

The control plane publishes outbound frames (viewer deltas + agent_event +
status/error) to a per-session "channel"; mint_token() returns what a browser
needs to subscribe to exactly that session. Config-selected like SandboxProvider.
The frame dicts are identical to what the WS relay sends today — only the wire
changes, so the viewer-ui transport contract is untouched.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class RealtimeToken:
    """What the browser needs to subscribe. Fields are the union the client
    cares about; unused ones are None."""

    backend: str  # "local_ws" | "ably" | "ably_mock"
    channel: str  # e.g. "session:prj_abc123"
    token: str | None = None  # Ably token request (None for local_ws)
    ttl_seconds: int | None = None

    def to_dict(self) -> dict:
        return {
            "backend": self.backend,
            "channel": self.channel,
            "token": self.token,
            "ttlSeconds": self.ttl_seconds,
        }


class Realtime(ABC):
    """Outbound fanout for one control plane."""

    @abstractmethod
    async def publish(self, session_id: str, message: dict) -> None:
        """Send a frame to all subscribers of a session."""
        ...

    @abstractmethod
    async def mint_token(self, session_id: str) -> RealtimeToken:
        """What a browser needs to subscribe to this session's channel only."""
        ...

    async def aclose(self) -> None:  # symmetry with SandboxProvider.aclose
        return None


def channel_for(session_id: str) -> str:
    # project_id is already an unguessable prj_+16hex; the capability token (not
    # the name) is the security boundary.
    return f"session:{session_id}"
