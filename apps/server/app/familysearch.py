"""Per-user FamilySearch OAuth (web redirect) + token injection into the
sandbox (spec §5.2, option a: the control plane writes
{HOME}/.familysearch-mcp/tokens.json inside the sandbox, which the existing MCP
server reads + self-refreshes unchanged).

The web flow reuses the **desktop MCP's** FamilySearch registration: the same
public+PKCE `clientId` (from the bundled config) and the same registered redirect
`http://127.0.0.1:1837/callback`. That forces the local server onto
`127.0.0.1:1837` and the callback onto a top-level `/callback` (its own router,
no `/familysearch` prefix). See docs/plan/web-oauth-plan.md.

A **dev-connect** writes a mock token so the connect/status UX works offline; it
is disabled once a real FamilySearch client is configured.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel
from sqlmodel import Session

from .auth import cookie_secure, get_current_user
from .config import get_settings
from .db import get_session
from .models import User
from .sandbox import SandboxProvider
from .sandbox.base import HOME_DIR
from .sessions import _owned, get_provider

router = APIRouter(prefix="/familysearch", tags=["familysearch"])
# The FS callback reuses the desktop registration → it lives at a TOP-LEVEL
# /callback, not /familysearch/callback. Separate, no-prefix router.
callback_router = APIRouter()

TOKENS_PATH = f"{HOME_DIR}/.familysearch-mcp/tokens.json"

# FamilySearch OAuth endpoints (match mcp-server/src/auth/config.ts:7-10).
FS_AUTHORIZE_URL = "https://ident.familysearch.org/cis-web/oauth2/v3/authorization"
FS_TOKEN_URL = "https://ident.familysearch.org/cis-web/oauth2/v3/token"
FS_OAUTH_COOKIE = "fs_oauth"  # short-lived signed cookie: {sessionId, verifier, state}


def _fs_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret, salt="fs-oauth")


def _pkce() -> tuple[str, str]:
    """(verifier, S256 challenge), both base64url, no padding."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


class StatusOut(BaseModel):
    connected: bool
    mock: bool
    real: bool  # True when real FS web OAuth is configured (UI shows the popup button)


@router.get("/status", response_model=StatusOut)
async def status(
    sessionId: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> StatusOut:
    project = _owned(session, user, sessionId)
    sandbox = await provider.get(project.sandbox_id)
    raw = await sandbox.read_file(TOKENS_PATH)
    connected = raw is not None
    mock = False
    if connected:
        try:
            mock = bool(json.loads(raw.decode()).get("mock"))
        except json.JSONDecodeError:
            connected = False
    return StatusOut(connected=connected, mock=mock, real=get_settings().familysearch_configured)


@router.post("/dev-connect", response_model=StatusOut)
async def dev_connect(
    sessionId: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> StatusOut:
    """Write a mock FamilySearch token into the sandbox. Disabled once a real
    FamilySearch client is configured (then /login is the only path)."""
    if get_settings().familysearch_configured:
        raise HTTPException(status_code=403, detail="Use real FamilySearch sign-in")
    project = _owned(session, user, sessionId)
    sandbox = await provider.resume(project.sandbox_id)
    token = {
        "accessToken": "mock-fs-access-token",
        "refreshToken": "mock-fs-refresh-token",
        "expiresAt": int((time.time() + 3600) * 1000),
        "mock": True,
    }
    await sandbox.write_file(TOKENS_PATH, json.dumps(token, indent=2).encode())
    return StatusOut(connected=True, mock=True, real=False)


@router.get("/login")
async def login(
    sessionId: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> RedirectResponse:
    """Start the FamilySearch OAuth round-trip (runs in a popup, §C3). Redirects
    the popup to FS with PKCE; the verifier + sessionId + state are stashed in a
    short-lived signed cookie for the callback (survives --reload, no in-process
    state)."""
    s = get_settings()
    if not s.familysearch_configured:
        raise HTTPException(
            status_code=501,
            detail=(
                "FamilySearch web OAuth not configured. Set FAMILYSEARCH_WEB_ENABLED=true "
                "(the client id comes from the bundled mcp-server/config/familysearch.json). "
                "Until then use dev-connect (mock)."
            ),
        )
    _owned(session, user, sessionId)  # ownership: only connect FS for your own session
    verifier, challenge = _pkce()
    state = secrets.token_urlsafe(16)
    params = urlencode({
        "response_type": "code",
        "client_id": s.familysearch_client_id,
        "redirect_uri": f"{s.public_url}/callback",
        "scope": "offline_access",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    resp = RedirectResponse(f"{FS_AUTHORIZE_URL}?{params}")
    signed = _fs_serializer().dumps({"sessionId": sessionId, "verifier": verifier, "state": state})
    resp.set_cookie(
        FS_OAUTH_COOKIE, signed, max_age=600, httponly=True,
        samesite="lax", secure=cookie_secure(), path="/",
    )
    return resp


@callback_router.get("/callback")
async def fs_callback(
    code: str | None = None,
    state: str | None = None,
    fs_oauth: str | None = Cookie(default=None),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> HTMLResponse:
    """FamilySearch redirect target (reuses the desktop registration). Exchanges
    the code for tokens, writes them into the user's sandbox in the engine's
    expected shape, and returns a self-closing popup page."""
    if not fs_oauth:
        return HTMLResponse("Missing OAuth state — close this window and retry.", status_code=400)
    try:
        data = _fs_serializer().loads(fs_oauth, max_age=600)
    except BadSignature:
        return HTMLResponse("Invalid OAuth state — close this window and retry.", status_code=400)
    if not code or not state or state != data.get("state"):
        return HTMLResponse("OAuth state mismatch — close this window and retry.", status_code=400)

    project = _owned(session, user, data["sessionId"])
    s = get_settings()
    async with httpx.AsyncClient(timeout=30) as client:
        tok_resp = await client.post(
            FS_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": s.familysearch_client_id,
                "code_verifier": data["verifier"],
                "redirect_uri": f"{s.public_url}/callback",
            },
            headers={"Accept": "application/json"},  # ident token endpoint: no browser UA needed
        )
    if tok_resp.status_code != 200:
        return HTMLResponse("FamilySearch authorization failed — close this window and retry.", status_code=502)
    r = tok_resp.json()
    token = {
        "accessToken": r["access_token"],
        "refreshToken": r.get("refresh_token"),  # offline_access returns one; .get avoids a 500
        "expiresAt": int((time.time() + r.get("expires_in", 3600)) * 1000),  # epoch ms, absolute
    }   # no "mock" key → /status reports mock=false
    sandbox = await provider.resume(project.sandbox_id)
    await sandbox.write_file(TOKENS_PATH, json.dumps(token, indent=2).encode())

    out = HTMLResponse(
        "<!doctype html><script>try{window.opener&&window.opener.postMessage('fs-connected','*')}"
        "catch(e){}window.close()</script>FamilySearch connected — you can close this window."
    )
    out.delete_cookie(FS_OAUTH_COOKIE, path="/")
    return out
