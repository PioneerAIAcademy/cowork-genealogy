"""#4001: the chat-off tier's ``/``, signed out (onboarding) and signed in (account,
projects, OpenRouter). Offline, on ``FakeStore``. Which paths exist with the chat on or off
is ``test_proto_admission.py``'s; the ``next`` shapes ``SAFE_NEXT_RE`` admits are
``test_proto_auth.py``'s.
"""

from __future__ import annotations

import asyncio
from urllib.parse import parse_qs, urlsplit

import pytest

from tests.test_proto_auth import _fake_fs
from tests.test_proto_web import AUTH_ENV, USER_A, FakeStore, make_client
from web import auth, pages

UPLOAD = "upload/proj_0123456789abcdef"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in AUTH_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DEV_LOGIN", "true")
    monkeypatch.setenv("GENEALOGY_CHAT", "false")


def _store_with(projects: dict[str, dict | None]) -> FakeStore:
    """USER_A owns each project; a None value is a claimed id with no research.json."""
    store = FakeStore()
    for pid, project in projects.items():
        store.owners[pid] = USER_A.id
        if project is not None:
            store.docs[pid] = {"research.json": (1, {"project": project})}
    return store


async def _home(store: FakeStore, *, user: str | None = USER_A.id):
    async with make_client(store, None, user=user) as c:
        return await c.get("/")


# ── signed out ──────────────────────────────────────────────────────────────────


async def test_signed_out_is_the_onboarding_and_holds_no_account_data(monkeypatch):
    monkeypatch.setenv("PUBLIC_URL", "https://beta.example/gr")
    r = await _home(FakeStore(), user=None)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert "Get started" in r.text and "Do not store information about living people" in r.text
    assert auth.deletion_code(USER_A.id) not in r.text and "Deletion code" not in r.text
    assert r.headers["cache-control"] == "private, no-store" and "cookie" in r.headers["vary"].lower()


def test_connector_link_names_the_server_and_points_at_this_tiers_mcp():
    url = pages.connector_link("https://beta.example/gr/")
    parts = urlsplit(url)
    assert (parts.scheme, parts.netloc, parts.path) == ("https", "claude.ai", "/customize/connectors")
    assert parse_qs(parts.query) == {
        "modal": ["add-custom-connector"],
        "connectorName": ["Genealogy Research"],
        "connectorUrl": ["https://beta.example/gr/mcp"],
    }


@pytest.mark.parametrize(("fs", "dev", "expect", "absent"), [
    (True, "false", 'href="auth/familysearch/login"', "auth/dev-login"),
    (False, "true", "auth/dev-login", "auth/familysearch/login"),
    (False, "false", "Sign-in is not configured", "auth/"),
])
async def test_signed_out_step_two_follows_the_sign_in_that_is_on(monkeypatch, fs, dev, expect, absent):
    monkeypatch.setenv("DEV_LOGIN", dev)
    if fs:
        monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
        monkeypatch.setenv("WEB_ORIGIN", "http://spa.test")
        monkeypatch.setenv("SESSION_SECRET", "s" * 32)
        monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    r = await _home(FakeStore(), user=None)
    assert r.status_code == 200
    assert expect in r.text and absent not in r.text


# ── signed in ───────────────────────────────────────────────────────────────────


async def test_signed_in_names_the_account_and_lists_the_callers_projects():
    store = _store_with({"proj_title": {"title": "Ugo Stella"}, "proj_bare": None})
    store.owners["proj_other"] = "usr_b"
    r = await _home(store)
    assert r.status_code == 200
    assert USER_A.email in r.text and 'say "continue"' in r.text
    assert USER_A.id in r.text and auth.deletion_code(USER_A.id) in r.text
    assert "Ugo Stella" in r.text and 'href="api/projects/proj_title/download"' in r.text
    assert "Untitled project" in r.text and 'href="api/projects/proj_bare/download"' in r.text
    assert "proj_other" not in r.text
    assert r.headers["cache-control"] == "private, no-store" and "cookie" in r.headers["vary"].lower()


async def test_signed_in_points_back_to_the_setup_steps():
    """Signed in before finishing setup, a patron no longer sees the steps; the page says
    how to get them back."""
    r = await _home(FakeStore())
    assert "Sign out to see the setup steps" in r.text and "Get started" not in r.text


async def test_signed_in_with_no_projects_says_so():
    r = await _home(FakeStore())
    assert r.status_code == 200 and "No projects yet" in r.text


async def test_a_project_label_is_escaped():
    """A label comes from agent-written research.json, on the page with the deletion code."""
    store = _store_with({"proj_x": {"title": '<script>alert("x")</script>&'}})
    r = await _home(store)
    assert "<script>alert" not in r.text
    assert "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;" in r.text


async def test_the_email_and_familysearch_id_are_escaped():
    store = FakeStore()
    store.users[USER_A.id] = store.users[USER_A.id].__class__(
        USER_A.id, "<b>a</b>@example.org", familysearch_id="<i>FS</i>")
    r = await _home(store)
    assert "<b>a</b>" not in r.text and "&lt;b&gt;a&lt;/b&gt;@example.org" in r.text
    assert "<i>FS</i>" not in r.text and "&lt;i&gt;FS&lt;/i&gt;" in r.text


@pytest.mark.parametrize("how", ["blocked", "revoked"])
async def test_a_refused_session_gets_no_account_page(how):
    store = FakeStore()
    async with make_client(store, None) as c:
        assert auth.deletion_code(USER_A.id) in (await c.get("/")).text, "control"
        if how == "blocked":
            store.block(USER_A.id)
        else:
            await asyncio.sleep(1.1)  # the cookie's iat is whole seconds
            await store.revoke_sessions(USER_A.id)
        r = await c.get("/")
    assert auth.deletion_code(USER_A.id) not in r.text
    if how == "blocked":
        assert r.status_code == 403 and "Account blocked" in r.text
    else:
        assert r.status_code == 200 and "Get started" in r.text


@pytest.mark.parametrize("path", ["/privacy", "/terms"])
async def test_the_deletion_code_is_on_no_other_page(path):
    async with make_client(FakeStore(), None) as c:
        assert auth.deletion_code(USER_A.id) not in (await c.get(path)).text


# ── OpenRouter ──────────────────────────────────────────────────────────────────


async def test_no_openrouter_section_with_linking_off():
    r = await _home(FakeStore())
    assert "OpenRouter" not in r.text and "openrouter/" not in r.text


@pytest.mark.parametrize("linked", [False, True])
async def test_openrouter_section_with_linking_on(monkeypatch, linked):
    monkeypatch.setenv("OPENROUTER_LINKING_ENABLED", "true")
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    store = FakeStore()
    if linked:
        store.openrouter_keys[USER_A.id] = auth.encrypt("sk-or-v1-secret")
    r = await _home(store)
    assert r.status_code == 200
    assert pages.OPENROUTER_KEYS_URL in r.text and "no spending limit" in r.text
    assert "sk-or-v1-secret" not in r.text
    if linked:
        assert "openrouter/unlink" in r.text and 'href="openrouter/link"' not in r.text
    else:
        assert 'href="openrouter/link"' in r.text and "openrouter/unlink" not in r.text


async def test_a_key_under_another_enc_key_reads_as_unlinked(monkeypatch):
    monkeypatch.setenv("OPENROUTER_LINKING_ENABLED", "true")
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "j" * 32)
    store = FakeStore()
    store.openrouter_keys[USER_A.id] = auth.encrypt("sk-or-v1-secret")
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    r = await _home(store)
    assert 'href="openrouter/link"' in r.text


# ── the SPA and the sign-in round trip ──────────────────────────────────────────


async def test_chat_off_serves_the_page_over_an_spa_build(monkeypatch, tmp_path):
    (tmp_path / "index.html").write_text("<html>SPA BUILD</html>", encoding="utf-8")
    monkeypatch.setenv("WEB_DIST_DIR", str(tmp_path))
    r = await _home(FakeStore(), user=None)
    assert r.status_code == 200 and "Get started" in r.text and "SPA BUILD" not in r.text


def _fs_on(monkeypatch, origin: str) -> None:
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    monkeypatch.setenv("WEB_ORIGIN", origin)
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    _fake_fs(monkeypatch)


async def _sign_in(c, next_route: str | None = None):
    """The chat-off round trip on one client: /auth/familysearch/login (which records the
    single-use state, #3992, and signs ``next`` into the state cookie), then the callback
    with the state FamilySearch would carry back."""
    login = await c.get("/auth/familysearch/login", params={"next": next_route} if next_route else None)
    assert login.status_code in (302, 307), login.text
    state = parse_qs(urlsplit(login.headers["location"]).query)["state"][0]
    return await c.get("/callback", params={"code": "code-1", "state": state})


async def test_a_sign_in_started_from_an_upload_link_returns_to_it(monkeypatch):
    _fs_on(monkeypatch, "http://spa.test")
    store = FakeStore()
    store.allowed = {"a@example.org"}
    async with make_client(store, None, user=None) as c:
        r = await _sign_in(c, UPLOAD)
    assert r.status_code in (302, 307), r.text
    assert r.headers["location"] == f"http://spa.test/{UPLOAD}"


async def test_a_sign_in_from_the_landing_page_ends_on_it(monkeypatch):
    """Done-when: with chat off and WEB_DIST_DIR blank, a sign-in lands on the signed-in page."""
    _fs_on(monkeypatch, "http://t")
    store = FakeStore()
    store.allowed = {"a@example.org"}
    async with make_client(store, None, user=None) as c:
        r = await _sign_in(c)
        assert r.status_code in (302, 307) and urlsplit(r.headers["location"]).path == "/", r.text
        page = await c.get("/")
    assert page.status_code == 200 and "You're signed in" in page.text
