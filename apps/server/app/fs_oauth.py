"""Shared FamilySearch OAuth primitives for the unified app login.

Lifted from the former per-session ``familysearch.py``. FamilySearch is now the
**single front door**: one OAuth round-trip at app login both gates access (via
the email allowlist) and yields the data token injected into every sandbox the
user creates. The in-VM MCP server cannot run an interactive ``login`` itself, so
the control plane must guarantee a token is present before any session — that is
the reason this moved ahead of session creation. See
docs/plan/familysearch-login-plan.md.

The web flow reuses the **desktop MCP's** FamilySearch registration: the same
public+PKCE ``clientId`` (from the bundled config) and the same registered
redirect ``http://127.0.0.1:1837/callback``. That forces the local server onto
``127.0.0.1:1837`` and the callback onto a TOP-LEVEL ``/callback``.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from itsdangerous import URLSafeTimedSerializer

from .config import get_settings
from .sandbox.base import HOME_DIR

# FamilySearch OAuth endpoints (match packages/engine/mcp-server/src/auth/config.ts:7-10).
FS_AUTHORIZE_URL = "https://ident.familysearch.org/cis-web/oauth2/v3/authorization"
FS_TOKEN_URL = "https://ident.familysearch.org/cis-web/oauth2/v3/token"
FS_CURRENT_USER_URL = "https://api.familysearch.org/platform/users/current"
FS_ACCEPT = "application/x-fs-v1+json"
# api.familysearch.org sits behind Imperva, which 403s non-browser UAs. Mirrors
# packages/engine/mcp-server/src/constants.ts BROWSER_USER_AGENT. (The ident
# token endpoint does NOT need it; the platform /users/current call does.)
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)

# Short-lived signed cookie carrying {verifier, state} across the redirect.
FS_OAUTH_COOKIE = "fs_oauth"
# Where the engine's MCP server reads the token inside the sandbox FS.
TOKENS_PATH = f"{HOME_DIR}/.familysearch-mcp/tokens.json"
# Where it reads per-user config (OpenRouter key, wiki URL, …) inside the sandbox.
CONFIG_PATH = f"{HOME_DIR}/.familysearch-mcp/config.json"


def fs_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret, salt="fs-oauth")


def pkce() -> tuple[str, str]:
    """(verifier, S256 challenge), both base64url, no padding."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def redirect_uri() -> str:
    """The registered FS redirect — top-level /callback on the public URL."""
    return f"{get_settings().public_url}/callback"


async def exchange_code_for_tokens(code: str, verifier: str) -> dict | None:
    """Exchange an authorization code + PKCE verifier for FS tokens. Returns the
    raw token JSON (``access_token``, ``refresh_token``, ``expires_in``), or None
    on any non-200 (caller maps that to a user-facing error)."""
    s = get_settings()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            FS_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": s.familysearch_client_id,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri(),
            },
            headers={"Accept": "application/json"},  # ident endpoint: no browser UA
        )
    if resp.status_code != 200:
        return None
    return resp.json()


async def fetch_identity(access_token: str) -> dict | None:
    """GET /platform/users/current → ``users[0]`` (id, email, personId, ...), or
    None on failure. Sends the browser UA (Imperva 403s otherwise). Read ONLY the
    email + id from the result — the endpoint also returns account PII
    (helperAccessPin, birthDate, mobilePhoneNumber)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            FS_CURRENT_USER_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": FS_ACCEPT,
                "User-Agent": BROWSER_USER_AGENT,
            },
        )
    if resp.status_code != 200:
        return None
    users = resp.json().get("users") or []
    return users[0] if users else None


def expires_at_from(token_json: dict) -> datetime:
    """Absolute UTC expiry from a token response's ``expires_in`` (seconds)."""
    seconds = int(token_json.get("expires_in", 3600))
    return datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=seconds)


def tokens_file_bytes(
    access_token: str, refresh_token: str | None, expires_at: datetime
) -> bytes:
    """Serialize the engine-shaped tokens.json the in-sandbox MCP self-refreshes
    from: ``{accessToken, refreshToken, expiresAt}`` with ``expiresAt`` an
    absolute epoch-**ms** (matches getValidToken's isExpired in
    packages/engine/mcp-server/src/auth/refresh.ts)."""
    # DB datetimes can come back naive (SQLite); treat naive as UTC so the epoch
    # is correct rather than shifted by the local tz offset.
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    payload = {
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "expiresAt": int(expires_at.timestamp() * 1000),
    }
    return json.dumps(payload, indent=2).encode()


async def write_tokens(
    sandbox, access_token: str, refresh_token: str | None, expires_at: datetime
) -> None:
    """Inject the FamilySearch token into a sandbox at TOKENS_PATH."""
    await sandbox.write_file(
        TOKENS_PATH, tokens_file_bytes(access_token, refresh_token, expires_at)
    )


async def write_config(sandbox, config: dict) -> None:
    """Inject per-user MCP config (~/.familysearch-mcp/config.json) into a
    sandbox at CONFIG_PATH — the file channel the engine reads config-only for
    the OpenRouter key (image-transcribe-tool-spec.md §6.5), the wiki URL, etc.
    Sibling of write_tokens: the control plane owns provisioning this file, the
    same way it provisions tokens.json. Writes the whole document (it is the
    only writer today)."""
    await sandbox.write_file(CONFIG_PATH, json.dumps(config, indent=2).encode())
