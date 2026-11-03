"""#3985: the web tier's chat switch, admission by user cap or allowlist, and /livez.

Offline, on ``FakeStore``; the cap's count-and-insert race against real Postgres is
``test_proto_admission_pg.py``. Settings (``web/auth.py``): ``GENEALOGY_CHAT`` unset/true is
today's tier, false drops the queue, the grant refresher and every ``/api/sessions`` route;
``GENEALOGY_MAX_USERS`` set admits by cap and ignores ``ALLOWED_EMAILS``. A blocked user is
refused in every mode.
"""

from __future__ import annotations

import asyncio
import re

import httpx
import pytest

from tests.test_proto_auth import _callback, _fake_fs
from web.app import AdmissionBusy
from tests.test_proto_web import (
    AUTH_ENV, USER_A, FakeQueue, FakeStore, RefreshingStore, _per_project_routes, _project_path, make_client,
)
from web import auth
from web.app import create_app


@pytest.fixture(autouse=True)
def _clean_auth_env(monkeypatch):
    for name in AUTH_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DEV_LOGIN", "true")


@pytest.fixture
def fs_on(monkeypatch):
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    monkeypatch.setenv("WEB_ORIGIN", "http://spa.test")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    return monkeypatch


def _app_client(application) -> httpx.AsyncClient:
    cookies = {auth.COOKIE_NAME: auth.session_cookie_value(USER_A.id)}
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t", cookies=cookies)


# ── preflight ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("name", "value"), [
    ("GENEALOGY_CHAT", "flase"), ("GENEALOGY_CHAT", "0"),
    ("GENEALOGY_MAX_USERS", "0"), ("GENEALOGY_MAX_USERS", "-1"), ("GENEALOGY_MAX_USERS", "abc"),
    ("GENEALOGY_MAX_USERS", "2.5"), ("GENEALOGY_MAX_USERS", "1_000"), ("GENEALOGY_MAX_USERS", "+5"),
    ("GENEALOGY_MAX_USERS", "\u0665"),
])
def test_preflight_refuses_a_bad_value_on_the_http_dev_tier_too(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(RuntimeError, match=re.escape(f"{name} is {value!r}")):
        auth.preflight()


@pytest.mark.parametrize(("chat", "cap"), [("", ""), ("true", "5"), ("FALSE", "1"), ("True", "")])
def test_preflight_accepts_the_good_values(monkeypatch, chat, cap):
    monkeypatch.setenv("GENEALOGY_CHAT", chat)
    monkeypatch.setenv("GENEALOGY_MAX_USERS", cap)
    auth.preflight()
    assert auth.chat_enabled() is (chat.lower() != "false")
    assert auth.max_users() == (int(cap) if cap else None)


def test_a_bad_chat_value_refuses_to_build_the_app(monkeypatch):
    monkeypatch.setenv("GENEALOGY_CHAT", "flase")
    with pytest.raises(RuntimeError, match="GENEALOGY_CHAT"):
        create_app(FakeStore(), FakeQueue())


# ── admission on every request ───────────────────────────────────────────────────


@pytest.mark.parametrize("mode", ["dev-login", "allowlist", "cap"])
async def test_a_blocked_users_existing_cookie_is_refused(monkeypatch, mode):
    if mode != "dev-login":
        monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    if mode == "cap":
        monkeypatch.setenv("GENEALOGY_MAX_USERS", "5")
    store = FakeStore()
    store.allowed = {USER_A.email}
    async with make_client(store, FakeQueue()) as c:
        assert (await c.get("/api/projects")).status_code == 200
        store.block(USER_A.id)
        r = await c.get("/api/projects")
    assert r.status_code == 403 and r.json() == {"detail": "Account blocked"}


async def test_cap_mode_reads_no_allowlist_and_has_no_allowlist_gate(fs_on):
    fs_on.setenv("GENEALOGY_MAX_USERS", "1")  # below the fake's two users: an existing one still passes
    store = FakeStore()
    store.allowed = set()

    async def is_allowed(email):
        raise AssertionError("cap mode must not read the allowlist")

    store.is_allowed = is_allowed
    application = create_app(store, FakeQueue())
    application.state.startup = {"allowlist": "pending"}
    async with _app_client(application) as c:
        r = await c.get("/api/projects")
    assert r.status_code == 200, r.text


async def test_allowlist_mode_still_gates_on_the_allowlist(fs_on):
    store = FakeStore()
    store.allowed = set()
    application = create_app(store, FakeQueue())
    async with _app_client(application) as c:
        assert (await c.get("/api/projects")).status_code == 403
        application.state.startup = {"allowlist": "pending"}
        assert (await c.get("/api/projects")).status_code == 503


# ── admission at sign-in ─────────────────────────────────────────────────────────


async def test_cap_mode_admits_a_new_user_with_an_empty_allowlist(fs_on):
    fs_on.setenv("ALLOWED_EMAILS", "")
    fs_on.setenv("GENEALOGY_MAX_USERS", "5")
    _fake_fs(fs_on, email="new@example.org")
    store = FakeStore()
    store.allowed = set()
    r = await _callback(store)
    assert r.status_code in (302, 307), r.text
    user = next(u for u in store.users.values() if u.email == "new@example.org")
    assert user.id in store.grants


async def test_cap_mode_refuses_a_new_user_at_the_cap_and_writes_nothing(fs_on):
    fs_on.setenv("GENEALOGY_MAX_USERS", "2")  # the fake starts with two users
    _fake_fs(fs_on, email="new@example.org")
    store = FakeStore()
    before = dict(store.users)
    r = await _callback(store)
    assert r.status_code == 403 and "user limit" in r.text
    assert store.users == before and store.grants == {}
    assert auth.COOKIE_NAME not in r.cookies


async def test_cap_mode_admits_an_existing_user_at_the_cap(fs_on):
    fs_on.setenv("GENEALOGY_MAX_USERS", "1")
    _fake_fs(fs_on, email=USER_A.email)
    store = FakeStore()
    r = await _callback(store)
    assert r.status_code in (302, 307), r.text
    assert USER_A.id in store.grants


@pytest.mark.parametrize("cap", ["", "5"])
async def test_a_blocked_user_is_refused_at_sign_in_and_nothing_is_written(fs_on, cap):
    fs_on.setenv("GENEALOGY_MAX_USERS", cap)
    _fake_fs(fs_on, email=USER_A.email)
    store = FakeStore()
    store.allowed = {USER_A.email}
    store.block(USER_A.id)
    r = await _callback(store)
    assert r.status_code == 403 and "is blocked" in r.text
    assert store.grants == {} and store.users[USER_A.id].familysearch_id is None
    assert auth.COOKIE_NAME not in r.cookies


async def _callback_on(application) -> httpx.Response:
    oauth = auth.oauth_state_cookie("verifier-1", "st", None)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t",
                                 cookies={auth.FS_OAUTH_COOKIE: oauth}) as c:
        return await c.get("/callback", params={"code": "code-1", "state": "st"})


async def test_a_busy_admission_lock_answers_503_and_writes_nothing(fs_on):
    fs_on.setenv("GENEALOGY_MAX_USERS", "5")
    _fake_fs(fs_on, email="new@example.org")
    store = FakeStore()

    async def upsert_user(email, familysearch_id, *, max_users=None):
        raise AdmissionBusy(email)

    store.upsert_user = upsert_user
    r = await _callback_on(create_app(store, FakeQueue()))
    assert r.status_code == 503 and "Sign-in is busy" in r.text
    assert store.grants == {} and auth.COOKIE_NAME not in r.cookies


async def test_the_callback_waits_for_the_allowlist_in_allowlist_mode_only(fs_on):
    _fake_fs(fs_on, email=USER_A.email)
    store = FakeStore()
    store.allowed = {USER_A.email}
    application = create_app(store, FakeQueue())
    application.state.startup = {"allowlist": "pending"}
    r = await _callback_on(application)
    assert r.status_code == 503 and "the allowlist has not loaded yet" in r.text
    assert store.grants == {}
    fs_on.setenv("GENEALOGY_MAX_USERS", "5")
    r = await _callback_on(application)
    assert r.status_code in (302, 307), r.text


async def test_cap_mode_with_an_empty_allowlist_starts_with_familysearch_on(fs_on):
    fs_on.setenv("ALLOWED_EMAILS", "")
    fs_on.setenv("GENEALOGY_MAX_USERS", "5")
    application = create_app(store=FakeStore(), queue=FakeQueue())
    async with application.router.lifespan_context(application):
        assert application.state.startup == {"allowlist": "ok"}


# ── the chat switch ──────────────────────────────────────────────────────────────


def test_chat_off_drops_a_queue_a_caller_passes(monkeypatch):
    monkeypatch.setenv("GENEALOGY_CHAT", "false")
    assert create_app(FakeStore(), FakeQueue()).state.queue is None


def test_chat_off_serves_no_session_route_and_keeps_the_rest(monkeypatch):
    paths = {getattr(r, "path", "") for r in create_app(FakeStore(), FakeQueue()).routes}
    assert any(p.startswith("/api/sessions") for p in paths), "control: chat on serves them"
    monkeypatch.setenv("GENEALOGY_CHAT", "false")
    paths = {getattr(r, "path", "") for r in create_app(FakeStore(), None).routes}
    assert not [p for p in paths if p.startswith("/api/sessions")]
    for kept in ("/api/projects", "/api/feedback", "/auth/me", "/callback", "/livez", "/api/health"):
        assert kept in paths, kept


@pytest.mark.parametrize(("method", "path"), _per_project_routes())
async def test_chat_off_project_routes_still_answer(monkeypatch, method, path):
    """The project routes share helpers with the session routes; with the chat off they must
    still be defined, so an owned project answers as it does with the chat on."""
    monkeypatch.setenv("GENEALOGY_CHAT", "false")
    store = FakeStore()
    store.owners["proj_a"] = USER_A.id
    async with make_client(store, None) as c:
        r = await c.request(method, _project_path(path, "proj_a"))
    assert r.status_code < 500 and r.status_code not in (401, 403), (method, path, r.status_code, r.text)


async def test_chat_off_starts_with_no_queue_and_no_refresher(monkeypatch):
    monkeypatch.setenv("GENEALOGY_CHAT", "false")
    monkeypatch.delenv("QUEUE_URL", raising=False)
    monkeypatch.setenv("FS_GRANT_REFRESH_INTERVAL_S", "0.01")
    monkeypatch.setenv("FS_GRANT_REFRESH_AGE_S", "0")
    store = RefreshingStore()
    application = create_app(store=store, queue=None)
    async with application.router.lifespan_context(application):
        await asyncio.sleep(0.1)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t") as c:
            health = (await c.get("/api/health")).json()
    assert store.due_calls == 0, "no refresher with the chat off"
    assert application.state.queue is None and health["queue"] is None


async def test_chat_on_still_needs_a_queue(monkeypatch):
    monkeypatch.delenv("QUEUE_URL", raising=False)
    application = create_app(store=FakeStore(), queue=None)
    with pytest.raises(RuntimeError, match="QUEUE_URL"):
        async with application.router.lifespan_context(application):
            pass


# ── /livez ───────────────────────────────────────────────────────────────────────


class ExplodingStore:
    """Armed after ``create_app``, which reads ``creds`` once while it builds (U29)."""

    armed = False

    def __getattr__(self, name):
        if not self.armed:
            return None
        raise AssertionError(f"/livez touched the store ({name})")


@pytest.mark.parametrize("chat", ["true", "false"])
async def test_livez_answers_without_a_store_or_a_cookie(monkeypatch, chat):
    monkeypatch.setenv("GENEALOGY_CHAT", chat)
    store = ExplodingStore()
    application = create_app(store=store, queue=None)
    store.armed = True
    application.state.startup = {"schema": "pending", "allowlist": "pending"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t") as c:
        r = await c.get("/livez")
    assert r.status_code == 200 and r.json() == {"ok": True}
