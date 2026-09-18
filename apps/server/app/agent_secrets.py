"""Per-connect agent secrets — the SOLE channel carrying credentials into a
sandbox.

The Anthropic API key no longer enters the sandbox at all. Instead, this module
writes a per-sandbox **proxy token** into the secrets file. The sandbox uses the
token as its ``ANTHROPIC_API_KEY``; the credential proxy on the control plane
(``anthropic_proxy.py``) validates the token and injects the real key before
forwarding to ``api.anthropic.com``. A compromised sandbox can use the proxy
(which can be rate-limited and revoked) but never learns the real key.

The proxy token is HMAC-derived from the sandbox_id (same pattern as
``ws_token.sandbox_secret``), so it is stable across connects — a reconnect to
the same sandbox gets the same token, which means the SDK client does not need
to be rebuilt on reconnect.

The reader is ``app/agent/real_agent.py`` (``current_api_key()``), which prefers
this file and falls back to the env var when it is absent.
"""
from __future__ import annotations

import json

from .anthropic_proxy import proxy_token
from .sandbox.base import SECRETS_PATH


def secrets_bytes(proxy_token_value: str | None) -> bytes:
    """Serialize the secrets document the in-sandbox agent reads.

    A missing token writes ``{}`` rather than a null: the reader treats absent
    and empty alike (it falls back to env), and this keeps the file's shape
    stable.
    """
    payload: dict[str, str] = {}
    if proxy_token_value:
        payload["anthropic_api_key"] = proxy_token_value
    return json.dumps(payload, indent=2).encode()


async def write_secrets(sandbox) -> None:
    """Write the current proxy token into ``sandbox`` at SECRETS_PATH.

    Call on every path that is about to run a turn — session create and each
    reconnect. The token is derived from the sandbox_id, so it is stable —
    repeated writes are idempotent.
    """
    token = proxy_token(sandbox.id)
    await sandbox.write_file(SECRETS_PATH, secrets_bytes(token))
