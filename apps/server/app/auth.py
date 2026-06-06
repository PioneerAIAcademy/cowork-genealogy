"""Two-layer auth, POC posture.

App access (this module): Google OIDC + a Gmail allowlist. Real Google is
scaffolded but optional — when GOOGLE_CLIENT_ID is unset the client offers a
**dev-login** (enter an allowlisted email, no Google round-trip) so the POC runs
with zero OAuth setup. Either path issues the same signed session cookie.

Data access (FamilySearch per-user OAuth) lives in familysearch.py.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel
from sqlmodel import Session, select

from .config import get_settings
from .db import get_session
from .models import AllowedEmail, User

COOKIE_NAME = "wb_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days

router = APIRouter(prefix="/auth", tags=["auth"])


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret, salt="wb-session")


def set_session_cookie(response: Response, user_id: str) -> None:
    token = _serializer().dumps({"uid": user_id})
    secure = get_settings().public_url.startswith("https")
    response.set_cookie(
        COOKIE_NAME, token, max_age=COOKIE_MAX_AGE, httponly=True,
        samesite="lax", secure=secure, path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def _is_allowed(session: Session, email: str) -> bool:
    return session.get(AllowedEmail, email.lower()) is not None


def _upsert_user(session: Session, email: str, google_sub: str | None = None) -> User:
    email = email.lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if user is None:
        user = User(id="usr_" + uuid.uuid4().hex[:16], email=email, google_sub=google_sub)
        session.add(user)
        session.commit()
        session.refresh(user)
    elif google_sub and not user.google_sub:
        user.google_sub = google_sub
        session.add(user)
        session.commit()
        session.refresh(user)
    return user


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
    """Tells the client which login methods are available."""
    s = get_settings()
    return {"google": bool(s.google_client_id), "devLogin": not bool(s.google_client_id)}


@router.post("/dev-login", response_model=MeResponse)
def dev_login(
    body: DevLoginBody, response: Response, session: Session = Depends(get_session)
) -> MeResponse:
    if get_settings().google_client_id:
        raise HTTPException(status_code=403, detail="Dev-login disabled; use Google sign-in")
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


# ── Google OIDC (scaffold; active only when configured) ──────────
@router.get("/google/login")
def google_login() -> dict:
    s = get_settings()
    if not s.google_client_id:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")
    # TODO: build the authorization URL (Authlib) + redirect. Callback verifies
    # the id_token, checks the allowlist, _upsert_user(..., google_sub=sub), and
    # set_session_cookie. The dev-login path covers the POC until then.
    raise HTTPException(status_code=501, detail="Google OAuth not yet wired")
