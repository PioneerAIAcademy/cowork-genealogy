"""Per-sandbox WS handshake tokens (realtime re-architecture).

The control plane derives a per-sandbox secret = HMAC(ws_signing_key, sandbox_id),
injects it into the sandbox as WS_TOKEN_SECRET (E2BProvider.create), and mints
short-lived handshake tokens with it (sessions./connect). The in-sandbox WS
server (sandbox_server.verify_token) verifies with that same secret.

Token format (must match sandbox_server.verify_token): '<exp>.<hex hmac-sha256(secret, exp)>'.
A compromised sandbox leaks only its OWN derived secret → can forge a token only
for itself, never another session.
"""
from __future__ import annotations

import hashlib
import hmac
import time

from .config import get_settings


def sandbox_secret(sandbox_id: str) -> str:
    key = get_settings().ws_signing_key
    return hmac.new(key.encode(), sandbox_id.encode(), hashlib.sha256).hexdigest()


# The token TTL MUST exceed the sandbox running-timeout (E2BProvider's
# _RUNNING_TIMEOUT_S, 3600s with on_timeout=pause). Both clocks start at the same
# /connect, so when they were equal the pause that forced a reconnect expired the
# token needed to make one — every retry then failed `bad/expired token` forever
# and the UI spun on a turn it could never receive the end of. The client also
# re-mints per reconnect now (makeSessionConnection), which is the real fix; this
# margin keeps the failure non-degenerate if that path ever regresses.
DEFAULT_TTL_SECONDS = 14400  # 4h — comfortably above the 1h sandbox timeout


def mint_token(sandbox_id: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> str:
    secret = sandbox_secret(sandbox_id)
    exp = str(int(time.time()) + ttl_seconds)
    sig = hmac.new(secret.encode(), exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"
