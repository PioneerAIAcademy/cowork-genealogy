"""#4001: the chat-off tier's ``/``, signed out (onboarding) and signed in (account,
projects, OpenRouter). Offline, on ``FakeStore``. Which paths exist with the chat on or off
is ``test_proto_admission.py``'s; the ``next`` shapes ``SAFE_NEXT_RE`` admits are
``test_proto_auth.py``'s.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from tests.test_proto_auth import _fake_fs
from tests.test_proto_web import AUTH_ENV, USER_A, FakeStore, make_client
from web import auth, pages
from web.app import create_app

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


def test_connector_link_names_the_server_and_points_at_the_hosts_mcp():
    """The edge serves /mcp at the host root, so a PUBLIC_URL path prefix is dropped."""
    url = pages.connector_link("https://beta.example/gr/")
    parts = urlsplit(url)
    assert (parts.scheme, parts.netloc, parts.path) == ("https", "claude.ai", "/customize/connectors")
    assert parse_qs(parts.query) == {
        "modal": ["add-custom-connector"],
        "connectorName": ["Genealogy Research"],
        "connectorUrl": ["https://beta.example/mcp"],
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
    assert f"Signed in as {USER_A.email}." in r.text and 'say "continue"' in r.text
    assert "FamilySearch account" not in r.text, "USER_A has no FamilySearch id (a dev-login user)"
    assert USER_A.id in r.text and auth.deletion_code(USER_A.id) in r.text
    assert "Ugo Stella" in r.text and 'href="api/projects/proj_title/download"' in r.text
    assert "Untitled project" in r.text and 'href="api/projects/proj_bare/download"' in r.text
    assert "proj_other" not in r.text
    assert r.headers["cache-control"] == "private, no-store" and "cookie" in r.headers["vary"].lower()


async def test_signed_in_keeps_the_setup_steps_on_the_page():
    """Signed in before finishing setup, a patron still has the steps, folded away. Never
    "sign out to see them": once sign-out ends the connector's tokens too, that undoes step 1."""
    r = await _home(FakeStore())
    assert "<summary>Setup steps</summary>" in r.text and "Get started" not in r.text
    assert "Add the custom connector in Claude" in r.text and "Install the plugin once" in r.text
    assert "Sign out to see" not in r.text


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


async def test_the_email_is_escaped_with_no_familysearch_id():
    store = FakeStore()
    store.users[USER_A.id] = store.users[USER_A.id].__class__(USER_A.id, "<b>a</b>@example.org")
    r = await _home(store)
    assert "<b>a</b>" not in r.text and "Signed in as &lt;b&gt;a&lt;/b&gt;@example.org." in r.text


async def test_a_refused_page_escapes_the_email():
    store = FakeStore()
    store.users[USER_A.id] = store.users[USER_A.id].__class__(USER_A.id, "<b>a</b>@example.org")
    store.block(USER_A.id)
    r = await _home(store)
    assert r.status_code == 403
    assert "<b>a</b>" not in r.text and "&lt;b&gt;a&lt;/b&gt;@example.org" in r.text


def test_the_connector_name_is_the_extensions_name():
    """The agents list their tools under the extension's display_name, so the name the
    page tells a patron to keep must be that one."""
    manifest = Path(__file__).resolve().parents[3] / "packages" / "engine" / "mcp-server" / "manifest.json"
    assert pages.CONNECTOR_NAME == json.loads(manifest.read_text(encoding="utf-8"))["display_name"]


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
        assert r.status_code == 403 and "The FamilySearch account a@example.org is blocked. Ask the administrator." in r.text
        assert "auth/logout" in r.text, "a way out: sign out and use another account"
    else:
        assert r.status_code == 200 and "Get started" in r.text


async def test_an_account_off_the_allowlist_is_told_what_to_do(monkeypatch):
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    monkeypatch.setenv("WEB_ORIGIN", "http://t")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    store = FakeStore()
    store.allowed = set()
    r = await _home(store)
    assert r.status_code == 403
    assert "The FamilySearch account a@example.org is not on the allowlist. Ask the administrator to add this exact address" in r.text
    assert auth.deletion_code(USER_A.id) not in r.text and "auth/logout" in r.text


async def test_not_ready_is_a_wait_not_a_refusal(monkeypatch):
    """The allowlist has not loaded: a 503 that says to wait, with no Sign out, since
    signing out revokes every session for a condition that clears in seconds."""
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    monkeypatch.setenv("WEB_ORIGIN", "http://t")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    application = create_app(FakeStore(), None, poll_s=0.0, ping_s=0.0)
    application.state.startup = {"schema": "ok", "allowlist": "pending"}
    cookies = {auth.COOKIE_NAME: auth.session_cookie_value(USER_A.id)}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t",
                                 cookies=cookies) as c:
        r = await c.get("/")
    assert r.status_code == 503 and "isn't ready yet" in r.text and "Reload this page in a minute." in r.text
    assert "auth/logout" not in r.text and auth.deletion_code(USER_A.id) not in r.text


async def test_a_familysearch_user_is_named_as_one():
    store = FakeStore()
    store.users[USER_A.id] = store.users[USER_A.id].__class__(USER_A.id, USER_A.email, familysearch_id="MMSW-0001")
    r = await _home(store)
    assert f"Signed in with the FamilySearch account {USER_A.email} (FamilySearch id" in r.text


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
    async with make_client(FakeStore(), None, user=None) as c:
        head = await c.head("/")
    # By length, not cache headers: the cache middleware marks any answer for / no-store.
    assert head.status_code == 200 and head.headers["content-length"] == str(len(r.content)), "HEAD / is ours too"


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


# ── the upload page and pdf.js (PR 2) ───────────────────────────────────────────

PID = "proj_0123456789abcdef"
PDFJS = Path(__file__).resolve().parent.parent / "proto" / "web" / "static" / "pdfjs"


@pytest.fixture
def uploads_on(monkeypatch):
    monkeypatch.setenv("UPLOADS_ENABLED", "true")


async def test_uploads_off_hides_the_links_and_the_page():
    store = _store_with({PID: {"title": "Ugo"}})
    async with make_client(store, None) as c:
        home = await c.get("/")
        page = await c.get(f"/upload/{PID}")
    assert "Upload a file" not in home.text and f"upload/{PID}" not in home.text
    assert page.status_code == 404 and "Project not found" in page.text, "the HTML 404 page, not JSON"


async def test_uploads_on_links_each_project_to_its_page(uploads_on):
    store = _store_with({PID: {"title": "Ugo"}})
    r = await _home(store)
    assert f'href="upload/{PID}"' in r.text


async def test_a_project_the_upload_page_would_refuse_gets_no_upload_link(uploads_on):
    """A seeded or demo id is not the minted shape, so its upload page is a 404."""
    store = _store_with({PID: {"title": "Ugo"}, "proj_seed_1910": {"title": "Seed"}})
    r = await _home(store)
    assert f'href="upload/{PID}"' in r.text and 'href="upload/proj_seed_1910"' not in r.text
    assert 'href="api/projects/proj_seed_1910/download"' in r.text, "the download stays"


async def test_the_owner_gets_the_upload_page(uploads_on):
    store = _store_with({PID: {"title": "<b>Ugo</b>"}})
    async with make_client(store, None) as c:
        r = await c.get(f"/upload/{PID}")
    assert r.status_code == 200 and "Upload a file" in r.text
    assert "&lt;b&gt;Ugo&lt;/b&gt;" in r.text and "<b>Ugo</b>" not in r.text
    assert f'data-project="{PID}"' in r.text
    assert 'new URL("../pdfjs/", location.href)' in r.text and "../api/projects/${project}/files" in r.text
    assert 'const PDFJS_VERSION = "6.4.299"' in r.text, "pdf.js is loaded by a versioned URL"
    assert 'href="../privacy"' in r.text, "links step up from /upload/<id>"
    assert r.headers["cache-control"] == "private, no-store" and "cookie" in r.headers["vary"].lower()
    assert auth.deletion_code(USER_A.id) not in r.text


async def test_a_missing_and_a_foreign_project_get_the_same_404(uploads_on):
    store = FakeStore()
    store.owners["proj_00000000000000bb"] = "usr_b"
    async with make_client(store, None) as c:
        foreign = await c.get("/upload/proj_00000000000000bb")
        missing = await c.get("/upload/proj_00000000000000cc")
    assert foreign.status_code == missing.status_code == 404
    assert foreign.text == missing.text and "Project not found" in foreign.text


@pytest.mark.parametrize("pid", ["proj_1", "PROJ_0123456789abcdef", "proj_0123456789ABCDEF", "x"])
async def test_an_id_outside_the_minted_shape_is_a_404_before_any_cookie(uploads_on, pid):
    async with make_client(FakeStore(), None, user=None) as c:
        r = await c.get(f"/upload/{pid}")
    assert r.status_code == 404 and "location" not in r.headers


async def test_signed_out_goes_to_familysearch_and_returns_to_the_page(monkeypatch, uploads_on):
    """Done-when: a signed-out browser on an upload link signs in and returns to it."""
    _fs_on(monkeypatch, "http://t")
    store = FakeStore()
    store.allowed = {"a@example.org"}
    async with make_client(store, None, user=None) as c:
        first = await c.get(f"/upload/{PID}")
        assert first.status_code == 303
        assert first.headers["location"] == f"/auth/familysearch/login?next=upload/{PID}"
        r = await _sign_in(c, f"upload/{PID}")
        assert r.status_code in (302, 307) and urlsplit(r.headers["location"]).path == f"/upload/{PID}", r.text
        uid = next(u.id for u in store.users.values() if u.email == "a@example.org")
        store.owners[PID] = uid
        page = await c.get(f"/upload/{PID}")
    assert page.status_code == 200 and "Upload a file" in page.text


async def test_signed_out_with_no_familysearch_goes_to_the_landing_page(uploads_on):
    async with make_client(FakeStore(), None, user=None) as c:
        r = await c.get(f"/upload/{PID}")
    assert r.status_code == 303 and r.headers["location"] == "/"


async def test_a_blocked_user_gets_the_refusal_on_the_upload_page(uploads_on):
    store = _store_with({PID: None})
    store.block(USER_A.id)
    async with make_client(store, None) as c:
        r = await c.get(f"/upload/{PID}")
    assert r.status_code == 403 and "is blocked" in r.text and "Upload a file" not in r.text
    # Served from /upload/<id>: Sign out and the footer step up to the tier's root, and Sign
    # out lands there, since reloading /upload/<id> signed out would go round sign-in again.
    assert "postAndReload('../auth/logout', null, '../')" in r.text and 'href="../privacy"' in r.text


@pytest.mark.parametrize("name", ["pdf.min.mjs", "pdf.worker.min.mjs"])
async def test_pdfjs_is_served_from_the_tier(name):
    async with make_client(FakeStore(), None, user=None) as c:
        r = await c.get(f"/pdfjs/{name}?v=6.4.299")
        head = await c.head(f"/pdfjs/{name}")
        old = await c.get(f"/static/pdfjs/{name}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/javascript")
    assert r.content == (PDFJS / name).read_bytes()
    assert head.status_code == 200 and head.headers["content-length"] == str(len(r.content))
    assert old.status_code == 404, "not under /static/, which Beanstalk's nginx keeps for itself"


@pytest.mark.parametrize("name", ["README.md", "LICENSE", "..%2Fapp.py", "pdf.mjs"])
async def test_only_the_two_pdfjs_files_are_served(name):
    async with make_client(FakeStore(), None, user=None) as c:
        r = await c.get(f"/pdfjs/{name}")
    assert r.status_code == 404


async def test_pdfjs_cmaps_are_served_from_the_tier():
    name = "Adobe-Japan1-UCS2.bcmap"
    async with make_client(FakeStore(), None, user=None) as c:
        r = await c.get(f"/pdfjs/cmaps/{name}")
        head = await c.head(f"/pdfjs/cmaps/{name}")
    assert r.status_code == 200 and r.headers["content-type"] == "application/octet-stream"
    assert r.content == (PDFJS / "cmaps" / name).read_bytes()
    assert head.status_code == 200 and head.headers["content-length"] == str(len(r.content))


@pytest.mark.parametrize("name", ["LICENSE", "..%2F..%2Fapp.py", "NotARealCmap.bcmap"])
async def test_only_bcmap_files_are_served_from_cmaps(name):
    """#4448: LICENSE is vendored to disk for the bundle, but never in the HTTP allow-list --
    the same as the top-level static/pdfjs/LICENSE, which already 404s at /pdfjs/LICENSE."""
    async with make_client(FakeStore(), None, user=None) as c:
        r = await c.get(f"/pdfjs/cmaps/{name}")
    assert r.status_code == 404
