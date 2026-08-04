"""Per-sandbox WS handshake tokens (realtime re-architecture).

The control plane derives a per-sandbox secret = HMAC(ws_signing_key, sandbox_id),
injects it into the sandbox as WS_TOKEN_SECRET (E2BProvider.create), and mints
short-lived handshake tokens with it (sessions./connect). The in-sandbox WS
server (sandbox_server.verify_token) verifies with that same secret.

Token format (must match sandbox_server.verify_token): '<exp>.<hex hmac-sha256(secret, exp)>'.
A compromised sandbox leaks only its OWN derived secret → can forge a token only
for itself, never another session.

Rotating ``ws_signing_key`` orphans every EXISTING sandbox. ``E2BProvider.create``
bakes ``sandbox_secret(sandbox_id)`` into the in-sandbox WS server's process env
(``sandbox/e2b.py``), and that server is deliberately never restarted across
pause/resume — so after a rotation the control plane mints against the new key
while the sandbox verifies against the old one, and every handshake fails
`bad/expired token` with no recovery but a new session. It cannot use the
decision-#2 secrets *file* (``agent_secrets.py``, the channel PR #762 gave the
Anthropic key): the WS server reads its secret once at boot, not per turn. The
fix is either a restart-on-connect when the derived secret has changed, or a
key-id in the token so the sandbox can verify against the key that minted it.
Not urgent — rotation is rare, and the alpha hang was TTL expiry (below), not
rotation. Tracked in issue #1124.
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
