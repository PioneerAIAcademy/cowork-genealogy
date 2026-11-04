"""#3988: OpenRouter account linking in the web tier (apps/server/proto/web/app.py, web/auth.py).

Offline, against a fake OpenRouter that behaves the way the issue requires: its authorize
step appends ONLY ``code`` to the ``callback_url`` it was given and drops every other
parameter, and its key exchange checks the PKCE verifier against the challenge it saw. A
fake that echoed ``state`` would pass these tests while a real link that did not echo it
failed with "state mismatch".

What the fake cannot prove is anything about OpenRouter itself: the first real link is a
manual step on compose (see the PR). That the stored value is ciphertext in Postgres is
``test_proto_openrouter_pg.py``'s; here the store is the route tests' ``FakeStore``.
"""

from __future__ import annotations

import base64
import functools
import hashlib
import json
import logging
import secrets
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit

import httpx
import pytest

from tests.test_proto_web import AUTH_ENV, PROTO, USER_A, USER_B, FakeQueue, FakeStore, create_app, make_client

sys.path.insert(0, str(PROTO))

from web import auth  # noqa: E402

KEY = "sk-or-v1-" + "a1B2c3D4" * 8
# In the fake's error body: a failed exchange must never log it.
BODY_SECRET = "or-error-body-" + "Q" * 24


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    """The route tests' clean environment (dev-login on), with linking switched on."""
    for name in AUTH_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DEV_LOGIN", "true")
    monkeypatch.setenv("OPENROUTER_LINKING_ENABLED", "true")


class FakeOpenRouter:
    """openrouter.ai's two steps: ``authorize`` stands in for the browser's trip through
    /auth, ``handler`` for POST /api/v1/auth/keys."""

    def __init__(self, status: int = 200, key: str | None = KEY) -> None:
        self.status = status
        self.key = key
        self.challenges: dict[str, str] = {}  # code -> the S256 challenge /auth saw
        self.exchanges: list[dict] = []

    def authorize(self, location: str) -> str:
        """The callback URL OpenRouter sends the browser to: ``callback_url`` plus ``code``,
        and nothing else -- whatever other parameters /auth was given."""
        parts = urlsplit(location)
        assert f"{parts.scheme}://{parts.netloc}{parts.path}" == auth.OPENROUTER_AUTH_URL
        query = dict(parse_qsl(parts.query))
        assert query["code_challenge_method"] == "S256"
        code = "orcode-" + secrets.token_hex(8)
        self.challenges[code] = query["code_challenge"]
        callback = query["callback_url"]
        return callback + ("&" if "?" in callback else "?") + urlencode({"code": code})

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "POST" and str(request.url) == auth.OPENROUTER_KEYS_URL
        body = json.loads(request.content)
        self.exchanges.append(body)
        if self.status != 200:
            return httpx.Response(self.status, json={"error": {"message": BODY_SECRET}})
        challenge = self.challenges.pop(body.get("code"), None)
        computed = base64.urlsafe_b64encode(
            hashlib.sha256(str(body.get("code_verifier")).encode()).digest()
        ).rstrip(b"=").decode()
        if challenge is None or computed != challenge or body.get("code_challenge_method") != "S256":
            return httpx.Response(400, json={"error": {"message": "invalid code or verifier"}})
        return httpx.Response(200, json={"key": self.key, "user_id": "user_fake"})


@pytest.fixture
def openrouter(monkeypatch) -> FakeOpenRouter:
    fake = FakeOpenRouter()
    transport = httpx.MockTransport(fake.handler)
    monkeypatch.setattr(auth, "exchange_openrouter_code",
                        functools.partial(auth.exchange_openrouter_code, transport=transport))
    return fake


def local(url: str) -> str:
    """The path and query of a URL on this tier, for the test client."""
    parts = urlsplit(url)
    return parts.path + (f"?{parts.query}" if parts.query else "")


async def start_link(c: httpx.AsyncClient, fake: FakeOpenRouter, next_route: str | None = None) -> str:
    """GET /openrouter/link, then OpenRouter's redirect back: the callback path to request."""
    r = await c.get("/openrouter/link", params={"next": next_route} if next_route else None)
    assert r.status_code == 307, r.text
    assert auth.OR_OAUTH_COOKIE in r.cookies
    return local(fake.authorize(r.headers["location"]))


# Every /openrouter route. A literal, not read off the app, because the parametrized sweeps
# below are collected before the fixture turns the switch on;
# test_the_route_sweep_sees_every_openrouter_route checks it against the app.
ROUTES = [
    ("GET", "/openrouter"), ("GET", "/openrouter/callback"), ("GET", "/openrouter/link"),
    ("POST", "/openrouter/unlink"),
]


def openrouter_routes() -> list[tuple[str, str]]:
    pairs = []
    for route in create_app(FakeStore(), FakeQueue()).routes:
        path = getattr(route, "path", "")
        if path == "/openrouter" or path.startswith("/openrouter/"):
            pairs += [(m, path) for m in sorted(route.methods - {"HEAD"})]
    return sorted(pairs)


# ── the round trip ───────────────────────────────────────────────────────────────


async def test_a_link_stores_the_key_encrypted_and_reports_linked(openrouter):
    store = FakeStore()
    async with make_client(store, FakeQueue()) as c:
        assert (await c.get("/openrouter")).json() == {"linked": False}
        callback = await start_link(c, openrouter)
        r = await c.get(callback)
        status = await c.get("/openrouter")
    assert r.status_code == 307 and r.headers["location"] == auth.redirect_target(None), r.headers
    stored = store.openrouter_keys[USER_A.id]
    assert stored != KEY and KEY not in stored
    assert auth.decrypt(stored) == KEY
    assert status.json() == {"linked": True} and KEY not in status.text
    assert status.headers["cache-control"] == "private, no-store"
    assert len(openrouter.exchanges) == 1 and USER_B.id not in store.openrouter_keys


async def test_the_authorize_url_carries_the_state_inside_the_callback_url(openrouter):
    async with make_client(FakeStore(), FakeQueue()) as c:
        r = await c.get("/openrouter/link")
    query = dict(parse_qsl(urlsplit(r.headers["location"]).query))
    callback = urlsplit(query["callback_url"])
    assert callback.path == "/openrouter/callback"
    cookie = auth.read_openrouter_state_cookie(r.cookies[auth.OR_OAUTH_COOKIE])
    assert dict(parse_qsl(callback.query)) == {"state": cookie["state"]}
    assert cookie["uid"] == USER_A.id
    # Nowhere else: OpenRouter may not echo a separate one.
    assert "state" not in query and query["code_challenge_method"] == "S256"
    expected = base64.urlsafe_b64encode(hashlib.sha256(cookie["verifier"].encode()).digest()).rstrip(b"=").decode()
    assert query["code_challenge"] == expected


async def test_a_safe_next_route_is_where_the_callback_lands_and_an_unsafe_one_is_dropped(openrouter):
    async with make_client(FakeStore(), FakeQueue()) as c:
        r = await c.get(await start_link(c, openrouter, "#/openrouter"))
        assert r.headers["location"] == auth.redirect_target("#/openrouter")
        assert r.headers["location"].endswith("/#/openrouter")
        r = await c.get(await start_link(c, openrouter, "https://evil.example/"))
        assert r.headers["location"] == auth.redirect_target(None)


async def test_a_second_link_replaces_the_key(openrouter):
    store = FakeStore()
    async with make_client(store, FakeQueue()) as c:
        await c.get(await start_link(c, openrouter))
        openrouter.key = KEY + "-second"
        await c.get(await start_link(c, openrouter))
    assert auth.decrypt(store.openrouter_keys[USER_A.id]) == KEY + "-second"


# ── refusals: each writes nothing ────────────────────────────────────────────────


async def test_a_mismatched_state_is_refused_before_any_exchange(openrouter):
    store = FakeStore()
    async with make_client(store, FakeQueue()) as c:
        callback = await start_link(c, openrouter)
        parts = urlsplit(callback)
        query = dict(parse_qsl(parts.query))
        query["state"] = "not-the-state"
        r = await c.get(f"{parts.path}?{urlencode(query)}")
    assert r.status_code == 400 and "mismatch" in r.text
    assert store.openrouter_keys == {} and openrouter.exchanges == []


async def test_a_callback_with_no_state_or_no_code_is_refused(openrouter):
    store = FakeStore()
    async with make_client(store, FakeQueue()) as c:
        callback = await start_link(c, openrouter)
        query = dict(parse_qsl(urlsplit(callback).query))
        r1 = await c.get("/openrouter/callback", params={"code": query["code"]})
        callback = await start_link(c, openrouter)
        query = dict(parse_qsl(urlsplit(callback).query))
        r2 = await c.get("/openrouter/callback", params={"state": query["state"]})
    assert (r1.status_code, r2.status_code) == (400, 400)
    assert store.openrouter_keys == {} and openrouter.exchanges == []


async def test_a_missing_state_cookie_is_refused(openrouter):
    store = FakeStore()
    async with make_client(store, FakeQueue()) as c:
        callback = await start_link(c, openrouter)
    async with make_client(store, FakeQueue()) as fresh:  # signed in, but never started a link
        r = await fresh.get(callback)
    assert r.status_code == 400 and "Missing or invalid" in r.text
    assert store.openrouter_keys == {} and openrouter.exchanges == []


async def test_a_state_cookie_another_user_started_is_refused(openrouter):
    """A's cookie and A's callback URL, presented in B's session: B gets no key, and A's
    code is never exchanged."""
    store = FakeStore()
    async with make_client(store, FakeQueue()) as a:
        callback = await start_link(a, openrouter)
        cookie = a.cookies[auth.OR_OAUTH_COOKIE]
    async with make_client(store, FakeQueue(), user=USER_B.id) as b:
        b.cookies.set(auth.OR_OAUTH_COOKIE, cookie)
        r = await b.get(callback)
    assert r.status_code == 400 and "another account" in r.text
    assert store.openrouter_keys == {} and openrouter.exchanges == []


async def test_a_familysearch_state_cookie_does_not_validate_as_an_openrouter_one(openrouter):
    """Own name and own salt: the FamilySearch cookie's payload, signed under "fs-oauth",
    is refused even when presented under the OpenRouter cookie's name."""
    fs_cookie = auth.oauth_state_cookie("verifier", "s" * 22, None)
    assert auth.read_openrouter_state_cookie(fs_cookie) is None
    assert auth.OR_OAUTH_COOKIE != auth.FS_OAUTH_COOKIE
    store = FakeStore()
    async with make_client(store, FakeQueue()) as c:
        c.cookies.set(auth.OR_OAUTH_COOKIE, fs_cookie)
        r = await c.get("/openrouter/callback", params={"state": "s" * 22, "code": "x"})
    assert r.status_code == 400 and store.openrouter_keys == {} and openrouter.exchanges == []


async def test_the_state_cookie_is_single_use(openrouter):
    store = FakeStore()
    async with make_client(store, FakeQueue()) as c:
        callback = await start_link(c, openrouter)
        cookie = c.cookies[auth.OR_OAUTH_COOKIE]
        first = await c.get(callback)
        assert auth.OR_OAUTH_COOKIE not in c.cookies  # dropped by the callback
        await c.post("/openrouter/unlink")
        c.cookies.set(auth.OR_OAUTH_COOKIE, cookie)  # a replay of the old cookie
        replay = await c.get(callback)
    assert first.status_code == 307
    # The cookie still verifies, but its code was spent at OpenRouter: the exchange fails.
    assert replay.status_code == 502 and store.openrouter_keys == {}


@pytest.mark.parametrize("status", [400, 401, 403, 500])
async def test_a_failed_exchange_stores_nothing_and_logs_the_status_only(monkeypatch, caplog, status):
    fake = FakeOpenRouter(status=status)
    monkeypatch.setattr(auth, "exchange_openrouter_code", functools.partial(
        auth.exchange_openrouter_code, transport=httpx.MockTransport(fake.handler)))
    store = FakeStore()
    caplog.set_level(logging.DEBUG)
    async with make_client(store, FakeQueue()) as c:
        r = await c.get(await start_link(c, fake))
    assert r.status_code == 502 and store.openrouter_keys == {}
    assert f"status={status}" in caplog.text
    assert BODY_SECRET not in caplog.text and BODY_SECRET not in r.text


async def test_a_200_with_no_key_is_a_failed_exchange(monkeypatch):
    fake = FakeOpenRouter(key=None)
    monkeypatch.setattr(auth, "exchange_openrouter_code", functools.partial(
        auth.exchange_openrouter_code, transport=httpx.MockTransport(fake.handler)))
    store = FakeStore()
    async with make_client(store, FakeQueue()) as c:
        r = await c.get(await start_link(c, fake))
    assert r.status_code == 502 and store.openrouter_keys == {}


async def test_an_unreachable_openrouter_is_a_failed_exchange(monkeypatch, caplog):
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    monkeypatch.setattr(auth, "exchange_openrouter_code", functools.partial(
        auth.exchange_openrouter_code, transport=httpx.MockTransport(refuse)))
    store, fake = FakeStore(), FakeOpenRouter()
    async with make_client(store, FakeQueue()) as c:
        r = await c.get(await start_link(c, fake))
    assert r.status_code == 502 and store.openrouter_keys == {}
    assert "status=no_response" in caplog.text


# ── unlinking ────────────────────────────────────────────────────────────────────


async def test_unlink_clears_the_key_and_calls_nothing_at_openrouter(openrouter):
    store = FakeStore()
    async with make_client(store, FakeQueue()) as c:
        await c.get(await start_link(c, openrouter))
        exchanges = len(openrouter.exchanges)
        r = await c.post("/openrouter/unlink")
        status = await c.get("/openrouter")
    assert r.status_code == 200 and r.json() == {"linked": False}
    assert USER_A.id not in store.openrouter_keys and status.json() == {"linked": False}
    assert len(openrouter.exchanges) == exchanges


async def test_unlink_is_post_only(openrouter):
    store = FakeStore()
    store.openrouter_keys[USER_A.id] = auth.encrypt(KEY)
    async with make_client(store, FakeQueue()) as c:
        r = await c.get("/openrouter/unlink")
    assert r.status_code == 405 and USER_A.id in store.openrouter_keys


async def test_unlink_touches_only_the_callers_key():
    store = FakeStore()
    store.openrouter_keys[USER_B.id] = auth.encrypt(KEY)
    async with make_client(store, FakeQueue()) as c:  # USER_A
        await c.post("/openrouter/unlink")
    assert USER_B.id in store.openrouter_keys


# ── who may call: the switch, a blocked user, no session ─────────────────────────


def test_the_route_sweep_sees_every_openrouter_route():
    # A new route must be decided on (switch, session, blocked user), not missed.
    assert openrouter_routes() == ROUTES


@pytest.mark.parametrize(("method", "path"), ROUTES)
@pytest.mark.parametrize("setting", [None, "false", "FALSE"])
async def test_every_openrouter_route_is_404_with_the_switch_off(monkeypatch, method, path, setting):
    if setting is None:
        monkeypatch.delenv("OPENROUTER_LINKING_ENABLED")
    else:
        monkeypatch.setenv("OPENROUTER_LINKING_ENABLED", setting)
    store = FakeStore()
    for user in (USER_A.id, None):  # signed in or not: the same 404
        async with make_client(store, FakeQueue(), user=user) as c:
            r = await c.request(method, path)
            config = (await c.get("/auth/config")).json()
        assert r.status_code == 404, (user, r.text)
        assert config["openrouter"] is False


async def test_auth_config_says_openrouter_true_with_the_switch_on():
    async with make_client(FakeStore(), FakeQueue(), user=None) as c:
        assert (await c.get("/auth/config")).json()["openrouter"] is True


@pytest.mark.parametrize("bad", ["yes", "1", "on", "tru"])
def test_a_bad_switch_refuses_to_construct_and_to_start(monkeypatch, bad):
    monkeypatch.setenv("OPENROUTER_LINKING_ENABLED", bad)
    with pytest.raises(RuntimeError, match="OPENROUTER_LINKING_ENABLED"):
        create_app(FakeStore(), FakeQueue())
    with pytest.raises(RuntimeError, match="OPENROUTER_LINKING_ENABLED"):
        auth.preflight()


@pytest.mark.parametrize(("method", "path"), ROUTES)
async def test_a_blocked_user_is_refused_on_every_openrouter_route(method, path, openrouter):
    """Plan S2: a blocked user's cookie is refused on the OpenRouter routes."""
    store = FakeStore()
    store.openrouter_keys[USER_A.id] = auth.encrypt(KEY)
    async with make_client(store, FakeQueue()) as c:
        callback = await start_link(c, openrouter)  # a link started before the block
        store.block(USER_A.id)
        target = callback if path == "/openrouter/callback" else path
        r = await c.request(method, target)
    assert r.status_code == 403, r.text
    assert store.openrouter_keys[USER_A.id] and openrouter.exchanges == []  # the unlink did not run either


@pytest.mark.parametrize(("method", "path"), ROUTES)
async def test_every_openrouter_route_needs_a_session(method, path, openrouter):
    async with make_client(FakeStore(), FakeQueue(), user=None) as c:
        r = await c.request(method, path)
    assert r.status_code == 401
