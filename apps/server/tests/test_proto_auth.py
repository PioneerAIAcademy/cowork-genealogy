"""U2: patron sign-in on the prototype web tier (proto/web/auth.py, docs/plan/familysearch-handoff.md U2).

Offline. The FamilySearch round-trip is monkeypatched at ``auth.exchange_code`` /
``auth.fetch_identity``; the routes run against ``FakeStore``. The owner and grant SQL the
real ``PgStore`` runs is exercised against a scripted connection further down, because
every route test drives the fake and a fake that mirrored the wrong rule would keep them
all green.
"""

from __future__ import annotations

import ast
import asyncio
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from tests.test_proto_web import (  # noqa: F401  (refused_pg and silent_pg are fixtures)
    AUTH_ENV, PROTO, USER_A, USER_B, FakeQueue, FakeStore, make_client, refused_pg, silent_pg,
)
from web import app, auth
from web.app import EmailTaken, IdentityMismatch, ProjectNotOwned, create_app

FS_ID = "MMMM-AAA"


@pytest.fixture(autouse=True)
def _clean_auth_env(monkeypatch):
    for name in AUTH_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DEV_LOGIN", "true")


@pytest.fixture
def fs_on(monkeypatch):
    """FamilySearch sign-in configured, with the repo's bundled client config and the real
    secrets ``preflight`` demands whenever sign-in is on."""
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    monkeypatch.setenv("WEB_ORIGIN", "http://spa.test")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
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
    ("https://evil.example/", "http://spa.test/"),
    ("//evil.example", "http://spa.test/"),
    ("#/../../x?y", "http://spa.test/"),
    (None, "http://spa.test/"),
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


# ── U28: a path prefix on PUBLIC_URL ────────────────────────────────────────────

PREFIX = "/service/search/agent-tools/web"


@pytest.fixture
def prefixed(fs_on):
    fs_on.setenv("PUBLIC_URL", f"http://edge.test{PREFIX}/")
    fs_on.delenv("WEB_ORIGIN")
    return fs_on


def _cookie_paths(r: httpx.Response) -> dict[str, str]:
    """Set-Cookie name -> its Path attribute."""
    out = {}
    for line in r.headers.get_list("set-cookie"):
        name = line.split("=", 1)[0]
        attrs = {k.strip().lower(): v for k, _, v in (a.partition("=") for a in line.split(";")[1:])}
        out[name] = attrs.get("path")
    return out


def test_base_path_and_cookie_path_follow_public_url(monkeypatch):
    assert (auth.base_path(), auth.cookie_path()) == ("", "/")
    monkeypatch.setenv("PUBLIC_URL", f"https://edge.test{PREFIX}/")
    assert (auth.base_path(), auth.cookie_path()) == (PREFIX, PREFIX)
    assert auth.cookie_kwargs()["path"] == PREFIX


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8085/?x=1",
    f"http://edge.test{PREFIX}?x=1",
    f"https://edge.test{PREFIX}#frag",
    "http://edge.test/a b",
    "http://edge.test/a<b",
    'http://edge.test/a"b',
])
def test_a_bad_public_url_path_refuses_at_any_scheme(monkeypatch, url):
    monkeypatch.setenv("PUBLIC_URL", url)
    with pytest.raises(RuntimeError, match="Refusing to start: PUBLIC_URL"):
        auth.preflight()
    with pytest.raises(RuntimeError, match="Refusing to start: PUBLIC_URL"):
        create_app(FakeStore(), FakeQueue())


@pytest.mark.parametrize("next_route, expected", [
    ("#/s/proj_1", f"http://edge.test{PREFIX}/#/s/proj_1"),
    (None, f"http://edge.test{PREFIX}/"),
    ("//evil.example", f"http://edge.test{PREFIX}/"),
])
def test_redirect_target_keeps_the_prefix_and_its_trailing_slash(prefixed, next_route, expected):
    assert auth.redirect_target(next_route) == expected


async def test_familysearch_login_under_a_prefix_carries_it_in_redirect_uri_and_cookie_path(prefixed):
    assert auth.redirect_uri() == f"http://edge.test{PREFIX}/callback"
    async with _client(FakeStore()) as c:
        r = await c.get("/auth/familysearch/login")
    assert parse_qs(urlparse(r.headers["location"]).query)["redirect_uri"] == [f"http://edge.test{PREFIX}/callback"]
    assert _cookie_paths(r) == {auth.FS_OAUTH_COOKIE: PREFIX}


@pytest.mark.parametrize("next_route, location", [("#/s/proj_1", f"{PREFIX}/#/s/proj_1"), (None, f"{PREFIX}/")])
async def test_callback_under_a_prefix_lands_and_scopes_both_cookies_to_it(prefixed, next_route, location):
    _fake_fs(prefixed)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    r = await _callback(store, next_route=next_route)
    assert r.status_code in (302, 307), r.text
    assert r.headers["location"] == f"http://edge.test{location}"
    assert _cookie_paths(r) == {auth.COOKIE_NAME: PREFIX, auth.FS_OAUTH_COOKIE: PREFIX}
    deleted = [ln for ln in r.headers.get_list("set-cookie") if ln.startswith(f"{auth.FS_OAUTH_COOKIE}=")]
    assert len(deleted) == 1 and "Max-Age=0" in deleted[0], "the state cookie is deleted at the path it was set"


async def test_dev_login_and_logout_scope_the_cookie_to_the_prefix(monkeypatch):
    monkeypatch.setenv("PUBLIC_URL", f"http://edge.test{PREFIX}")
    async with _client(FakeStore()) as c:
        login = await c.post("/auth/dev-login", json={})
        assert login.status_code == 200 and _cookie_paths(login) == {auth.COOKIE_NAME: PREFIX}
        out = await c.post("/auth/logout")
    assert _cookie_paths(out) == {auth.COOKIE_NAME: PREFIX}
    assert "Max-Age=0" in out.headers["set-cookie"]


async def test_cookies_stay_at_the_root_without_a_prefix(fs_on):
    async with _client(FakeStore()) as c:
        assert _cookie_paths(await c.get("/auth/familysearch/login")) == {auth.FS_OAUTH_COOKIE: "/"}
        assert _cookie_paths(await c.post("/auth/logout")) == {auth.COOKIE_NAME: "/"}


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


@pytest.mark.parametrize("value", [None, "", "false", "1", "yes", "on"])
async def test_dev_login_is_opt_in(monkeypatch, value):
    """U13: FamilySearch off and PUBLIC_URL unset (http) is what a deployed host that forgot
    both looks like; without DEV_LOGIN=true it still offers no allowlist-free sign-in."""
    if value is None:
        monkeypatch.delenv("DEV_LOGIN")
    else:
        monkeypatch.setenv("DEV_LOGIN", value)
    assert not auth.familysearch_enabled() and not auth.is_https()
    assert not auth.dev_login_enabled()
    store = FakeStore()
    async with _client(store) as c:
        assert (await c.get("/auth/config")).json()["devLogin"] is False
        assert (await c.post("/auth/dev-login", json={"email": "x@y.z"})).status_code == 403
    assert all(u.email != "x@y.z" for u in store.users.values())


@pytest.mark.parametrize("value", ["true", " TRUE ", "True"])
def test_dev_login_accepts_true_in_any_case(monkeypatch, value):
    monkeypatch.setenv("DEV_LOGIN", value)
    assert auth.dev_login_enabled()


async def test_the_lifespan_syncs_the_allowlist_from_the_environment(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", " A@Example.org, b@example.org ,")
    store = FakeStore()
    application = create_app(store, FakeQueue())
    async with application.router.lifespan_context(application):
        pass
    assert store.allowed == {"a@example.org", "b@example.org"}


@pytest.mark.parametrize("raw", ["a@x.org b@x.org", "a@x.org,b@x.org", " A@x.org ,\n b@x.org ", "a@x.org\tb@x.org,,"])
def test_allowed_emails_split_on_commas_and_whitespace(monkeypatch, raw):
    """U12 D32: a comma is outside Beanstalk's environment-value character set, so a list
    of two must be writable space-separated; compose's commas keep working."""
    monkeypatch.setenv("ALLOWED_EMAILS", raw)
    assert auth.allowed_emails() == {"a@x.org", "b@x.org"}


@pytest.mark.parametrize("raw", ["", "  ", " , \n"])
def test_allowed_emails_blank_is_empty(monkeypatch, raw):
    monkeypatch.setenv("ALLOWED_EMAILS", raw)
    assert auth.allowed_emails() == set()


# ── U10: the lifespan listens with Postgres down; the allowlist stays fail-closed ─


@pytest.mark.parametrize("postgres", ["refused", "silent"])
async def test_the_lifespan_listens_with_postgres_down(monkeypatch, refused_pg, silent_pg, postgres):
    monkeypatch.setenv("PG_DSN", (refused_pg if postgres == "refused" else silent_pg).dsn)
    monkeypatch.setattr(app, "READY_TIMEOUT_S", 0.3)
    application = create_app(queue=FakeQueue())
    started = time.monotonic()
    async with application.router.lifespan_context(application):
        entered = time.monotonic() - started
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t") as c:
            r = await c.get("/api/health")
    assert entered < 6, f"{entered:.1f}s: the two inline steps must share one budget"
    body = r.json()
    assert r.status_code == 503 and body["queue"] == "FakeQueue"
    assert set(body["checks"]) == {"postgres", "schema", "allowlist"}, "the store is installed while Postgres is down"
    assert not any(check["ok"] for check in body["checks"].values()), body
    assert "probeuser" not in r.text and "127.0.0.1" not in r.text


# ── U29: PG_SAS_OBJECT ───────────────────────────────────────────────────────────


async def test_the_lifespan_reads_pg_from_sas(monkeypatch, refused_pg, caplog):
    """SAS set and PG_DSN unset: the store's credentials come from the SAS object, the tier
    listens with that Postgres down, and the password never reaches the body or the log."""
    import logging
    import pg_credentials

    caplog.set_level(logging.DEBUG)
    fetched: list[str] = []

    def fetch(name: str) -> dict[str, str]:
        fetched.append(name)
        return {"fchUser": "sasuser", "fchPassword": "rotating-pw-7",
                "fchDbConnectUrl": f"jdbc:postgresql://127.0.0.1:{refused_pg.port}/proto"}

    monkeypatch.delenv("PG_DSN", raising=False)
    monkeypatch.setenv("PG_SAS_OBJECT", "fch-web")
    monkeypatch.setattr(pg_credentials, "sas_installed", lambda: True)
    monkeypatch.setattr(pg_credentials, "_fetch_sas_object", fetch)
    monkeypatch.setattr(app, "READY_TIMEOUT_S", 0.3)
    application = create_app(queue=FakeQueue())
    async with application.router.lifespan_context(application):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t") as c:
            r = await c.get("/api/health")
        store = application.state.store
        assert application.state.pg_creds is store.creds, "one holder for the async and sync paths"
        assert store.creds.mode == "sas" and store.dsn.endswith(f"@127.0.0.1:{refused_pg.port}/proto")
    assert r.status_code == 503 and not r.json()["checks"]["postgres"]["ok"]
    assert fetched and set(fetched) == {"fch-web"}
    assert "pg_credentials=SAS object fch-web" in caplog.text
    for text in (r.text, caplog.text):
        assert "rotating-pw-7" not in text and "sasuser" not in text



async def test_an_injected_pgstore_keeps_its_own_credentials_for_the_sync_routes(monkeypatch, refused_pg):
    monkeypatch.setenv("PG_DSN", "postgresql://u:p@127.0.0.1:1/other")
    monkeypatch.setattr(app, "READY_TIMEOUT_S", 0.3)
    store = app.PgStore(refused_pg.dsn)
    application = create_app(store, FakeQueue())
    async with application.router.lifespan_context(application):
        assert application.state.pg_creds is store.creds

async def test_the_lifespan_refuses_both_pg_variables(monkeypatch):
    import pg_credentials

    monkeypatch.setenv("PG_DSN", "postgresql://u:p@127.0.0.1:1/proto")
    monkeypatch.setenv("PG_SAS_OBJECT", "fch-web")
    monkeypatch.setattr(pg_credentials, "sas_installed", lambda: True)
    monkeypatch.setattr(pg_credentials, "_fetch_sas_object", lambda name: pytest.fail("fetched"))
    application = create_app(queue=FakeQueue())
    with pytest.raises(RuntimeError, match="both PG_DSN and PG_SAS_OBJECT are set"):
        async with application.router.lifespan_context(application):
            pass
    assert getattr(application.state, "store", None) is None


async def test_the_lifespan_refuses_sas_without_the_client(monkeypatch):
    import pg_credentials

    monkeypatch.delenv("PG_DSN", raising=False)
    monkeypatch.setenv("PG_SAS_OBJECT", "fch-web")
    monkeypatch.setattr(pg_credentials, "sas_installed", lambda: False)
    application = create_app(queue=FakeQueue())
    with pytest.raises(RuntimeError, match="PG_SAS_OBJECT is set but the sas_client package is not installed"):
        async with application.router.lifespan_context(application):
            pass
    assert getattr(application.state, "store", None) is None


async def test_signed_in_routes_are_503_until_the_allowlist_syncs(fs_on):
    _fake_fs(fs_on)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    application = create_app(store, FakeQueue())
    application.state.startup = {"allowlist": "pending"}
    cookies = {auth.COOKIE_NAME: auth.session_cookie_value(USER_A.id)}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t",
                                 cookies=cookies) as c:
        r = await c.get("/api/sessions")
        assert r.status_code == 503 and r.json()["detail"] == "Not ready"
        assert (await c.get("/api/health")).status_code == 503
    oauth = auth.oauth_state_cookie("verifier-1", "st", None)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t",
                                 cookies={auth.FS_OAUTH_COOKIE: oauth}) as c:
        r = await c.get("/callback", params={"code": "code-1", "state": "st"})
    assert r.status_code == 503 and store.grants == {}, "no sign-in against a table this boot has not synced"


class FlakyStore(FakeStore):
    """The schema check and the allowlist sync each fail their first call."""

    def __init__(self) -> None:
        super().__init__()
        self.calls = {"schema": 0, "allowlist": 0}

    async def verify_schema(self) -> list[str]:
        self.calls["schema"] += 1
        if self.calls["schema"] == 1:
            raise OSError("connection refused")
        return ["001_schema.sql"]

    async def sync_allowlist(self, emails: set[str]) -> None:
        self.calls["allowlist"] += 1
        if self.calls["allowlist"] == 1:
            raise OSError("connection refused")
        await super().sync_allowlist(emails)


async def test_the_allowlist_gate_lifts_when_the_background_sync_succeeds(fs_on):
    fs_on.setenv("ALLOWED_EMAILS", "a@example.org")
    fs_on.setattr(app, "STARTUP_BACKOFF_FIRST_S", 0.0)
    store = FlakyStore()
    fs_on.setattr(app, "PgStore", lambda dsn, **kw: store)
    application = create_app(queue=FakeQueue())
    cookies = {auth.COOKIE_NAME: auth.session_cookie_value(USER_A.id)}
    async with application.router.lifespan_context(application):
        assert application.state.startup["allowlist"] == "OSError", "the inline attempt failed"
        for _ in range(200):
            if application.state.startup == {"schema": "ok", "allowlist": "ok"}:
                break
            await asyncio.sleep(0.01)
        assert application.state.startup == {"schema": "ok", "allowlist": "ok"}, application.state.startup
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t",
                                     cookies=cookies) as c:
            assert (await c.get("/api/sessions")).status_code == 200
            assert (await c.get("/api/health")).status_code == 200
    assert store.allowed == {"a@example.org"} and store.calls == {"schema": 2, "allowlist": 2}


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


@pytest.mark.parametrize("secret, key", [
    (None, None),                                          # both unset
    ("", ""),                                              # both empty
    ("   ", "k" * 32),                                     # whitespace-only session secret
    (auth.DEV_SESSION_SECRET, "k" * 32),                   # default session secret
    ("s" * 32, None),                                      # key unset
    ("s" * 32, ""),                                        # key empty
    ("s" * 32, auth.DEV_FS_TOKEN_ENC_KEY),                 # default key
])
def test_preflight_refuses_default_secrets_on_http_when_familysearch_is_on(monkeypatch, secret, key):
    """Sign-in can run over http (a loopback PUBLIC_URL), so the scheme cannot be the only
    trigger: sign-in on stores patron grants and signs sessions."""
    monkeypatch.setenv("PUBLIC_URL", "http://127.0.0.1:1837")
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    for name, value in (("SESSION_SECRET", secret), ("FS_TOKEN_ENC_KEY", key)):
        if value is not None:
            monkeypatch.setenv(name, value)
    assert not auth.is_https()
    with pytest.raises(RuntimeError, match="Refusing to start: FAMILYSEARCH_WEB_ENABLED is on"):
        auth.preflight()


def test_preflight_passes_on_http_with_defaults_and_on_https_with_real_secrets(monkeypatch):
    # compose's dev-login tier: http, FamilySearch off, DEV_LOGIN on, every secret default.
    assert auth.dev_login_enabled() and not auth.familysearch_enabled()
    auth.preflight()
    monkeypatch.setenv("SESSION_SECRET", "")
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", auth.DEV_FS_TOKEN_ENC_KEY)
    auth.preflight()
    monkeypatch.setenv("PUBLIC_URL", "https://search.example.org")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    auth.preflight()


def test_preflight_passes_on_http_with_familysearch_on_and_real_secrets(monkeypatch):
    monkeypatch.setenv("PUBLIC_URL", "http://127.0.0.1:1837")
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    auth.preflight()


def test_the_fs_signin_overlay_requires_both_secrets():
    """The overlay turns sign-in on, so compose must refuse to start it on the base file's
    `${VAR:-}` (empty, hence the development default) before preflight has to."""
    import re

    import yaml

    overlay = yaml.safe_load((PROTO / "docker-compose.fs-signin.yml").read_text(encoding="utf-8"))
    env = overlay["services"]["web"]["environment"]
    assert env["FAMILYSEARCH_WEB_ENABLED"] == "true"
    for name in ("SESSION_SECRET", "FS_TOKEN_ENC_KEY"):
        assert re.fullmatch(rf"\$\{{{name}:\?[^}}]+\}}", str(env.get(name))), (name, env.get(name))


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


@pytest.mark.parametrize("name", ["auth.py", "app.py", "spa.py"])
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
               "created_at": T0, "updated_at": T0, "owner_id": "usr_a", "retired_at": None}


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


def _delete_answer(sdk_session_id: str | None = "sdk-uuid", active: bool = False):
    def answer(sql: str):
        if sql.startswith("SELECT project_id, sdk_session_id FROM sessions"):
            return {"project_id": "proj_1", "sdk_session_id": sdk_session_id}
        if sql.endswith("AS live"):
            return {"live": active}
        return None
    return answer


async def test_pgstore_delete_session_drops_project_data_only_with_its_last_session():
    conn = ScriptedConn(_delete_answer())
    assert await _store(conn).delete_session("sess_1") is True
    for table in ("documents", "blobs", "staging", "projects"):
        [q] = [(q, p) for q, p in zip(conn.sql, conn.params) if q.startswith(f"DELETE FROM {table} ")]
        assert q[0].endswith("AND NOT EXISTS (SELECT 1 FROM sessions WHERE project_id = %s)"), q[0]
        assert q[1] == ("proj_1", "proj_1")
    assert conn.sql.index("DELETE FROM sessions WHERE session_id = %s") < conn.sql.index(
        next(q for q in conn.sql if q.startswith("DELETE FROM projects"))), "the NOT EXISTS must see the session gone"


@pytest.mark.parametrize("sdk_session_id, ids", [("sdk-uuid", ["sess_1", "sdk-uuid"]), (None, ["sess_1"])])
async def test_pgstore_delete_session_deletes_the_transcript_by_the_sdk_session_id(sdk_session_id, ids):
    """U19: session_entries is keyed by sessions.sdk_session_id (004); the web id alone
    matched no transcript row, and the spend meter's rows survived every delete."""
    conn = ScriptedConn(_delete_answer(sdk_session_id))
    await _store(conn).delete_session("sess_1")
    [params] = [p for q, p in zip(conn.sql, conn.params) if q.startswith("DELETE FROM session_entries")]
    assert params == (ids,)
    select = conn.sql.index("SELECT project_id, sdk_session_id FROM sessions WHERE session_id = %s FOR UPDATE")
    assert select < conn.sql.index("DELETE FROM sessions WHERE session_id = %s"), "the sdk id is read before the row goes"


async def test_pgstore_delete_session_takes_the_queue_lock_and_refuses_a_running_turn():
    conn = ScriptedConn(_delete_answer(active=True))
    with pytest.raises(app.SessionBusy):
        await _store(conn).delete_session("sess_1")
    assert not [q for q in conn.sql if q.startswith("DELETE")], "a busy session lost rows"
    assert conn.sql[1] == "SELECT pg_advisory_xact_lock(%s::int4, hashtext(%s))"
    assert conn.params[1] == (app.grants.QUEUE_LOCK_NS, "sess_1"), "the session's queue lock"
    assert conn.sql[2].endswith("FOR UPDATE")


async def test_pgstore_store_grant_takes_the_write_lock_before_the_row():
    """U3: the sign-in's grant rewrite takes the patron's grant WRITE lock (bounded), in the
    same transaction and before the row, so it never interleaves with a refresh; it never
    takes the attempt lock (a second sign-in does not revoke the first token). The upsert
    starts a new session and clears a refusal and the ambiguous-refresh marker; granted_at
    still restarts on every sign-in and a missing refresh token keeps the stored one."""
    conn = ScriptedConn()
    await _store(conn).store_grant("usr_a", "gAAAAA-access", None, T0)
    timeout, lock, upsert = conn.sql
    assert timeout == f"SET LOCAL lock_timeout = '{app.grants.WRITE_LOCK_TIMEOUT_S}s'"
    assert lock == "SELECT pg_advisory_xact_lock(%s::int4, hashtext(%s))"
    assert conn.params[1] == (app.grants.WRITE_LOCK_NS, "usr_a"), "the write key, never the attempt key"
    update = upsert.split("DO UPDATE SET", 1)[1]
    assert "refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, familysearch_tokens.refresh_token_enc)" in update
    assert "granted_at = now()" in update and "ON CONFLICT (user_id)" in upsert
    for clause in ("session_started_at = now()", "refresh_started_at = NULL", "refresh_refused_at = NULL",
                   "refresh_refused_reason = NULL"):
        assert clause in update, clause
    assert "session_started_at" in upsert.split("DO UPDATE", 1)[0], "a first sign-in starts the session too"
    assert conn.params[2] == ("usr_a", "gAAAAA-access", None, T0)


async def test_a_busy_grant_write_answers_503_and_signs_nobody_in(fs_on):
    class BusyStore(FakeStore):
        async def store_grant(self, *a, **k):
            raise app.GrantBusy("usr_x")

    _fake_fs(fs_on)
    store = BusyStore()
    store.allowed = {"a@example.org"}
    r = await _callback(store)
    assert r.status_code == 503 and "try again" in r.text
    assert auth.COOKIE_NAME not in r.cookies


async def test_refresh_tokens_classifies_responses_and_transport_errors(monkeypatch):
    """D5's classifier over the wire. The stall is the case the total deadline exists for:
    httpx's ``timeout=`` is per phase and never cuts a handler that sleeps, so without
    ``asyncio.timeout`` around the whole POST it would hold both refresh locks unbounded."""
    seen: list[dict] = []

    def answer(status: int, body: object):
        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(dict(parse_qs(request.content.decode())))
            return httpx.Response(status, json=body)
        return httpx.MockTransport(handler)

    def raising(exc: Exception):
        def handler(request: httpx.Request) -> httpx.Response:
            raise exc
        return httpx.MockTransport(handler)

    ok = await auth.refresh_tokens("r-1", transport=answer(200, {"access_token": "a-2", "refresh_token": "r-2"}))
    assert (ok.kind, ok.access_token, ok.refresh_token) == ("ok", "a-2", "r-2")
    assert seen[0] == {"grant_type": ["refresh_token"], "refresh_token": ["r-1"],
                       "client_id": [auth.client_id()]}
    refused = await auth.refresh_tokens("r-1", transport=answer(400, {"error": "invalid_grant"}))
    assert (refused.kind, refused.reason) == ("refused", "invalid_grant")
    assert (await auth.refresh_tokens("r", transport=answer(401, {}))).reason == "http_401"
    assert (await auth.refresh_tokens("r", transport=answer(429, {}))).kind == "not_sent"
    assert (await auth.refresh_tokens("r", transport=answer(503, {}))).kind == "ambiguous"
    assert (await auth.refresh_tokens("r", transport=answer(200, {"token_type": "bearer"}))).kind == "ambiguous"
    request = httpx.Request("POST", auth.FS_TOKEN_URL)
    assert (await auth.refresh_tokens("r", transport=raising(httpx.ConnectError("no", request=request)))).kind == "not_sent"
    assert (await auth.refresh_tokens("r", transport=raising(httpx.ConnectTimeout("no", request=request)))).kind == "not_sent"
    assert (await auth.refresh_tokens("r", transport=raising(httpx.ReadTimeout("no", request=request)))).kind == "ambiguous"
    assert (await auth.refresh_tokens("r", transport=raising(httpx.RemoteProtocolError("no", request=request)))).kind \
        == "ambiguous"

    async def stall(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(30)
        return httpx.Response(200, json={"access_token": "late"})

    monkeypatch.setattr(app.grants, "REFRESH_HTTP_TIMEOUT_S", 1)
    t0 = time.monotonic()
    stalled = await auth.refresh_tokens("r", transport=httpx.MockTransport(stall))
    assert time.monotonic() - t0 < app.grants.REFRESH_HTTP_TIMEOUT_S + 1, "the one total deadline bounds the POST"
    assert stalled.kind == "ambiguous", "a deadline cannot tell whether FamilySearch processed it"


async def test_token_calls_send_the_browser_user_agent(monkeypatch):
    """Imperva's rules for ident differ by endpoint (handoff step 18, 2026-10-24), so the
    code exchange and the refresh both send the browser UA."""
    agents: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        agents.append(request.headers.get("user-agent"))
        return httpx.Response(200, json={"access_token": "a", "refresh_token": "r"})

    await auth.refresh_tokens("r-1", transport=httpx.MockTransport(handler))
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    await auth.exchange_code("c", "v")
    assert agents == [auth.BROWSER_USER_AGENT] * 2


def _user_rows(*rows: dict) -> Callable[[str], Any]:
    """A scripted ``users`` table: each SELECT answers with the row its WHERE clause names,
    so the id lookup and the email lookup are told apart (#3992)."""
    def answer_for(conn: ScriptedConn) -> Callable[[str], Any]:
        def answer(sql: str):
            if not sql.startswith("SELECT id, email"):
                return None
            value = conn.params[-1][0]
            key = "familysearch_id" if "WHERE familysearch_id" in sql else "email"
            return next((r for r in rows if r[key] == value), None)
        return answer
    return answer_for


def _row(email: str, fs_id: str | None, uid: str = "usr_a") -> dict:
    return {"id": uid, "email": email, "familysearch_id": fs_id, "sessions_revoked_at": None, "blocked_at": None}


def _scripted(*rows: dict) -> tuple[ScriptedConn, app.PgStore]:
    conn = ScriptedConn()
    conn.answer = _user_rows(*rows)(conn)
    return conn, _store(conn)


@pytest.mark.parametrize("stored, presented, raises", [
    (FS_ID, FS_ID, False), (None, FS_ID, False), (FS_ID, None, False), (FS_ID, "ZZZZ-999", True),
])
async def test_pgstore_upsert_user_pins_the_familysearch_id(stored, presented, raises):
    conn, store = _scripted(_row("a@example.org", stored))
    if raises:
        with pytest.raises(IdentityMismatch):
            await store.upsert_user("A@example.org", presented)
        assert not any(q.startswith("UPDATE users") for q in conn.sql)
        return
    user = await store.upsert_user("A@example.org", presented)
    assert user.familysearch_id == (stored or presented)
    assert any(q.startswith("UPDATE users SET familysearch_id") for q in conn.sql) is (stored is None and presented is not None)
    assert user.email == "a@example.org"
    assert not any(q.startswith("UPDATE users SET email") for q in conn.sql), "emails compare lower-cased"


async def test_pgstore_upsert_user_finds_the_user_by_id_and_updates_a_changed_email():
    """#3992: FamilySearch reports a new email for a known id: same row, email replaced."""
    conn, store = _scripted(_row("old@example.org", FS_ID))
    user = await store.upsert_user("New@example.org", FS_ID)
    assert (user.id, user.email, user.familysearch_id) == ("usr_a", "new@example.org", FS_ID)
    assert ("UPDATE users SET email = %s WHERE id = %s", ("new@example.org", "usr_a")) in zip(conn.sql, conn.params)
    assert not any(q.startswith("INSERT INTO users") for q in conn.sql)


async def test_pgstore_upsert_user_refuses_a_new_email_another_user_holds():
    conn, store = _scripted(_row("old@example.org", FS_ID), _row("b@example.org", None, uid="usr_b"))
    with pytest.raises(EmailTaken):
        await store.upsert_user("b@example.org", FS_ID)
    assert not any(q.startswith(("UPDATE users", "INSERT INTO users")) for q in conn.sql)


async def test_pgstore_upsert_user_keeps_a_blocked_users_email():
    row = {**_row("old@example.org", FS_ID), "blocked_at": datetime(2026, 11, 1, tzinfo=timezone.utc)}
    conn, store = _scripted(row)
    user = await store.upsert_user("new@example.org", FS_ID)
    assert user.email == "old@example.org" and user.blocked_at is not None
    assert not any(q.startswith("UPDATE users") for q in conn.sql)


async def test_pgstore_upsert_user_inserts_a_new_user_with_its_id():
    conn, store = _scripted()
    real_answer = conn.answer
    inserted: list[dict] = []

    def answer(sql: str):
        if sql.startswith("INSERT INTO users"):
            uid, email, fs_id = conn.params[-1]
            inserted.append(_row(email, fs_id, uid))
            return None
        if sql.startswith("SELECT id, email") and inserted:
            return _user_rows(*inserted)(conn)(sql)
        return real_answer(sql)

    conn.answer = answer
    original_execute = conn.execute

    async def execute(sql, params=()):
        await original_execute(sql, params)
        if conn.sql[-1].startswith("INSERT INTO users"):
            conn.answer(conn.sql[-1])
        return conn

    conn.execute = execute  # type: ignore[method-assign]
    user = await store.upsert_user("c@example.org", FS_ID)
    assert (user.email, user.familysearch_id) == ("c@example.org", FS_ID)
    insert = next(q for q in conn.sql if q.startswith("INSERT INTO users"))
    assert "(id, email, familysearch_id)" in insert and "ON CONFLICT DO NOTHING" in insert


async def test_pgstore_upsert_user_turns_a_unique_violation_into_busy():
    """#3992: a racing sign-in took the email or id between the read and the write. The
    callback answers 503 and a retry lands on the right branch, never a 500."""
    from psycopg import errors

    conn, store = _scripted(_row("a@example.org", None))
    original_execute = conn.execute

    async def execute(sql, params=()):
        if " ".join(sql.split()).startswith("UPDATE users SET familysearch_id"):
            raise errors.UniqueViolation("duplicate key value violates unique constraint")
        return await original_execute(sql, params)

    conn.execute = execute  # type: ignore[method-assign]
    with pytest.raises(app.AdmissionBusy):
        await store.upsert_user("a@example.org", FS_ID)


def test_the_client_config_lookup_survives_the_image_layout():
    """In the image web/auth.py sits at /app/web/auth.py, so PROTO_DIR is /app and has no
    third parent. Indexing it unguarded raised IndexError at import: the tier would never
    start, and every test here ran from a checkout where the index exists."""
    assert auth.client_config_candidates(Path("/app")) == (Path("/app/config/familysearch.json"),)
    deep = auth.client_config_candidates(Path("/r/apps/server/proto"))
    assert deep[1] == Path("/r/packages/engine/mcp-server/config/familysearch.json")


# ── make proto-grant (U3) ───────────────────────────────────────────────────────


async def test_grant_script_stores_ciphertext_and_prints_no_token(monkeypatch, capsys):
    """proto/grant.py's callback: the state first (nothing exchanged on a mismatch), then the
    dev-login patron's grant stored as ciphertext through the store's own store_grant. The
    message names the patron and never a token."""
    import grant

    calls = _fake_fs(monkeypatch, access="access-plain-u3", refresh="refresh-plain-u3")
    store = FakeStore()
    bad = await grant.handle_callback({"code": ["c"], "state": ["other"]}, state="st", verifier="v",
                                      store=store, email="dev@localhost")
    assert bad[0] == 400 and calls == [] and store.grants == {}
    status, message = await grant.handle_callback({"code": ["code-9"], "state": ["st"]}, state="st",
                                                  verifier="v-9", store=store, email="Dev@Localhost")
    assert status == 200 and calls == ["exchange code-9 v-9"]
    user = next(u for u in store.users.values() if u.email == "dev@localhost")
    stored = store.grants[user.id]
    assert auth.decrypt(stored["access_token_enc"]) == "access-plain-u3"
    assert auth.decrypt(stored["refresh_token_enc"]) == "refresh-plain-u3"
    assert message == f"grant stored for dev@localhost (user {user.id})"
    for secret in ("access-plain-u3", "refresh-plain-u3", stored["access_token_enc"]):
        assert secret not in message and secret not in capsys.readouterr().out


def test_grant_script_points_the_redirect_at_the_dev_keys_registration(monkeypatch, capsys):
    """The dev key's only registered redirect is http://127.0.0.1:1837/callback."""
    import grant

    seen: dict[str, str] = {}

    def serve_once(port, on_callback):
        seen["redirect"] = auth.redirect_uri()
        return 400, "OAuth state mismatch"

    monkeypatch.setattr(grant, "serve_once", serve_once)
    monkeypatch.setattr(grant.webbrowser, "open", lambda url: seen.setdefault("url", url))
    assert grant.main(["--pg-dsn", "postgresql://unused"]) == 1
    assert seen["redirect"] == "http://127.0.0.1:1837/callback"
    assert "redirect_uri=http%3A%2F%2F127.0.0.1%3A1837%2Fcallback" in seen["url"]


# ── #3992: sign-in with the chat off ────────────────────────────────────────────


@pytest.fixture
def chat_off(fs_on):
    fs_on.setenv("GENEALOGY_CHAT", "false")
    return fs_on


async def _login(c: httpx.AsyncClient) -> tuple[str, str]:
    """``/auth/familysearch/login`` -> (the state FamilySearch would echo, the state cookie)."""
    r = await c.get("/auth/familysearch/login")
    assert r.status_code in (302, 307), r.text
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    return state, r.cookies[auth.FS_OAUTH_COOKIE]


def _app_client(store: FakeStore) -> tuple[Any, httpx.AsyncClient]:
    application = create_app(store, FakeQueue())
    return application, httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t")


async def _sign_in(c: httpx.AsyncClient, state: str, oauth: str) -> httpx.Response:
    c.cookies.set(auth.FS_OAUTH_COOKIE, oauth)
    return await c.get("/callback", params={"code": "code-1", "state": state})


def _signed_at(monkeypatch, uid: str, seconds_ago: float) -> str:
    """A session cookie whose signature (the timestamp itsdangerous checks ``max_age``
    against, not the payload's ``iat``) was made ``seconds_ago``."""
    real = time.time
    monkeypatch.setattr(time, "time", lambda: real() - seconds_ago)
    try:
        return auth.session_cookie_value(uid)
    finally:
        monkeypatch.setattr(time, "time", real)


@pytest.mark.parametrize("chat, age, status", [
    ("false", auth.SESSION_MAX_AGE_NO_CHAT_S - 60, 200),
    ("false", auth.SESSION_MAX_AGE_NO_CHAT_S + 1, 401),
    ("true", auth.SESSION_MAX_AGE_NO_CHAT_S + 1, 200),
    ("true", auth.SESSION_MAX_AGE_CHAT_S + 1, 401),
])
async def test_the_session_ends_at_24_hours_with_the_chat_off_on_the_server(monkeypatch, chat, age, status):
    """The signature check ends the session, so a captured cookie dies at 24 h whatever its
    Max-Age said; with the chat on, 30 days as before."""
    monkeypatch.setenv("GENEALOGY_CHAT", chat)
    cookie = _signed_at(monkeypatch, USER_A.id, age)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(FakeStore(), FakeQueue())),
                                 base_url="http://t", cookies={auth.COOKIE_NAME: cookie}) as c:
        assert (await c.get("/auth/me")).status_code == status


def _max_age(r: httpx.Response) -> int:
    header = next(h for h in r.headers.get_list("set-cookie") if h.startswith(auth.COOKIE_NAME + "="))
    return int(next(p.split("=", 1)[1] for p in header.split("; ") if p.lower().startswith("max-age=")))


@pytest.mark.parametrize("chat, expected", [("false", auth.SESSION_MAX_AGE_NO_CHAT_S),
                                            ("true", auth.SESSION_MAX_AGE_CHAT_S)])
async def test_the_cookie_max_age_follows_the_chat_switch(monkeypatch, fs_on, chat, expected):
    fs_on.setenv("GENEALOGY_CHAT", chat)
    _fake_fs(fs_on)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    _app, c = _app_client(store)
    async with c:
        state, oauth = await _login(c)
        r = await _sign_in(c, state, oauth)
    assert r.status_code in (302, 307), r.text
    assert _max_age(r) == expected


@pytest.mark.parametrize("chat, expected", [("false", auth.SESSION_MAX_AGE_NO_CHAT_S),
                                            ("true", auth.SESSION_MAX_AGE_CHAT_S)])
async def test_dev_login_cookie_max_age_follows_the_chat_switch(monkeypatch, chat, expected):
    monkeypatch.setenv("GENEALOGY_CHAT", chat)
    async with _client(FakeStore()) as c:
        r = await c.post("/auth/dev-login", json={"email": "dev@example.org"})
    assert _max_age(r) == expected


@pytest.mark.parametrize("chat, scope", [("false", None), ("true", ["offline_access"])])
async def test_the_scope_carries_offline_access_only_with_the_chat_on(fs_on, chat, scope):
    fs_on.setenv("GENEALOGY_CHAT", chat)
    async with _client(FakeStore()) as c:
        r = await c.get("/auth/familysearch/login")
    assert parse_qs(urlparse(r.headers["location"]).query).get("scope") == scope


async def test_chat_off_login_records_the_state_and_a_sign_in_consumes_it(chat_off):
    calls = _fake_fs(chat_off)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    _app, c = _app_client(store)
    async with c:
        state, oauth = await _login(c)
        assert store.signin_states == {auth.state_sha256(state): None}
        r = await _sign_in(c, state, oauth)
    assert r.status_code in (302, 307), r.text
    assert store.signin_states[auth.state_sha256(state)] is not None, "the record is used"
    assert len(calls) == 2


async def test_chat_off_a_replayed_callback_is_refused_before_any_familysearch_call(chat_off):
    calls = _fake_fs(chat_off)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    _app, c = _app_client(store)
    async with c:
        state, oauth = await _login(c)
        assert (await _sign_in(c, state, oauth)).status_code in (302, 307)
        grants_before = dict(store.grants)
        calls.clear()
        r = await _sign_in(c, state, oauth)
    assert r.status_code == 400 and "already used" in r.text
    assert calls == [], "a used state is refused before the code exchange"
    assert store.grants == grants_before and auth.COOKIE_NAME not in r.cookies


async def test_chat_off_a_state_with_no_record_is_refused(chat_off):
    """A signed cookie alone is not enough with the chat off: the record must exist."""
    calls = _fake_fs(chat_off)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    r = await _callback(store)
    assert r.status_code == 400 and calls == [] and store.grants == {}


async def test_chat_on_needs_no_state_record(fs_on):
    _fake_fs(fs_on)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    assert (await _callback(store)).status_code in (302, 307)
    assert store.signin_states == {}


# -- the sign-in budget --


def test_the_budget_takes_both_units_or_neither_in_a_sliding_minute():
    now = [100.0]
    budget = auth.SigninBudget(3, clock=lambda: now[0])
    assert budget.try_take(2)
    assert not budget.try_take(2), "two more would make four"
    assert budget.try_take(1), "the refused take took nothing"
    assert not budget.try_take(1)
    now[0] += 59.9
    assert not budget.try_take(1)
    now[0] += 0.1
    assert budget.try_take(2) and budget.try_take(1)


@pytest.mark.parametrize("value", ["0", "1", "-2", "abc", "2.5", "1_000"])
def test_preflight_refuses_a_bad_signin_budget(monkeypatch, value):
    monkeypatch.setenv("GENEALOGY_SIGNIN_CALLS_PER_MINUTE", value)
    with pytest.raises(RuntimeError, match="GENEALOGY_SIGNIN_CALLS_PER_MINUTE"):
        auth.preflight()


@pytest.mark.parametrize("value, limit", [("", None), ("2", 2), ("30", 30)])
def test_the_signin_budget_is_off_unless_set(monkeypatch, value, limit):
    monkeypatch.setenv("GENEALOGY_SIGNIN_CALLS_PER_MINUTE", value)
    auth.preflight()
    budget = create_app(FakeStore(), FakeQueue()).state.signin_budget
    assert (budget.limit if budget else None) == limit


@pytest.mark.parametrize("case", ["mismatch", "no-record", "used"])
async def test_a_bad_state_leaves_the_budget_untouched(chat_off, case):
    chat_off.setenv("GENEALOGY_SIGNIN_CALLS_PER_MINUTE", "2")
    calls = _fake_fs(chat_off)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    application, c = _app_client(store)
    async with c:
        state, oauth = await _login(c)
        if case == "mismatch":
            r = await _sign_in(c, "other-state", oauth)
        elif case == "no-record":
            store.signin_states.clear()
            r = await _sign_in(c, state, oauth)
        else:
            store.signin_states[auth.state_sha256(state)] = datetime.now(tz=timezone.utc)
            r = await _sign_in(c, state, oauth)
        assert r.status_code == 400 and calls == []
        assert len(application.state.signin_budget._taken) == 0, "the budget was touched"
        if case == "mismatch":
            assert (await _sign_in(c, state, oauth)).status_code in (302, 307), "both units are still there"


async def test_past_the_budget_the_callback_answers_503_and_keeps_the_state(chat_off):
    chat_off.setenv("GENEALOGY_SIGNIN_CALLS_PER_MINUTE", "2")
    calls = _fake_fs(chat_off)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    application, c = _app_client(store)
    now = [1000.0]
    application.state.signin_budget._clock = lambda: now[0]
    async with c:
        first, first_oauth = await _login(c)
        assert (await _sign_in(c, first, first_oauth)).status_code in (302, 307)
        second, second_oauth = await _login(c)
        calls.clear()
        r = await _sign_in(c, second, second_oauth)
        assert r.status_code == 503 and "busy" in r.text
        assert calls == [], "no FamilySearch call past the budget"
        assert store.signin_states[auth.state_sha256(second)] is None, "the state record is not consumed"
        assert not any(h.startswith(auth.FS_OAUTH_COOKIE + "=") for h in r.headers.get_list("set-cookie")), \
            "the fs_oauth cookie is not deleted, so a reload retries"
        now[0] += 60
        assert (await _sign_in(c, second, second_oauth)).status_code in (302, 307), "a reload retries"


async def test_the_budget_applies_with_the_chat_on_too(fs_on):
    fs_on.setenv("GENEALOGY_SIGNIN_CALLS_PER_MINUTE", "2")
    _fake_fs(fs_on)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    _app, c = _app_client(store)
    async with c:
        for expected in ((302, 307), (503,)):
            state, oauth = await _login(c)
            assert (await _sign_in(c, state, oauth)).status_code in expected


# -- the redirect setting --


def test_the_redirect_defaults_to_the_public_urls_callback(monkeypatch):
    assert auth.redirect_uri() == "http://127.0.0.1:8085/callback"
    assert auth.callback_path() == "/callback"


async def test_the_redirect_setting_moves_the_request_and_the_route(fs_on):
    fs_on.setenv("FS_REDIRECT_URI", "http://127.0.0.1:1837/fs/return")
    calls = _fake_fs(fs_on)
    store = FakeStore()
    store.allowed = {"a@example.org"}
    async with _client(store) as c:
        r = await c.get("/auth/familysearch/login")
        assert parse_qs(urlparse(r.headers["location"]).query)["redirect_uri"] == ["http://127.0.0.1:1837/fs/return"]
        assert auth.redirect_uri() == "http://127.0.0.1:1837/fs/return", "exchange_code sends the same value"
        c.cookies.set(auth.FS_OAUTH_COOKIE, auth.oauth_state_cookie("v", "st", None))
        assert (await c.get("/callback", params={"code": "c", "state": "st"})).status_code == 404
        assert (await c.get("/fs/return", params={"code": "c", "state": "st"})).status_code in (302, 307)
    assert len(calls) == 2


@pytest.mark.parametrize("public, redirect, path", [
    ("https://edge.test/pf", "https://edge.test/pf/cb", "/cb"),
    ("https://edge.test/pf", "https://edge.test/pfx/cb", "/pfx/cb"),
    ("https://edge.test/pf", "http://127.0.0.1:1837/callback", "/callback"),
    ("https://edge.test", "https://edge.test/a/b", "/a/b"),
])
def test_the_callback_path_strips_the_prefix_only_on_a_segment(monkeypatch, public, redirect, path):
    monkeypatch.setenv("PUBLIC_URL", public)
    monkeypatch.setenv("FS_REDIRECT_URI", redirect)
    assert auth.callback_path() == path


@pytest.mark.parametrize("redirect", [
    "callback", "/callback", "ftp://edge.test/cb", "https://edge.test", "https://edge.test/",
    "https://edge.test/cb?x=1", "https://edge.test/cb#f", "https:///cb",
    "https://edge.test/cb/", "https://edge.test/fs%20return", "https://edge.test//cb",
])
def test_preflight_refuses_a_bad_redirect_setting(monkeypatch, redirect):
    monkeypatch.setenv("FS_REDIRECT_URI", redirect)
    with pytest.raises(RuntimeError, match="FS_REDIRECT_URI"):
        auth.preflight()


def test_preflight_refuses_a_redirect_at_the_prefix_itself(monkeypatch):
    """The edge strips the prefix, so a callback at the prefix would arrive at ``/``, the SPA."""
    monkeypatch.setenv("PUBLIC_URL", "https://edge.test/pf")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    monkeypatch.setenv("FS_REDIRECT_URI", "https://edge.test/pf")
    with pytest.raises(RuntimeError, match="FS_REDIRECT_URI"):
        auth.preflight()


# -- users keyed by FamilySearch id --


async def test_a_returning_user_whose_email_changed_keeps_their_account(fs_on):
    store = FakeStore()
    store.allowed = {"a@example.org", "new@example.org"}
    _fake_fs(fs_on, email="a@example.org")
    assert (await _callback(store)).status_code in (302, 307)
    user_id = next(u.id for u in store.users.values() if u.email == "a@example.org")
    _fake_fs(fs_on, email="new@example.org")
    r = await _callback(store)
    assert r.status_code in (302, 307), r.text
    assert auth.read_session_cookie(r.cookies.get(auth.COOKIE_NAME))["uid"] == user_id
    assert store.users[user_id].email == "new@example.org"
    assert not any(u.email == "a@example.org" for u in store.users.values())


async def test_a_new_email_another_user_holds_is_refused_and_writes_nothing(fs_on):
    store = FakeStore()
    store.allowed = {"a@example.org", USER_B.email}
    _fake_fs(fs_on, email="a@example.org")
    assert (await _callback(store)).status_code in (302, 307)
    users_before, grants_before = dict(store.users), dict(store.grants)
    _fake_fs(fs_on, email=USER_B.email)
    r = await _callback(store)
    assert r.status_code == 403 and "already belongs to another user" in r.text
    assert store.users == users_before and store.grants == grants_before
    assert auth.COOKIE_NAME not in r.cookies


async def test_an_identity_with_no_email_is_refused_and_writes_nothing(fs_on):
    _fake_fs(fs_on, email="")
    store = FakeStore()
    users_before = dict(store.users)
    r = await _callback(store)
    assert r.status_code == 403 and "no email" in r.text
    assert store.users == users_before and store.grants == {}
