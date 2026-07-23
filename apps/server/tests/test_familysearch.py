"""Unified FamilySearch app login + token injection at sandbox create.

In the test env FAMILYSEARCH_WEB_ENABLED is false (conftest), so the real FS
front door is gated off and dev-login stands in (the mock-agent path, which needs
no FS token). These cover the /auth/config shape, the gated login route, and the
create-time token injection: a real control-plane token row is written into the
sandbox; with no row, nothing is written (mock mode never reads it).
"""
import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import fs_oauth
from app.auth import fresh_fs_token
from app.config import get_settings
from app.db import get_engine
from app.main import app
from app.models import AllowedEmail, FamilySearchToken, User
from app.sessions import sync_fs_token


def _tokens_path(provider, sandbox_id):
    return provider._root(sandbox_id) / "home" / "user" / ".familysearch-mcp" / "tokens.json"


def test_auth_config_offline_offers_dev_login():
    with TestClient(app) as client:
        cfg = client.get("/auth/config").json()
        assert cfg == {"familysearch": False, "devLogin": True}


def test_familysearch_login_501_when_unconfigured():
    """With FAMILYSEARCH_WEB_ENABLED=false the real front door is gated off so
    dev-login stays the working path."""
    with TestClient(app) as client:
        r = client.get("/auth/familysearch/login", follow_redirects=False)
        assert r.status_code == 501


def test_create_session_injects_real_fs_token():
    with TestClient(app) as client:
        user_id = client.post("/auth/dev-login", json={"email": "tester@example.com"}).json()["id"]
        # Seed a control-plane FS token for the user, as the real callback would.
        with Session(get_engine()) as s:
            s.add(FamilySearchToken(
                user_id=user_id,
                access_token="real-access",
                refresh_token="real-refresh",
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ))
            s.commit()

        sid = client.post("/api/sessions", json={}).json()["id"]
        sandbox_id = client.get(f"/api/sessions/{sid}").json()["sandbox_id"]
        path = _tokens_path(app.state.provider, sandbox_id)
        assert path.is_file(), "tokens.json should be injected at create"

        tok = json.loads(path.read_text(encoding="utf-8"))
        assert tok["accessToken"] == "real-access"
        assert tok["refreshToken"] == "real-refresh"
        assert "mock" not in tok  # real token, not the old dev-connect mock shape
        assert isinstance(tok["expiresAt"], int) and tok["expiresAt"] > 0

        client.delete(f"/api/sessions/{sid}")


def test_create_session_without_token_writes_nothing():
    """Offline/mock path: a dev-login user with no FS token row gets no tokens
    file — mock mode never reads it."""
    with TestClient(app) as client:
        with Session(get_engine()) as s:
            if s.get(AllowedEmail, "notoken@example.com") is None:
                s.add(AllowedEmail(email="notoken@example.com"))
                s.commit()
        assert client.post("/auth/dev-login", json={"email": "notoken@example.com"}).status_code == 200

        sid = client.post("/api/sessions", json={}).json()["id"]
        sandbox_id = client.get(f"/api/sessions/{sid}").json()["sandbox_id"]
        path = _tokens_path(app.state.provider, sandbox_id)
        assert not path.exists(), "no FS token row → no tokens.json injected"

        client.delete(f"/api/sessions/{sid}")


# ── /callback allowlist branching ────────────────────────────────
# The live FS round-trip can't easily exercise the non-allowlisted path, so mock
# the two network calls (token exchange + /users/current) and drive /callback
# directly. auth.py reaches both via the fs_oauth module, so patching the module
# attributes is enough.

def _state_header(state: str) -> dict:
    """An explicit Cookie header carrying a valid signed {verifier, state} — more
    robust than the TestClient cookie jar, which mishandles the dot-less
    `testserver` host."""
    signed = fs_oauth.fs_serializer().dumps({"verifier": "test-verifier", "state": state})
    return {"Cookie": f"{fs_oauth.FS_OAUTH_COOKIE}={signed}"}


async def _fake_exchange(code: str, verifier: str) -> dict:
    return {"access_token": "cb-access", "refresh_token": "cb-refresh", "expires_in": 3600}


def _patch_identity(monkeypatch, *, email: str, fs_id: str) -> None:
    async def _fake_identity(access_token: str) -> dict:
        return {"id": fs_id, "email": email, "personId": "KWZP-CB"}

    monkeypatch.setattr(fs_oauth, "exchange_code_for_tokens", _fake_exchange)
    monkeypatch.setattr(fs_oauth, "fetch_identity", _fake_identity)


def test_callback_allowlisted_creates_user_and_token(monkeypatch):
    email = "callback-ok@example.com"
    with Session(get_engine()) as s:
        if s.get(AllowedEmail, email) is None:
            s.add(AllowedEmail(email=email))
            s.commit()
    _patch_identity(monkeypatch, email=email, fs_id="cis.user.CBOK")

    with TestClient(app) as client:
        r = client.get(
            "/callback?code=abc&state=st-ok", headers=_state_header("st-ok"),
            follow_redirects=False,
        )
        assert r.status_code == 307, r.text
        assert r.headers["location"] == get_settings().web_origin
        assert "wb_session" in r.headers.get("set-cookie", "")

    with Session(get_engine()) as s:
        user = s.exec(select(User).where(User.email == email)).first()
        assert user is not None and user.familysearch_id == "cis.user.CBOK"
        tok = s.get(FamilySearchToken, user.id)
        assert tok is not None and tok.access_token == "cb-access"
        assert tok.refresh_token == "cb-refresh"


def test_callback_non_allowlisted_rejected_leaves_no_state(monkeypatch):
    email = "callback-deny@example.com"  # deliberately NOT seeded into the allowlist
    _patch_identity(monkeypatch, email=email, fs_id="cis.user.CBDENY")

    with TestClient(app) as client:
        r = client.get(
            "/callback?code=abc&state=st-deny", headers=_state_header("st-deny"),
            follow_redirects=False,
        )
        assert r.status_code == 403
        assert "wb_session" not in r.headers.get("set-cookie", "")
        # The rejected email is echoed back so the user can ask to be added.
        assert email in r.text

    with Session(get_engine()) as s:
        assert s.exec(select(User).where(User.email == email)).first() is None


def test_callback_state_mismatch_is_rejected():
    """A forged/mismatched state never reaches token exchange."""
    with TestClient(app) as client:
        r = client.get(
            "/callback?code=abc&state=WRONG", headers=_state_header("real-state"),
            follow_redirects=False,
        )
        assert r.status_code == 400


# ── Re-connect `next` round-trip (session-preserving re-auth) ─────
# The re-auth banner sends the user through /familysearch/login?next=#/s/<id> so
# they land back on the session they were reading, not the list. `next` rides a
# client-held cookie, so the callback MUST re-validate it — an open-redirect hole
# otherwise.

def _state_header_with_next(state: str, next_val: str) -> dict:
    signed = fs_oauth.fs_serializer().dumps(
        {"verifier": "test-verifier", "state": state, "next": next_val}
    )
    return {"Cookie": f"{fs_oauth.FS_OAUTH_COOKIE}={signed}"}


def test_callback_honours_safe_next(monkeypatch):
    email = "callback-next@example.com"
    with Session(get_engine()) as s:
        if s.get(AllowedEmail, email) is None:
            s.add(AllowedEmail(email=email))
            s.commit()
    _patch_identity(monkeypatch, email=email, fs_id="cis.user.NEXT")

    with TestClient(app) as client:
        r = client.get(
            "/callback?code=abc&state=st-next",
            headers=_state_header_with_next("st-next", "#/s/prj_abc123"),
            follow_redirects=False,
        )
        assert r.status_code == 307, r.text
        assert r.headers["location"] == f"{get_settings().web_origin}/#/s/prj_abc123"


def test_callback_rejects_unsafe_next(monkeypatch):
    """A tampered `next` (absolute URL → open redirect) is dropped; the user just
    lands on the app origin."""
    email = "callback-badnext@example.com"
    with Session(get_engine()) as s:
        if s.get(AllowedEmail, email) is None:
            s.add(AllowedEmail(email=email))
            s.commit()
    _patch_identity(monkeypatch, email=email, fs_id="cis.user.BADNEXT")

    with TestClient(app) as client:
        r = client.get(
            "/callback?code=abc&state=st-bad",
            headers=_state_header_with_next("st-bad", "https://evil.example.com/phish"),
            follow_redirects=False,
        )
        assert r.status_code == 307, r.text
        assert r.headers["location"] == get_settings().web_origin


# ── fresh_fs_token: refresh-if-stale, else surface the dead grant ─
# FamilySearch caps a grant at 8h idle / 24h absolute, so the token injected at
# sandbox-create is dead by the next day. fresh_fs_token is what /connect calls to
# hand the sandbox a live token again — or report the grant is gone.

def _seed_token(user_id: str, *, access: str, refresh: str | None, expires_at: datetime) -> None:
    with Session(get_engine()) as s:
        s.merge(FamilySearchToken(
            user_id=user_id, access_token=access, refresh_token=refresh, expires_at=expires_at,
        ))
        s.commit()


async def test_fresh_fs_token_returns_live_token_as_is(monkeypatch):
    calls = []
    async def _no_refresh(_rt):  # must NOT be called for a comfortably-live token
        calls.append(_rt)
        return None
    monkeypatch.setattr(fs_oauth, "refresh_tokens", _no_refresh)
    _seed_token("usr_live", access="A-live", refresh="R",
                expires_at=datetime.now(timezone.utc) + timedelta(hours=2))

    with Session(get_engine()) as s:
        row = await fresh_fs_token(s, "usr_live")
    assert row is not None and row.access_token == "A-live"
    assert calls == [], "a live token must not trigger a refresh"


async def test_fresh_fs_token_refreshes_when_near_expiry(monkeypatch):
    async def _refresh(rt):
        assert rt == "R-old"
        return {"access_token": "A-new", "refresh_token": "R-new", "expires_in": 3600}
    monkeypatch.setattr(fs_oauth, "refresh_tokens", _refresh)
    _seed_token("usr_stale", access="A-old", refresh="R-old",
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=2))

    with Session(get_engine()) as s:
        row = await fresh_fs_token(s, "usr_stale")
        assert row is not None and row.access_token == "A-new"
        # Persisted, so the next connect (and the DB of record) sees the new token.
        assert s.get(FamilySearchToken, "usr_stale").access_token == "A-new"


async def test_fresh_fs_token_none_when_refresh_refused(monkeypatch):
    async def _dead(_rt):
        return None  # FS refused — grant is past its 24h cap
    monkeypatch.setattr(fs_oauth, "refresh_tokens", _dead)
    _seed_token("usr_dead", access="A-exp", refresh="R-exp",
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))

    with Session(get_engine()) as s:
        assert await fresh_fs_token(s, "usr_dead") is None


async def test_fresh_fs_token_none_without_refresh_token():
    _seed_token("usr_norefresh", access="A", refresh=None,
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    with Session(get_engine()) as s:
        assert await fresh_fs_token(s, "usr_norefresh") is None


async def test_fresh_fs_token_none_without_row():
    with Session(get_engine()) as s:
        assert await fresh_fs_token(s, "usr_absent") is None


# ── sync_fs_token: the state /connect reports to the client ──────

class _FakeSandbox:
    def __init__(self):
        self.writes: dict[str, bytes] = {}

    async def write_file(self, path: str, data: bytes) -> None:
        self.writes[path] = data


async def test_sync_fs_token_ok_reinjects_refreshed_token(monkeypatch):
    async def _refresh(_rt):
        return {"access_token": "A-fresh", "refresh_token": "R", "expires_in": 3600}
    monkeypatch.setattr(fs_oauth, "refresh_tokens", _refresh)
    _seed_token("usr_ok", access="A-old", refresh="R",
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=1))
    user = User(id="usr_ok", email="ok@example.com")
    sandbox = _FakeSandbox()

    with Session(get_engine()) as s:
        assert await sync_fs_token(s, user, sandbox) == "ok"
    injected = json.loads(sandbox.writes[fs_oauth.TOKENS_PATH].decode())
    assert injected["accessToken"] == "A-fresh"


async def test_sync_fs_token_expired_leaves_sandbox_untouched(monkeypatch):
    async def _dead(_rt):
        return None
    monkeypatch.setattr(fs_oauth, "refresh_tokens", _dead)
    _seed_token("usr_exp", access="A", refresh="R",
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    user = User(id="usr_exp", email="exp@example.com")
    sandbox = _FakeSandbox()

    with Session(get_engine()) as s:
        assert await sync_fs_token(s, user, sandbox) == "expired"
    # Must NOT clobber the sandbox's own (possibly still-live) tokens.json.
    assert fs_oauth.TOKENS_PATH not in sandbox.writes


async def test_sync_fs_token_none_without_row():
    user = User(id="usr_none", email="none@example.com")
    sandbox = _FakeSandbox()
    with Session(get_engine()) as s:
        assert await sync_fs_token(s, user, sandbox) == "none"
    assert sandbox.writes == {}
