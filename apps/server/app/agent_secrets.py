"""Per-connect agent secrets — the SOLE channel carrying credentials into a
sandbox.

When the credential proxy is active (production, ``proxy_active()``), the
Anthropic API key never enters the sandbox. Instead, this module writes a
per-sandbox **proxy token** into the secrets file. The sandbox uses the token
as its ``ANTHROPIC_API_KEY``; the credential proxy on the control plane
(``anthropic_proxy.py``) validates the token and injects the real key before
forwarding to ``api.anthropic.com``. A compromised sandbox can use the proxy
but never learns the real key. Rate-limiting and revocation are follow-on
work (issue #1018 items 2–3).

When the proxy is NOT active (local dev, ``make server-e2b``), the raw
Anthropic API key is written directly — same as before this module existed.

The proxy token is HMAC-derived from the sandbox_id (same pattern as
``ws_token.sandbox_secret``), so it is stable across connects — a reconnect to
the same sandbox gets the same token, which means the SDK client does not need
to be rebuilt on reconnect.

The reader is ``app/agent/real_agent.py`` (``current_api_key()``), which prefers
this file and falls back to the env var when it is absent.

History: 2026-07-20 alpha outage — a deploy changed the secrets-write path
without gating both halves (env and file) together. Sandboxes created before
the deploy had no file, and ``current_api_key()`` returned None. The entire
alpha fleet was down until a manual backfill. That is why ``write_secrets``
and the provider env must always agree on which credential the sandbox holds.
"""
from __future__ import annotations

import json

from .anthropic_proxy import proxy_active, proxy_token
from .config import get_settings
from .sandbox.base import SECRETS_PATH


def secrets_bytes(credential: str | None, base_url: str | None = None) -> bytes:
    """Serialize the secrets document the in-sandbox agent reads.

    ``credential`` is either a proxy token or the raw API key, depending on
    whether the proxy is active. ``base_url`` is the proxy endpoint URL when
    the proxy is active, absent otherwise. Both travel together so a resumed
    sandbox whose create-time env predates the proxy still routes through it.

    A missing value writes ``{}`` rather than a null: the reader treats absent
    and empty alike (it falls back to env), and this keeps the file's shape
    stable.
    """
    payload: dict[str, str] = {}
    if credential:
        payload["anthropic_api_key"] = credential
    if base_url:
        payload["anthropic_base_url"] = base_url
    return json.dumps(payload, indent=2).encode()


async def write_secrets(sandbox) -> None:
    """Write the current credential into ``sandbox`` at SECRETS_PATH.

    Call on every path that is about to run a turn — session create and each
    reconnect.

    When ``proxy_active()``, writes the HMAC-derived proxy token (stable
    across connects, never the real key). Otherwise writes the raw
    Anthropic API key from the control-plane config.
    """
    if proxy_active():
        credential = proxy_token(sandbox.id)
        base_url = f"{get_settings().public_url}/api/anthropic-proxy"
    else:
        credential = get_settings().anthropic_api_key
        base_url = None
    await sandbox.write_file(SECRETS_PATH, secrets_bytes(credential, base_url))
