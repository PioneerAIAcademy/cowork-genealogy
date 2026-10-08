#!/usr/bin/env python3
"""U3 probe: what does FamilySearch's token endpoint answer a refresh it refuses?

The web tier ends a run ``signin_required`` only when FamilySearch REFUSES a refresh
(``grants.classify_response``: 400/401 are ``refused`` with the body's ``error``), and the
repo held only a mocked ``400 invalid_grant``. This POSTs ``grant_type=refresh_token``
once, with a random 64-character refresh token that no FamilySearch session has ever
issued, and the dev client id, then prints the status, the body's ``error`` field and
how ``classify_response`` reads the pair. Read-only: a random token revokes nothing and
belongs to nobody, and no credential is sent or printed. n=1.

    cd apps/server && uv run python dev/probe_fs_refresh_refusal.py

Run it inside the church network: Imperva clears in-network traffic (ident is not behind
it, but the network origin is the gate for the rest of FamilySearch). Exit 0 when the
answer classifies as ``refused``, 1 when it does not (then the classifier changes, not
this probe), 2 when the endpoint could not be reached.

Measured 2026-10-02 (n=1, the dev key, from a developer workstation): ``status=400
error='invalid_grant'`` (``application/json``), which ``classify_response`` reads as
``refused`` / ``invalid_grant``.
"""

from __future__ import annotations

import asyncio
import secrets
import sys
from pathlib import Path

PROTO = Path(__file__).resolve().parents[1] / "proto"
sys.path.insert(0, str(PROTO))

import grants  # noqa: E402
from web import auth  # noqa: E402


async def probe() -> int:
    import httpx

    token = secrets.token_urlsafe(48)[:64]
    try:
        async with asyncio.timeout(grants.REFRESH_HTTP_TIMEOUT_S):
            async with httpx.AsyncClient(timeout=grants.REFRESH_HTTP_TIMEOUT_S) as client:
                resp = await client.post(
                    auth.FS_TOKEN_URL,
                    data={"grant_type": "refresh_token", "refresh_token": token, "client_id": auth.client_id()},
                    headers={"Accept": "application/json"},
                )
    except (TimeoutError, httpx.HTTPError) as exc:
        print(f"unreachable: {type(exc).__name__}")
        return 2
    try:
        body = resp.json()
    except ValueError:
        body = None
    error = body.get("error") if isinstance(body, dict) else None
    result = grants.classify_response(resp.status_code, body)
    print(f"status={resp.status_code} error={error!r} content_type={resp.headers.get('content-type')!r}")
    print(f"classify_response -> kind={result.kind} reason={result.reason}")
    return 0 if result.kind == "refused" else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(probe()))
