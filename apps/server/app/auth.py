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

import hmac
import html
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, Security
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
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


def _persist_fs_token(session: Session, user_id: str, token_json: dict) -> FamilySearchToken:
    """Upsert the user's control-plane copy of the FS token (the source the
    sandbox injection reads). Refresh token is kept across refreshes when
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
    session.refresh(row)
    return row


# Refresh when the access token has less than this left. The in-sandbox MCP
# self-refreshes too, so anything comfortably live can be injected as-is; this
# only has to cover the gap until the sandbox takes over.
_FS_REFRESH_MARGIN = timedelta(minutes=10)


async def fresh_fs_token(session: Session, user_id: str) -> FamilySearchToken | None:
    """The user's FamilySearch token, refreshed if it is at/near expiry.

    Returns None when there is nothing usable — no stored grant, no refresh
    token, or FamilySearch refused the refresh. That is **not** an error: FS
    caps a grant at 8h idle / 24h absolute, so every user's grant dies daily and
    the only cure is another front-door round-trip. Callers surface that to the
    UI (`familysearch: "expired"`) rather than failing the request — a dead FS
    grant must not stop someone reading their existing research.
    """
    row = session.get(FamilySearchToken, user_id)
    if row is None:
        return None
    expires_at = row.expires_at
    if expires_at.tzinfo is None:  # SQLite hands back naive datetimes
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at - _FS_REFRESH_MARGIN > datetime.now(timezone.utc):
        return row
    if not row.refresh_token:
        return None
    token_json = await fs_oauth.refresh_tokens(row.refresh_token)
    if token_json is None:
        return None
    return _persist_fs_token(session, user_id, token_json)


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


# ── Public /v1 bearer-key auth ───────────────────────────────────
_bearer = HTTPBearer(auto_error=False)


def get_api_client(
    creds: HTTPAuthorizationCredentials | None = Security(_bearer),
    session: Session = Depends(get_session),
) -> User:
    """Bearer-key dependency for the public /v1 surface. Resolves the presented
    key to its configured email (constant-time) and returns the SAME User row
    the browser path would create for that email.

    Authz note (deliberate): unlike the browser login path, this does NOT gate on
    the Gmail allowlist. API keys are operator-granted (set in `api_keys` env), so
    presence in api_key_map IS the grant; the allowlist governs self-service login
    only. A key can therefore mint a User for an email the allowlist would reject.
    """
    if creds is None or (creds.scheme or "").lower() != "bearer" or not creds.credentials:
        raise HTTPException(
            status_code=401, detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    email: str | None = None
    for key, mapped in get_settings().api_key_map.items():
        if hmac.compare_digest(key, creds.credentials):
            email = mapped
            break
    if email is None:
        raise HTTPException(
            status_code=401, detail="Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _upsert_user(session, email)


# ── endpoints ────────────────────────────────────────────────────
class DevLoginBody(BaseModel):
    email: str = ""  # optional in dev-login: blank → a default local identity


class MeResponse(BaseModel):
    id: str
    email: str


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(id=user.id, email=user.email)


def _dev_login_enabled(s) -> bool:
    """Dev-login is a LOCAL convenience only: offered when real FamilySearch OAuth
    isn't configured AND we're not on a deployed (https) host. The https guard is a
    backstop so a deploy that forgot to configure FamilySearch can't expose an
    allowlist-free, open-signup endpoint — dev-login is never deployed (see
    DEVELOPMENT.md)."""
    return not s.familysearch_configured and not s.public_url.startswith("https")


@router.get("/config")
def auth_config() -> dict:
    """Tells the client which login methods are available. FamilySearch is the
    front door when configured; dev-login is the local-only fallback (the two are
    never both available on a deployed host — see _dev_login_enabled)."""
    s = get_settings()
    return {"familysearch": s.familysearch_configured, "devLogin": _dev_login_enabled(s)}


@router.post("/dev-login", response_model=MeResponse)
def dev_login(
    body: DevLoginBody, response: Response, session: Session = Depends(get_session)
) -> MeResponse:
    if not _dev_login_enabled(get_settings()):
        raise HTTPException(status_code=403, detail="Dev-login disabled; sign in with FamilySearch")
    # No allowlist locally — any email signs in, so you can simulate distinct users
    # (per-user session lists, ownership, /v1 cross-client isolation). The prod
    # access gate is the FamilySearch callback's allowlist, which is unaffected. A
    # blank email gets a default identity for one-click sign-in.
    email = body.email.strip().lower() or "dev@localhost"
    user = _upsert_user(session, email)
    set_session_cookie(response, user.id)
    return MeResponse(id=user.id, email=user.email)


@router.post("/logout")
def logout(response: Response) -> dict:
    clear_session_cookie(response)
    return {"ok": True}


# ── FamilySearch app login (active only when configured) ─────────
# Where the callback may send the user afterwards. Deliberately only a hash
# route of our own SPA (`#/s/prj_…`) — the value rides a cookie the user
# controls, so anything else would be an open redirect.
_SAFE_NEXT_RE = re.compile(r"^#/[A-Za-z0-9/_-]{0,120}$")


@router.get("/familysearch/login")
def familysearch_login(next: str | None = None) -> RedirectResponse:
    """Start the FamilySearch OAuth round-trip (a full-page redirect).

    `next` is an optional SPA hash route to return to. The front-door login has
    none (it precedes any sandbox), but the *re-connect* path does: FS caps a
    grant at 24h absolute, so a user mid-research gets bounced through here
    daily and must land back on the session they were reading, not the list.
    It rides the same short-lived signed cookie as the PKCE verifier + state,
    which the top-level /callback reads back."""
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
    payload = {"verifier": verifier, "state": state}
    if next and _SAFE_NEXT_RE.match(next):
        payload["next"] = next
    signed = fs_oauth.fs_serializer().dumps(payload)
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
    if not email:
        return HTMLResponse(
            "Your FamilySearch account did not return an email address, so we "
            "can't check it against the allowlist. Please contact the administrator.",
            status_code=403,
        )
    if not _is_allowed(session, email):
        safe_email = html.escape(email)
        return HTMLResponse(
            f"The FamilySearch account <strong>{safe_email}</strong> is not on the "
            "allowlist. Ask the administrator to add this exact email address, then "
            "try signing in again.",
            status_code=403,
        )

    user = _upsert_user(session, email, familysearch_id=identity.get("id"))
    _persist_fs_token(session, user.id, token_json)

    # Re-validate `next` on the way out: it came back on a client-held cookie,
    # so trusting the inbound check alone would let a tampered value through.
    nxt = data.get("next")
    target = get_settings().web_origin
    if isinstance(nxt, str) and _SAFE_NEXT_RE.match(nxt):
        target = f"{target}/{nxt}" if not target.endswith("/") else f"{target}{nxt}"

    # Build the redirect FIRST, then set the cookie on it (set_session_cookie
    # mutates the passed response; a Depends-injected one would be lost here).
    resp = RedirectResponse(target)
    set_session_cookie(resp, user.id)
    resp.delete_cookie(fs_oauth.FS_OAUTH_COOKIE, path="/")
    return resp
