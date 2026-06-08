"""Unified FamilySearch app login, POC posture.

FamilySearch is the **single front door**. One OAuth round-trip at login both
(a) gates app access via the email allowlist and (b) persists the data token that
every sandbox-create injects (see sessions.create_session + fs_oauth.py). There
is no separate Google sign-in and no per-session "Connect FamilySearch" step.

When real FS OAuth is unconfigured (FAMILYSEARCH_WEB_ENABLED off), a **dev-login**
(enter an allowlisted email, no round-trip) stands in so the POC runs with zero
OAuth setup; the agent then runs in mock mode and no FS token is needed. Either
path issues the same signed session cookie.
"""
from __future__ import annotations

import secrets
import uuid
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel
from sqlmodel import Session, select

from . import fs_oauth
from .config import get_settings
from .db import get_session
from .models import AllowedEmail, FamilySearchToken, User, utcnow

COOKIE_NAME = "wb_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days

router = APIRouter(prefix="/auth", tags=["auth"])
# The FS callback reuses the desktop registration → it lives at a TOP-LEVEL
# /callback (the registered redirect), not /auth/callback. Separate, no-prefix
# router wired alongside `router` in main.py.
callback_router = APIRouter()


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret, salt="wb-session")


def cookie_secure() -> bool:
    """Session-cookie `secure` flag: explicit config wins, else derive from the
    public_url scheme (so local http works; hosted https sets it)."""
    s = get_settings()
    if s.session_cookie_secure is not None:
        return s.session_cookie_secure
    return s.public_url.startswith("https")


def set_session_cookie(response: Response, user_id: str) -> None:
    token = _serializer().dumps({"uid": user_id})
    response.set_cookie(
        COOKIE_NAME, token, max_age=COOKIE_MAX_AGE, httponly=True,
        samesite="lax", secure=cookie_secure(), path="/",
    )


def clear_session_cookie(response: Response) -> None:
    # Mirror the set attributes so strict browsers actually clear it.
    response.delete_cookie(COOKIE_NAME, path="/", samesite="lax", secure=cookie_secure())


def _is_allowed(session: Session, email: str) -> bool:
    return session.get(AllowedEmail, email.lower()) is not None


def _upsert_user(session: Session, email: str, familysearch_id: str | None = None) -> User:
    email = email.lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if user is None:
        user = User(id="usr_" + uuid.uuid4().hex[:16], email=email, familysearch_id=familysearch_id)
        session.add(user)
        session.commit()
        session.refresh(user)
    elif familysearch_id and not user.familysearch_id:
        user.familysearch_id = familysearch_id
        session.add(user)
        session.commit()
        session.refresh(user)
    return user


def _persist_fs_token(session: Session, user_id: str, token_json: dict) -> None:
    """Upsert the user's control-plane copy of the FS token (the source the
    sandbox-create injection reads). Refresh token is kept across refreshes when
    a new response omits it."""
    expires_at = fs_oauth.expires_at_from(token_json)
    row = session.get(FamilySearchToken, user_id)
    if row is None:
        row = FamilySearchToken(
            user_id=user_id,
            access_token=token_json["access_token"],
            refresh_token=token_json.get("refresh_token"),
            expires_at=expires_at,
        )
    else:
        row.access_token = token_json["access_token"]
        if token_json.get("refresh_token"):
            row.refresh_token = token_json["refresh_token"]
        row.expires_at = expires_at
        row.updated = utcnow()
    session.add(row)
    session.commit()


def decode_session_token(token: str | None) -> str | None:
    """Return the user_id encoded in a session cookie, or None. Used by the
    WebSocket handler, which cannot use the HTTP Depends machinery."""
    if not token:
        return None
    try:
        data = _serializer().loads(token, max_age=COOKIE_MAX_AGE)
    except BadSignature:
        return None
    return data.get("uid")


def get_current_user(
    request: Request, session: Session = Depends(get_session)
) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        data = _serializer().loads(token, max_age=COOKIE_MAX_AGE)
    except BadSignature:
        raise HTTPException(status_code=401, detail="Invalid session")
    user = session.get(User, data.get("uid"))
    if user is None:
        raise HTTPException(status_code=401, detail="Unknown user")
    return user


# ── endpoints ────────────────────────────────────────────────────
class DevLoginBody(BaseModel):
    email: str


class MeResponse(BaseModel):
    id: str
    email: str


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(id=user.id, email=user.email)


@router.get("/config")
def auth_config() -> dict:
    """Tells the client which login methods are available. When real FS OAuth is
    configured it is the only path; otherwise the dev-login form is offered."""
    configured = get_settings().familysearch_configured
    return {"familysearch": configured, "devLogin": not configured}


@router.post("/dev-login", response_model=MeResponse)
def dev_login(
    body: DevLoginBody, response: Response, session: Session = Depends(get_session)
) -> MeResponse:
    if get_settings().familysearch_configured:
        raise HTTPException(status_code=403, detail="Dev-login disabled; sign in with FamilySearch")
    email = body.email.strip().lower()
    if not _is_allowed(session, email):
        raise HTTPException(status_code=403, detail="Email not on the allowlist")
    user = _upsert_user(session, email)
    set_session_cookie(response, user.id)
    return MeResponse(id=user.id, email=user.email)


@router.post("/logout")
def logout(response: Response) -> dict:
    clear_session_cookie(response)
    return {"ok": True}


# ── FamilySearch app login (active only when configured) ─────────
@router.get("/familysearch/login")
def familysearch_login() -> RedirectResponse:
    """Start the FamilySearch OAuth round-trip (a full-page redirect — login
    precedes any sandbox, so there is no live session/WS to preserve and no
    sessionId to carry). PKCE verifier + state are stashed in a short-lived
    signed cookie that the top-level /callback reads back."""
    s = get_settings()
    if not s.familysearch_configured:
        raise HTTPException(
            status_code=501,
            detail=(
                "FamilySearch web OAuth not configured. Set FAMILYSEARCH_WEB_ENABLED=true "
                "(the client id comes from the bundled packages/engine/mcp-server/config/familysearch.json). "
                "Until then use dev-login."
            ),
        )
    verifier, challenge = fs_oauth.pkce()
    state = secrets.token_urlsafe(16)
    params = urlencode({
        "response_type": "code",
        "client_id": s.familysearch_client_id,
        "redirect_uri": fs_oauth.redirect_uri(),
        "scope": "offline_access",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    resp = RedirectResponse(f"{fs_oauth.FS_AUTHORIZE_URL}?{params}")
    signed = fs_oauth.fs_serializer().dumps({"verifier": verifier, "state": state})
    resp.set_cookie(
        fs_oauth.FS_OAUTH_COOKIE, signed, max_age=600, httponly=True,
        samesite="lax", secure=cookie_secure(), path="/",
    )
    return resp


@callback_router.get("/callback")
async def familysearch_callback(
    code: str | None = None,
    state: str | None = None,
    fs_oauth_cookie: str | None = Cookie(default=None, alias=fs_oauth.FS_OAUTH_COOKIE),
    session: Session = Depends(get_session),
) -> Response:
    """FamilySearch redirect target (reuses the desktop registration). Exchanges
    the code for tokens, fetches the user's identity to check the allowlist,
    upserts the user + persists the token, sets the session cookie, and redirects
    back to the web app. A non-allowlisted account leaves no user row and no
    persisted token."""
    fail = "FamilySearch sign-in failed — return to the app and try again."
    if not fs_oauth_cookie:
        return HTMLResponse(f"Missing OAuth state. {fail}", status_code=400)
    try:
        data = fs_oauth.fs_serializer().loads(fs_oauth_cookie, max_age=600)
    except BadSignature:
        return HTMLResponse(f"Invalid OAuth state. {fail}", status_code=400)
    if not code or not state or state != data.get("state"):
        return HTMLResponse(f"OAuth state mismatch. {fail}", status_code=400)

    token_json = await fs_oauth.exchange_code_for_tokens(code, data["verifier"])
    if token_json is None or not token_json.get("access_token"):
        return HTMLResponse(f"Token exchange failed. {fail}", status_code=502)

    identity = await fs_oauth.fetch_identity(token_json["access_token"])
    if identity is None:
        return HTMLResponse(f"Could not read your FamilySearch identity. {fail}", status_code=502)
    email = (identity.get("email") or "").strip().lower()
    if not email or not _is_allowed(session, email):
        return HTMLResponse("This FamilySearch account is not on the allowlist.", status_code=403)

    user = _upsert_user(session, email, familysearch_id=identity.get("id"))
    _persist_fs_token(session, user.id, token_json)

    # Build the redirect FIRST, then set the cookie on it (set_session_cookie
    # mutates the passed response; a Depends-injected one would be lost here).
    resp = RedirectResponse(get_settings().web_origin)
    set_session_cookie(resp, user.id)
    resp.delete_cookie(fs_oauth.FS_OAUTH_COOKIE, path="/")
    return resp
