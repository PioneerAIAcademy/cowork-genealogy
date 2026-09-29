"""U2: patron sign-in on the prototype web tier (proto/web/auth.py, docs/plan/u2-patron-sign-in.md).

Offline. The FamilySearch round-trip is monkeypatched at ``auth.exchange_code`` /
``auth.fetch_identity``; the routes run against ``FakeStore``. The owner and grant SQL the
real ``PgStore`` runs is exercised against a scripted connection further down, because
every route test drives the fake and a fake that mirrored the wrong rule would keep them
all green.
"""

from __future__ import annotations

import ast
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from tests.test_proto_web import AUTH_ENV, PROTO, USER_A, FakeQueue, FakeStore, make_client
from web import app, auth
from web.app import IdentityMismatch, ProjectNotOwned, create_app

FS_ID = "MMMM-AAA"


@pytest.fixture(autouse=True)
def _clean_auth_env(monkeypatch):
    for name in AUTH_ENV:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def fs_on(monkeypatch):
    """FamilySearch sign-in configured, with the repo's bundled client config."""
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    monkeypatch.setenv("WEB_ORIGIN", "http://spa.test")
    return monkeypatch


def _fake_fs(monkeypatch, *, email: str = "a@example.org", fs_id: str = FS_ID,
             refresh: str | None = "refresh-1", access: str = "access-1") -> list[str]:
    calls: list[str] = []

    async def exchange_code(code, verifier):
        calls.append(f"exchange {code} {verifier}")
        body = {"access_token": access}
        if refresh is not None:
            body["refresh_token"] = refresh
        return body

    async def fetch_identity(access_token):
        calls.append(f"identity {access_token}")
        return {"id": fs_id, "email": email}

    monkeypatch.setattr(auth, "exchange_code", exchange_code)
    monkeypatch.setattr(auth, "fetch_identity", fetch_identity)
    return calls


def _client(store: FakeStore, *, oauth: str | None = None, session_user: str | None = None) -> httpx.AsyncClient:
    cookies = {}
    if oauth is not None:
        cookies[auth.FS_OAUTH_COOKIE] = oauth
    if session_user is not None:
        cookies[auth.COOKIE_NAME] = auth.session_cookie_value(session_user)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(store, FakeQueue())),
                             base_url="http://t", cookies=cookies)


async def _callback(store: FakeStore, *, state: str = "st", next_route: str | None = None,
                    sent_state: str | None = None) -> httpx.Response:
    oauth = auth.oauth_state_cookie("verifier-1", state, next_route)
    async with _client(store, oauth=oauth) as c:
        return await c.get("/callback", params={"code": "code-1", "state": sent_state or state})


# ── the callback ────────────────────────────────────────────────────────────────


async def test_callback_refuses_a_non_allowlisted_email_and_writes_no_rows(fs_on):
    _fake_fs(fs_on, email="stranger@example.org")
    store = FakeStore()
    users_before = dict(store.users)
    r = await _callback(store)
    assert r.status_code == 403 and "not on the allowlist" in r.text
    assert store.users == users_before and store.grants == {}
    assert auth.COOKIE_NAME not in r.cookies


@pytest.mark.parametrize("case", ["mismatch", "missing-cookie", "forged-cookie"])
async def test_callback_state_problems_are_400_and_touch_nothing(fs_on, case):
    calls = _fake_fs(fs_on)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    if case == "mismatch":
        r = await _callback(store, sent_state="other")
    else:
        oauth = None if case == "missing-cookie" else auth.oauth_state_cookie("v", "st", None) + "x"
        async with _client(store, oauth=oauth) as c:
            r = await c.get("/callback", params={"code": "code-1", "state": "st"})
    assert r.status_code == 400
    assert calls == [] and store.grants == {}, "no code exchange before the state is proven"


async def test_callback_stores_ciphertext_with_granted_at(fs_on):
    calls = _fake_fs(fs_on, access="access-plain", refresh="refresh-plain")
    store = FakeStore()
    store.allowed = {"a@example.org"}
    r = await _callback(store, next_route="#/s/proj_1")
    assert r.status_code in (302, 307), r.text
    assert r.headers["location"] == "http://spa.test/#/s/proj_1"
    assert calls == ["exchange code-1 verifier-1", "identity access-plain"]
    user = next(u for u in store.users.values() if u.email == "a@example.org")
    assert user.familysearch_id == FS_ID
    grant = store.grants[user.id]
    for field, plain in (("access_token_enc", "access-plain"), ("refresh_token_enc", "refresh-plain")):
        stored = grant[field]
        assert stored.startswith("gAAAAA") and plain not in stored, f"{field} is not ciphertext"
        assert auth.decrypt(stored) == plain
    assert grant["granted_at"] is not None and grant["writes"] == 1
    cookie = auth.read_session_cookie(r.cookies.get(auth.COOKIE_NAME))
    assert cookie and cookie["uid"] == user.id


async def test_callback_refuses_a_second_fs_account_for_an_existing_email(fs_on):
    store = FakeStore()
    store.allowed = {"a@example.org"}
    _fake_fs(fs_on, fs_id=FS_ID)
    assert (await _callback(store)).status_code in (302, 307)
    user_id = next(u.id for u in store.users.values() if u.email == "a@example.org")
    grant_before = dict(store.grants[user_id])
    _fake_fs(fs_on, fs_id="ZZZZ-999", access="attacker-access")
    r = await _callback(store)
    assert r.status_code == 403 and "different FamilySearch" in r.text
    assert store.grants[user_id] == grant_before, "the refused sign-in must not overwrite the grant"
    assert auth.COOKIE_NAME not in r.cookies


async def test_second_sign_in_resets_granted_at_and_keeps_refresh_token_when_omitted(fs_on):
    store = FakeStore()
    store.allowed = {"a@example.org"}
    _fake_fs(fs_on, refresh="refresh-1", access="access-1")
    await _callback(store)
    user_id = next(u.id for u in store.users.values() if u.email == "a@example.org")
    first = dict(store.grants[user_id])
    time.sleep(0.01)
    _fake_fs(fs_on, refresh=None, access="access-2")
    await _callback(store)
    second = store.grants[user_id]
    assert auth.decrypt(second["access_token_enc"]) == "access-2"
    assert auth.decrypt(second["refresh_token_enc"]) == "refresh-1"
    assert second["granted_at"] > first["granted_at"]


@pytest.mark.parametrize("next_route, expected", [
    ("#/s/proj_1", "http://spa.test/#/s/proj_1"),
    ("https://evil.example/", "http://spa.test"),
    ("//evil.example", "http://spa.test"),
    ("#/../../x?y", "http://spa.test"),
    (None, "http://spa.test"),
])
def test_next_redirect_accepts_only_safe_hash_routes(fs_on, next_route, expected):
    assert auth.redirect_target(next_route) == expected


async def test_familysearch_login_redirects_with_pkce_and_sets_the_state_cookie(fs_on):
    store = FakeStore()
    async with _client(store) as c:
        r = await c.get("/auth/familysearch/login", params={"next": "#/s/p"})
    assert r.status_code in (302, 307)
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["client_id"] == ["fs-internal-dev-key-000262"]
    assert q["redirect_uri"] == ["http://127.0.0.1:8085/callback"]
    assert q["code_challenge_method"] == ["S256"]
    state = auth.read_oauth_state_cookie(r.cookies.get(auth.FS_OAUTH_COOKIE))
    assert state and state["state"] == q["state"][0] and state["next"] == "#/s/p"


async def test_familysearch_login_is_501_when_not_configured():
    async with _client(FakeStore()) as c:
        assert (await c.get("/auth/familysearch/login")).status_code == 501


# ── sessions: cookie, logout, allowlist, dev-login ──────────────────────────────


async def test_logout_revokes_existing_cookie():
    store = FakeStore()
    old = auth.session_cookie_value(USER_A.id, iat=time.time() - 60)
    app_ = create_app(store, FakeQueue())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_), base_url="http://t",
                                 cookies={auth.COOKIE_NAME: old}) as c:
        assert (await c.get("/auth/me")).status_code == 200
        assert (await c.post("/auth/logout")).json() == {"ok": True}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_), base_url="http://t",
                                 cookies={auth.COOKIE_NAME: old}) as c:
        assert (await c.get("/auth/me")).status_code == 401, "a copied cookie outlives the logout"
    fresh = auth.session_cookie_value(USER_A.id, iat=time.time() + 1)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_), base_url="http://t",
                                 cookies={auth.COOKIE_NAME: fresh}) as c:
        assert (await c.get("/auth/me")).status_code == 200, "signing in again works"


async def test_allowlist_removal_403s_an_existing_cookie(fs_on):
    store = FakeStore()
    store.allowed = {USER_A.email}
    async with make_client(store, FakeQueue()) as c:
        assert (await c.get("/api/sessions")).status_code == 200
        store.allowed = set()
        assert (await c.get("/api/sessions")).status_code == 403


async def test_dev_login_signs_in_distinct_patrons_and_sets_the_cookie():
    store = FakeStore()
    async with _client(store) as c:
        a = await c.post("/auth/dev-login", json={"email": "One@Example.org"})
        assert a.status_code == 200 and a.json()["email"] == "one@example.org"
        assert (await c.get("/auth/me")).json() == a.json()
        blank = (await c.post("/auth/dev-login", json={})).json()
    assert blank["email"] == auth.DEV_LOGIN_EMAIL and blank["id"] != a.json()["id"]


@pytest.mark.parametrize("env", [{"FAMILYSEARCH_WEB_ENABLED": "true"},
                                 {"PUBLIC_URL": "https://search.example.org",
                                  "SESSION_SECRET": "s" * 32, "FS_TOKEN_ENC_KEY": "k" * 32}])
async def test_dev_login_disabled_when_fs_configured_or_https(monkeypatch, env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    store = FakeStore()
    async with _client(store) as c:
        assert (await c.get("/auth/config")).json()["devLogin"] is False
        assert (await c.post("/auth/dev-login", json={"email": "x@y.z"})).status_code == 403
    assert all(u.email != "x@y.z" for u in store.users.values())


async def test_the_lifespan_syncs_the_allowlist_from_the_environment(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", " A@Example.org, b@example.org ,")
    store = FakeStore()
    application = create_app(store, FakeQueue())
    async with application.router.lifespan_context(application):
        pass
    assert store.allowed == {"a@example.org", "b@example.org"}


# ── encryption, preflight, the client config ────────────────────────────────────


def test_decrypt_soft_fails_to_none_under_wrong_key(monkeypatch):
    token = auth.encrypt("secret")
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "another key")
    assert auth.decrypt(token) is None
    assert auth.decrypt("not ciphertext") is None
    assert auth.decrypt("café") is None


def test_alpha_key_derivation_decrypts_alpha_ciphertext(monkeypatch):
    """Same derivation as apps/server/app/crypto.py, so a grant the alpha wrote reads here."""
    from app import crypto

    monkeypatch.setattr(crypto, "get_settings", lambda: SimpleNamespace(fs_token_enc_key="shared key"))
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "shared key")
    alpha = crypto.EncryptedStr().process_bind_param("fs-access", None)
    assert auth.decrypt(alpha) == "fs-access"
    assert crypto.EncryptedStr().process_result_value(auth.encrypt("back"), None) == "back"


@pytest.mark.parametrize("secret, key", [("", ""), (auth.DEV_SESSION_SECRET, "k" * 32), ("s" * 32, auth.DEV_FS_TOKEN_ENC_KEY)])
def test_preflight_refuses_default_secrets_on_https(monkeypatch, secret, key):
    monkeypatch.setenv("PUBLIC_URL", "https://search.example.org")
    if secret:
        monkeypatch.setenv("SESSION_SECRET", secret)
    if key:
        monkeypatch.setenv("FS_TOKEN_ENC_KEY", key)
    with pytest.raises(RuntimeError, match="Refusing to start"):
        auth.preflight()


def test_preflight_passes_on_http_with_defaults_and_on_https_with_real_secrets(monkeypatch):
    auth.preflight()
    monkeypatch.setenv("PUBLIC_URL", "https://search.example.org")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    auth.preflight()


def test_fs_enabled_with_missing_client_config_fails_boot(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    monkeypatch.setenv("FAMILYSEARCH_CONFIG", str(tmp_path / "missing.json"))
    with pytest.raises(auth.ClientConfigError):
        auth.preflight()
    (tmp_path / "empty.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("FAMILYSEARCH_CONFIG", str(tmp_path / "empty.json"))
    with pytest.raises(auth.ClientConfigError):
        auth.preflight()
    # Disabled, the same missing file is not an error: dev-login needs no client id.
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "false")
    auth.preflight()


def test_the_repo_client_config_is_found_without_configuration():
    assert auth.client_id() == "fs-internal-dev-key-000262"


def _imports_app_package(source: str) -> list[str]:
    hits = []
    for node in ast.walk(ast.parse(source)):
        names = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module]
        hits += [n for n in names if n == "app" or n.startswith("app.")]
    return hits


@pytest.mark.parametrize("name", ["auth.py", "app.py"])
def test_web_tier_does_not_import_app_package(name):
    """The web image does not carry apps/server/app, so an import passes every test (the
    suite has the whole tree on the path) and fails only in the container."""
    assert _imports_app_package((PROTO / "web" / name).read_text(encoding="utf-8")) == []


@pytest.mark.parametrize("source, bad", [
    ("from app.crypto import _fernet", True),
    ("import app.config as c", True),
    ("def f():\n    import app\n", True),
    ("from web import auth", False),
    ("app_state = 1\nimport apps_helper", False),
    ("from . import app", False),
])
def test_the_no_app_import_check_catches_the_shapes_and_passes_the_rest(source, bad):
    assert bool(_imports_app_package(source)) is bad


# ── the real PgStore SQL, against a scripted connection ─────────────────────────


class ScriptedConn:
    """Records every statement; ``answer(sql)`` decides what fetchone returns."""

    def __init__(self, answer: Callable[[str], Any] = lambda sql: None) -> None:
        self.sql: list[str] = []
        self.params: list[tuple] = []
        self.answer = answer

    async def execute(self, sql, params=()):
        self.sql.append(" ".join(sql.split()))
        self.params.append(params)
        return self

    async def fetchone(self):
        return self.answer(self.sql[-1])

    async def fetchall(self):
        return []

    def transaction(self):
        class _Tx:
            async def __aenter__(self): return None
            async def __aexit__(self, *exc): return False
        return _Tx()

    async def __aenter__(self): return self
    async def __aexit__(self, *exc): return False


def _store(conn: ScriptedConn) -> app.PgStore:
    store = app.PgStore("postgresql://unused")

    async def connect():
        return conn

    store._connect = connect  # type: ignore[method-assign]
    return store


T0 = datetime(2026, 9, 29, tzinfo=timezone.utc)
SESSION_ROW = {"session_id": "sess_1", "project_id": "proj_1", "title": "t", "model": "m",
               "created_at": T0, "updated_at": T0, "owner_id": "usr_a"}


def _answer(project_owner: object, claim_hits: bool = True, insert_hits: bool = True):
    """``project_owner``: the SELECT ... FOR UPDATE result -- "absent" for no row."""
    def answer(sql: str):
        if sql.startswith("SELECT owner_id FROM projects"):
            return None if project_owner == "absent" else {"owner_id": project_owner}
        if sql.startswith("UPDATE projects SET owner_id"):
            return {"project_id": "proj_1"} if claim_hits else None
        if sql.startswith("INSERT INTO projects") and "RETURNING" in sql:
            return {"project_id": "proj_1"} if insert_hits else None
        if sql.startswith("SELECT s.session_id"):
            return SESSION_ROW
        return None
    return answer


async def test_pgstore_list_sessions_filters_on_owner():
    conn = ScriptedConn()
    await _store(conn).list_sessions("usr_a")
    [sql] = conn.sql
    assert "WHERE p.owner_id = %s" in sql and conn.params == [("usr_a",)]


async def test_pgstore_session_select_carries_the_owner_through_a_left_join():
    conn = ScriptedConn(lambda sql: SESSION_ROW)
    row = await _store(conn).get_session("sess_1")
    assert row.owner_id == "usr_a"
    assert "LEFT JOIN projects p ON p.project_id = s.project_id" in conn.sql[0]


async def test_pgstore_create_session_without_a_project_mints_one_owned_by_the_caller():
    conn = ScriptedConn(_answer("absent"))
    await _store(conn).create_session("t", "m", None, "usr_a", False)
    [insert] = [(q, p) for q, p in zip(conn.sql, conn.params) if q.startswith("INSERT INTO projects")]
    assert insert[0] == "INSERT INTO projects (project_id, owner_id) VALUES (%s, %s)"
    assert insert[1][1] == "usr_a"


@pytest.mark.parametrize("owner, may, outcome", [
    ("usr_a", False, "ok"),          # own project, production
    ("usr_b", False, "refused"),     # someone else's
    ("usr_b", True, "refused"),      # someone else's, even under dev-login
    (None, False, "refused"),        # unowned, production: no claim
    (None, True, "claimed"),         # unowned, dev-login: claimed
    ("absent", False, "refused"),    # unknown id, production: no create
    ("absent", True, "created"),     # unknown id, dev-login: created
])
async def test_pgstore_create_session_claims_only_unowned(owner, may, outcome):
    conn = ScriptedConn(_answer(owner))
    store = _store(conn)
    if outcome == "refused":
        with pytest.raises(ProjectNotOwned):
            await store.create_session("t", "m", "proj_1", "usr_a", may)
        assert not any(q.startswith("INSERT INTO sessions") for q in conn.sql)
        return
    await store.create_session("t", "m", "proj_1", "usr_a", may)
    assert any(q.startswith("INSERT INTO sessions") for q in conn.sql)
    claims = [q for q in conn.sql if q.startswith("UPDATE projects SET owner_id")]
    creates = [q for q in conn.sql if q.startswith("INSERT INTO projects")]
    assert bool(claims) is (outcome == "claimed") and bool(creates) is (outcome == "created")
    if claims:
        assert claims[0].endswith("WHERE project_id = %s AND owner_id IS NULL RETURNING project_id"), claims[0]
    if creates:
        assert "ON CONFLICT (project_id) DO NOTHING RETURNING project_id" in creates[0]


@pytest.mark.parametrize("answer", [_answer(None, claim_hits=False), _answer("absent", insert_hits=False)])
async def test_pgstore_create_session_loses_a_race_as_a_refusal(answer):
    conn = ScriptedConn(answer)
    with pytest.raises(ProjectNotOwned):
        await _store(conn).create_session("t", "m", "proj_1", "usr_a", True)


async def test_pgstore_delete_session_drops_project_data_only_with_its_last_session():
    conn = ScriptedConn(lambda sql: {"project_id": "proj_1"})
    assert await _store(conn).delete_session("sess_1") is True
    for table in ("documents", "blobs", "staging", "projects"):
        [q] = [(q, p) for q, p in zip(conn.sql, conn.params) if q.startswith(f"DELETE FROM {table} ")]
        assert q[0].endswith("AND NOT EXISTS (SELECT 1 FROM sessions WHERE project_id = %s)"), q[0]
        assert q[1] == ("proj_1", "proj_1")
    assert conn.sql.index("DELETE FROM sessions WHERE session_id = %s") < conn.sql.index(
        next(q for q in conn.sql if q.startswith("DELETE FROM projects"))), "the NOT EXISTS must see the session gone"


async def test_pgstore_store_grant_keeps_refresh_and_resets_granted_at():
    conn = ScriptedConn()
    await _store(conn).store_grant("usr_a", "gAAAAA-access", None, T0)
    [sql] = conn.sql
    update = sql.split("DO UPDATE SET", 1)[1]
    assert "refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, familysearch_tokens.refresh_token_enc)" in update
    assert "granted_at = now()" in update and "ON CONFLICT (user_id)" in sql
    assert conn.params == [("usr_a", "gAAAAA-access", None, T0)]


@pytest.mark.parametrize("stored, presented, raises", [
    (FS_ID, FS_ID, False), (None, FS_ID, False), (FS_ID, None, False), (FS_ID, "ZZZZ-999", True),
])
async def test_pgstore_upsert_user_pins_the_familysearch_id(stored, presented, raises):
    row = {"id": "usr_a", "email": "a@example.org", "familysearch_id": stored, "sessions_revoked_at": None}
    conn = ScriptedConn(lambda sql: row if sql.startswith("SELECT id, email") else None)
    store = _store(conn)
    if raises:
        with pytest.raises(IdentityMismatch):
            await store.upsert_user("A@example.org", presented)
        assert not any(q.startswith("UPDATE users") for q in conn.sql)
        return
    user = await store.upsert_user("A@example.org", presented)
    assert user.familysearch_id == (stored or presented)
    assert any(q.startswith("UPDATE users SET familysearch_id") for q in conn.sql) is (stored is None and presented is not None)
    assert conn.params[0][1] == "a@example.org", "emails are stored lower-cased"
