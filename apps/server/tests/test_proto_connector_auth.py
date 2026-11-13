"""Claude's authorization server in the web tier (#3997, apps/server/proto/web/connector_auth.py).

Offline: a ``FakeStore`` and a fake FamilySearch, as test_proto_auth.py runs the plain
sign-in. The requests replay what Claude sent the probe in four live sign-ins (issue #3529,
item 6): one client id, one redirect, a 43-character state and S256 challenge, ``scope`` and
``resource`` on ``/authorize``, and a form with no ``Authorization`` or ``Origin`` header on
``/token``. test_proto_connector_auth_pg.py runs the same flow on Postgres and through the
real tool server.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import timedelta
from urllib.parse import parse_qs, urljoin, urlsplit

import httpx
import pytest

from tests.test_proto_auth import _fake_fs
from tests.test_proto_web import AUTH_ENV, FakeQueue, FakeStore, USER_A
from web import auth, connector_auth, pages
from web.app import create_app

# The default PUBLIC_URL: loopback http, which the SDK's issuer check and preflight both take.
ISSUER = auth.DEFAULT_PUBLIC_URL
CLIENT_ID = connector_auth.CLAUDE_CLIENT_ID
REDIRECT = connector_auth.CLAUDE_REDIRECT_URI
VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
STATE = "s" * 43
NEW_EMAIL = "new@example.org"
AUTHORIZE = {
    "response_type": "code", "client_id": CLIENT_ID, "redirect_uri": REDIRECT, "code_challenge": CHALLENGE,
    "code_challenge_method": "S256", "state": STATE, "scope": "genealogy", "resource": f"{ISSUER}/mcp",
}


@pytest.fixture(autouse=True)
def connector_on(monkeypatch):
    """A chat-off tier with FamilySearch sign-in and the authorization server on."""
    for name in AUTH_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", "k" * 32)
    monkeypatch.setenv("GENEALOGY_CHAT", "false")
    monkeypatch.setenv("OAUTH_ISSUER", ISSUER)
    return monkeypatch


def _store(*emails: str) -> FakeStore:
    store = FakeStore()
    store.allowed = {USER_A.email, NEW_EMAIL, *emails}
    return store


def _client(store: FakeStore, application=None) -> httpx.AsyncClient:
    """One browser: the client keeps the cookies each step sets."""
    application = application or create_app(store, FakeQueue())
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url=ISSUER)


async def _to_consent(c: httpx.AsyncClient, **over: str) -> str:
    """``/authorize`` -> the signed request the consent page's URL carries."""
    r = await c.get("/authorize", params={**AUTHORIZE, **over})
    assert r.status_code == 302, r.text
    # The tier makes a redirect to itself root-relative (U28), so resolve it as a browser does.
    location = urlsplit(urljoin(ISSUER, r.headers["location"]))
    assert f"{location.scheme}://{location.netloc}{location.path}" == f"{ISSUER}/connect"
    return parse_qs(location.query)["request"][0]


async def _agree(c: httpx.AsyncClient, signed: str, origin: str | None = ISSUER) -> httpx.Response:
    return await c.post("/connect", data={"request": signed}, headers={"Origin": origin} if origin else {})


async def _to_familysearch(c: httpx.AsyncClient, **over: str) -> str:
    """``/authorize`` and the consent click -> the state FamilySearch would send back."""
    r = await _agree(c, await _to_consent(c, **over))
    assert r.status_code == 303, r.text
    assert r.headers["location"].startswith(auth.FS_AUTHORIZE_URL)
    return parse_qs(urlsplit(r.headers["location"]).query)["state"][0]


async def _to_code(c: httpx.AsyncClient, **over: str) -> str:
    """The flow up to the client's redirect -> the authorization code."""
    fs_state = await _to_familysearch(c, **over)
    r = await c.get("/callback", params={"code": "fs-code", "state": fs_state})
    assert r.status_code == 302, r.text
    location = urlsplit(r.headers["location"])
    assert f"{location.scheme}://{location.netloc}{location.path}" == REDIRECT
    query = parse_qs(location.query)
    assert query["state"] == [over.get("state", STATE)], "the client's state comes back unchanged"
    return query["code"][0]


def _token_form(code: str, **over: str) -> dict[str, str]:
    return {"grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID, "code_verifier": VERIFIER,
            "redirect_uri": REDIRECT, "resource": f"{ISSUER}/mcp", **over}


async def _token(c: httpx.AsyncClient, code: str, **over: str) -> httpx.Response:
    return await c.post("/token", data=_token_form(code, **over))


# ── the whole flow ───────────────────────────────────────────────────────────────


async def test_the_flow_ends_with_one_token_stored_only_as_its_hash(connector_on):
    _fake_fs(connector_on, email=NEW_EMAIL, fs_id="NEW-1")
    store = _store()
    async with _client(store) as c:
        code = await _to_code(c)
        # Only the code's hash is stored.
        assert set(store.authorization_codes) == {connector_auth.sha256_hex(code)}
        assert code not in repr(store.authorization_codes)
        r = await _token(c, code)  # no Origin header: the code and the verifier authenticate it
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"access_token", "token_type", "expires_in", "scope"}, "no refresh token is issued"
    assert body["token_type"] == "Bearer" and body["scope"] == "genealogy"
    assert body["expires_in"] == connector_auth.TOKEN_LIFETIME_S == 30 * 24 * 60 * 60
    assert r.headers["cache-control"] == "no-store"
    token = body["access_token"]
    stored = store.connector_tokens[connector_auth.sha256_hex(token)]
    user = next(u for u in store.users.values() if u.email == NEW_EMAIL)
    assert stored["user_id"] == user.id and stored["client_id"] == CLIENT_ID
    assert stored["scopes"] == ["genealogy"] and stored["resource"] == f"{ISSUER}/mcp" and stored["ended_at"] is None
    assert stored["expires_at"] - store.now() > timedelta(days=29)
    assert store.authorization_codes == {}, "the code is deleted when it is exchanged"
    assert token not in repr(store.connector_tokens)
    assert user.id in store.terms_accepted, "the consent click records the terms"
    assert store.grants[user.id]["refresh_token_enc"] is None, "a chat-off tier stores no refresh token"


async def test_the_callback_redirect_keeps_the_code_out_of_caches_and_referers(connector_on):
    _fake_fs(connector_on)
    async with _client(_store()) as c:
        fs_state = await _to_familysearch(c)
        r = await c.get("/callback", params={"code": "fs-code", "state": fs_state})
    assert r.headers["cache-control"] == "no-store" and r.headers["referrer-policy"] == "no-referrer"
    assert auth.COOKIE_NAME in r.cookies, "the browser is signed in too, so the upload page's link works"


async def test_an_authorize_with_no_scope_gets_the_default(connector_on):
    _fake_fs(connector_on)
    store = _store()
    async with _client(store) as c:
        params = {k: v for k, v in AUTHORIZE.items() if k != "scope"}
        r = await c.get("/authorize", params=params)
        signed = parse_qs(urlsplit(r.headers["location"]).query)["request"][0]
        fs_state = parse_qs(urlsplit((await _agree(c, signed)).headers["location"]).query)["state"][0]
        r = await c.get("/callback", params={"code": "fs-code", "state": fs_state})
        code = parse_qs(urlsplit(r.headers["location"]).query)["code"][0]
        assert next(iter(store.authorization_codes.values()))["scopes"] == ["genealogy"]
        assert (await _token(c, code)).json()["scope"] == "genealogy"


# ── metadata and the allowlist ───────────────────────────────────────────────────


async def test_the_metadata_names_this_issuer_and_no_registration(connector_on):
    async with _client(_store()) as c:
        r = await c.get("/.well-known/oauth-authorization-server")
        assert r.status_code == 200
        assert r.json() == {
            "issuer": ISSUER,
            "authorization_endpoint": f"{ISSUER}/authorize",
            "token_endpoint": f"{ISSUER}/token",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none"],
            "scopes_supported": ["genealogy"],
            "client_id_metadata_document_supported": True,
        }
        # The routes themselves, not only the document: register() serves only the SDK routes in SDK_PATHS.
        for path in ("/register", "/revoke"):
            assert (await c.post(path, data={"x": "y"})).status_code == 404, path


async def test_only_the_sdk_routes_named_here_are_served(connector_on):
    application = create_app(_store(), FakeQueue())
    sdk = {r.path for r in application.router.routes if getattr(r, "path", "") in ("/authorize", "/token", "/register", "/revoke")}
    assert sdk == {"/authorize", "/token"}


@pytest.mark.parametrize("over", [
    {"client_id": "https://claude.ai/oauth/other-client"},
    {"client_id": "https://evil.example/oauth/mcp-oauth-client-metadata"},
    {"redirect_uri": "https://claude.ai/api/mcp/auth_callback/x"},
    {"redirect_uri": "https://evil.example/api/mcp/auth_callback"},
    {"redirect_uri": "https://claude.ai.evil.example/api/mcp/auth_callback"},
])
async def test_a_client_or_redirect_off_the_allowlist_is_refused_with_no_redirect(connector_on, over):
    async with _client(_store()) as c:
        r = await c.get("/authorize", params={**AUTHORIZE, **over})
    assert r.status_code == 400 and "location" not in r.headers
    assert r.json()["error"] == "invalid_request"


@pytest.mark.parametrize("over", [
    {"resource": "https://other.example/mcp"},
    {"code_challenge": "short"},
    {"code_challenge": CHALLENGE + "A"},
    {"state": "s" * 1025},
    {"scope": "genealogy admin"},
])
async def test_a_request_this_server_will_not_carry_goes_back_to_the_client_as_an_error(connector_on, over):
    async with _client(_store()) as c:
        r = await c.get("/authorize", params={**AUTHORIZE, **over})
    assert r.status_code == 302 and r.headers["location"].startswith(REDIRECT + "?")
    query = parse_qs(urlsplit(r.headers["location"]).query)
    assert query["error"][0] in ("invalid_request", "invalid_scope") and "code" not in query


# ── consent ──────────────────────────────────────────────────────────────────────


async def test_the_consent_page_names_the_client_warns_and_refuses_framing(connector_on):
    async with _client(_store()) as c:
        signed = await _to_consent(c)
        r = await c.get("/connect", params={"request": signed})
    assert r.status_code == 200
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["content-security-policy"] == "frame-ancestors 'none'"
    assert r.headers["cache-control"] == "no-store"
    # Exactly same-origin: under no-referrer a browser posts the form with `Origin: null`,
    # which the POST refuses, so nobody could connect.
    assert r.headers["referrer-policy"] == "same-origin"
    text = r.text
    assert "<strong>Claude</strong> (claude.ai)" in text and pages.CONNECTOR_NAME in text
    assert "Continue only if you just clicked Connect in Claude yourself." in text
    assert "access to your FamilySearch sign-in and to your projects here" in text
    assert 'href="terms"' in text and 'href="privacy"' in text
    assert "deleted when the beta ends" in text
    assert f'name="request" value="{signed}"' in text and 'action="connect"' in text
    # Both links answer on this tier (they exist only with the chat off, which preflight requires).
    async with _client(_store()) as c:
        assert (await c.get("/terms")).status_code == 200 and (await c.get("/privacy")).status_code == 200


@pytest.mark.parametrize("origin", [None, "null", "https://evil.example", ISSUER + ".evil.example", ISSUER + "/"])
async def test_a_consent_post_from_another_site_is_refused_and_writes_nothing(connector_on, origin):
    store = _store()
    async with _client(store) as c:
        r = await _agree(c, await _to_consent(c), origin=origin)
    assert r.status_code == 403 and "location" not in r.headers
    assert auth.FS_OAUTH_COOKIE not in r.cookies and store.signin_states == {}


async def test_a_tampered_or_expired_consent_request_is_refused_and_writes_nothing(connector_on):
    store = _store()
    async with _client(store) as c:
        signed = await _to_consent(c)
        flipped = signed[:8] + ("A" if signed[8] != "A" else "B") + signed[9:]  # one character of the payload
        for bad in (flipped, "", "not-a-token"):
            assert (await c.get("/connect", params={"request": bad})).status_code == 400
            assert (await _agree(c, bad)).status_code == 400
        assert (await c.get("/connect")).status_code == 400
        connector_on.setattr(connector_auth, "CONSENT_MAX_AGE_S", -1)  # every request is now too old
        assert (await c.get("/connect", params={"request": signed})).status_code == 400
        assert (await _agree(c, signed)).status_code == 400
    assert store.signin_states == {}


@pytest.mark.parametrize("clients", [
    {},  # the client is gone
    {CLIENT_ID: connector_auth._client(CLIENT_ID, "Claude", "https://claude.ai/api/mcp/moved")},  # its redirect changed
])
async def test_a_request_signed_before_the_allowlist_changed_is_refused(connector_on, clients):
    async with _client(_store()) as c:
        signed = await _to_consent(c)
        connector_on.setattr(connector_auth, "CLIENTS", clients)
        assert (await c.get("/connect", params={"request": signed})).status_code == 400
        assert (await _agree(c, signed)).status_code == 400


async def test_an_oversized_consent_body_is_refused(connector_on):
    """A valid request, padded past the bound: only the bound refuses it."""
    store = _store()
    headers = {"Origin": ISSUER, "Content-Type": "application/x-www-form-urlencoded"}
    async with _client(store) as c:
        signed = (await _to_consent(c)).encode()
        r = await c.post("/connect", content=b"request=" + signed + b"&pad=" + b"x" * connector_auth.CONSENT_BODY_MAX,
                         headers=headers)
        assert r.status_code == 400 and auth.FS_OAUTH_COOKIE not in r.cookies and store.signin_states == {}

        # No declared length at all (a chunked body): refused unread, however small.
        async def chunks():
            yield b"request=" + signed

        r = await c.post("/connect", content=chunks(), headers=headers)
        assert "content-length" not in r.request.headers
        assert r.status_code == 400 and store.signin_states == {}
        assert (await c.post("/connect", content=b"request=" + signed + b"&pad=x", headers=headers)).status_code == 303


@pytest.mark.parametrize("clients", [
    {},
    {CLIENT_ID: connector_auth._client(CLIENT_ID, "Claude", "https://claude.ai/api/mcp/moved")},
])
async def test_the_callback_refuses_a_request_the_allowlist_no_longer_admits(connector_on, clients):
    """The consent click was valid; the allowlist changed before FamilySearch sent the browser
    back. The callback re-checks the request its cookie carries, and spends nothing."""
    calls = _fake_fs(connector_on)
    store = _store()
    async with _client(store) as c:
        fs_state = await _to_familysearch(c)
        connector_on.setattr(connector_auth, "CLIENTS", clients)
        r = await c.get("/callback", params={"code": "fs-code", "state": fs_state})
    assert r.status_code == 400
    assert calls == [] and store.authorization_codes == {}


# ── the callback ─────────────────────────────────────────────────────────────────


async def test_a_replayed_callback_is_refused(connector_on):
    calls = _fake_fs(connector_on)
    store = _store()
    async with _client(store) as c:
        fs_state = await _to_familysearch(c)
        first = await c.get("/callback", params={"code": "fs-code", "state": fs_state})
        assert first.status_code == 302
        # The callback cleared the cookie; a replay with the same cookie is the attack.
        c.cookies.set(auth.FS_OAUTH_COOKIE, first.request.headers["cookie"].split(f"{auth.FS_OAUTH_COOKIE}=")[1].split(";")[0])
        again = await c.get("/callback", params={"code": "fs-code", "state": fs_state})
    assert again.status_code == 400 and "already used" in again.text
    assert len(calls) == 2 and len(store.authorization_codes) == 1, "the replay called nothing and minted nothing"


async def test_an_email_off_the_allowlist_is_refused_and_no_user_is_written(connector_on):
    _fake_fs(connector_on, email="stranger@example.org", fs_id="STR-1")
    store = _store()
    users = dict(store.users)
    async with _client(store) as c:
        fs_state = await _to_familysearch(c)
        r = await c.get("/callback", params={"code": "fs-code", "state": fs_state})
    assert r.status_code == 403 and "not on the allowlist" in r.text and "location" not in r.headers
    assert store.users == users and store.grants == {} and store.authorization_codes == {} and store.terms_accepted == {}


async def test_a_blocked_user_gets_no_code(connector_on):
    _fake_fs(connector_on)  # USER_A
    store = _store()
    store.users[USER_A.id] = store.users[USER_A.id].__class__(USER_A.id, USER_A.email, familysearch_id="MMMM-AAA")
    store.block(USER_A.id)
    async with _client(store) as c:
        fs_state = await _to_familysearch(c)
        r = await c.get("/callback", params={"code": "fs-code", "state": fs_state})
    assert r.status_code == 403 and "blocked" in r.text
    assert store.authorization_codes == {} and store.grants == {}


@pytest.mark.parametrize("case", ["missing", "mismatched", "used"])
async def test_a_bad_state_leaves_the_signin_budget_untouched(connector_on, case):
    connector_on.setenv("GENEALOGY_SIGNIN_CALLS_PER_MINUTE", "2")
    calls = _fake_fs(connector_on)
    store = _store()
    application = create_app(store, FakeQueue())
    async with _client(store, application) as c:
        fs_state = await _to_familysearch(c)
        if case == "missing":
            store.signin_states.clear()
        elif case == "used":
            await store.consume_signin_state(auth.state_sha256(fs_state))
        sent = "other-state" if case == "mismatched" else fs_state
        r = await c.get("/callback", params={"code": "fs-code", "state": sent})
    assert r.status_code == 400
    assert len(application.state.signin_budget._taken) == 0, "the budget was touched"
    assert calls == [] and store.authorization_codes == {}


async def test_a_cookie_that_claims_the_flow_without_a_valid_request_is_refused(connector_on):
    calls = _fake_fs(connector_on)
    store = _store()
    for connector, terms in (({"client_id": "https://evil.example/c"}, True), ("x", True), (None, True)):
        payload = {"verifier": "v", "state": "st", "connector": connector, "terms": terms}
        cookie = auth._state_cookie(auth.FS_OAUTH_SALT, payload, None)
        await store.create_signin_state(auth.state_sha256("st"))
        async with _client(store) as c:
            c.cookies.set(auth.FS_OAUTH_COOKIE, cookie)
            r = await c.get("/callback", params={"code": "fs-code", "state": "st"})
        assert r.status_code == 400, connector
    # A valid request whose cookie lacks the terms acceptance is refused too.
    async with _client(store) as c:
        signed = await _to_consent(c)
        pending = connector_auth.read_consent(signed)
        cookie = auth._state_cookie(auth.FS_OAUTH_SALT, {"verifier": "v", "state": "st", "connector": pending}, None)
        c.cookies.set(auth.FS_OAUTH_COOKIE, cookie)
        assert (await c.get("/callback", params={"code": "fs-code", "state": "st"})).status_code == 400
    assert calls == [] and store.authorization_codes == {}


# ── /token ───────────────────────────────────────────────────────────────────────


async def test_a_used_code_is_refused(connector_on):
    _fake_fs(connector_on)
    store = _store()
    async with _client(store) as c:
        code = await _to_code(c)
        assert (await _token(c, code)).status_code == 200
        again = await _token(c, code)
    assert again.status_code == 400 and again.json()["error"] == "invalid_grant"
    assert len(store.connector_tokens) == 1


async def test_an_expired_code_is_refused(connector_on):
    _fake_fs(connector_on)
    store = _store()
    async with _client(store) as c:
        code = await _to_code(c)
        real_now = store.now
        store.now = lambda: real_now() + timedelta(seconds=connector_auth.CODE_LIFETIME_S + 1)
        r = await _token(c, code)
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant" and store.connector_tokens == {}


@pytest.mark.parametrize("over, status, error", [
    ({"code_verifier": "w" * 64}, 400, "invalid_grant"),
    ({"redirect_uri": "https://claude.ai/api/mcp/other"}, 400, "invalid_request"),
    ({"code": "not-the-code"}, 400, "invalid_grant"),
    ({"client_id": "https://evil.example/client"}, 401, "unauthorized_client"),
])
async def test_a_token_request_that_does_not_match_its_code_gets_no_token(connector_on, over, status, error):
    _fake_fs(connector_on)
    store = _store()
    async with _client(store) as c:
        r = await c.post("/token", data={**_token_form(await _to_code(c)), **over})
    assert r.status_code == status and r.json()["error"] == error
    assert store.connector_tokens == {}


async def test_a_refresh_request_answers_invalid_grant(connector_on):
    """Claude kept the probe's refresh token for this URL after the connector was deleted,
    so the first request it sends may be a refresh, in the recorded shape. ``invalid_grant``
    is the answer that sends a client back to ``/authorize``."""
    async with _client(_store()) as c:
        r = await c.post("/token", data={"grant_type": "refresh_token", "refresh_token": "left-over",
                                         "client_id": CLIENT_ID, "resource": f"{ISSUER}/mcp"})
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"


# ── sign-out ─────────────────────────────────────────────────────────────────────


async def test_sign_out_ends_the_users_tokens_and_unexchanged_codes(connector_on):
    _fake_fs(connector_on)
    store = _store()
    async with _client(store) as c:
        token = (await _token(c, await _to_code(c))).json()["access_token"]
        second_code = await _to_code(c)  # minted, not yet exchanged
        assert (await c.post("/auth/logout")).status_code == 200
        r = await _token(c, second_code)
    assert store.connector_tokens[connector_auth.sha256_hex(token)]["ended_at"] is not None
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
    assert len(store.connector_tokens) == 1, "the code minted before sign-out became no token"


async def test_a_revoked_cookies_sign_out_ends_nothing(connector_on):
    _fake_fs(connector_on)
    store = _store()
    async with _client(store) as c:
        await _to_code(c)
        stale = c.cookies[auth.COOKIE_NAME]
        assert (await c.post("/auth/logout")).status_code == 200  # revokes `stale`
        token = (await _token(c, await _to_code(c))).json()["access_token"]  # a later connection
        c.cookies.set(auth.COOKIE_NAME, stale)
        assert (await c.post("/auth/logout")).status_code == 200
    assert store.connector_tokens[connector_auth.sha256_hex(token)]["ended_at"] is None


@pytest.mark.parametrize("chat", ["true", "false"])
async def test_with_no_issuer_sign_out_is_the_handoffs_and_a_revoked_cookie_still_revokes(connector_on, chat):
    """The skip above exists to protect connector tokens. A tier that serves no connector
    sign-in keeps the handoff's sign-out exactly: every valid cookie revokes, stale or not."""
    connector_on.delenv("OAUTH_ISSUER")
    connector_on.setenv("GENEALOGY_CHAT", chat)
    store = _store()
    revoked: list[str] = []
    real = store.revoke_sessions

    async def revoke_sessions(user_id: str) -> None:
        revoked.append(user_id)
        await real(user_id)

    store.revoke_sessions = revoke_sessions
    cookie = auth.session_cookie_value(USER_A.id, iat=1.0)  # minted long before any revoke
    async with _client(store) as c:
        for _ in range(2):
            c.cookies.set(auth.COOKIE_NAME, cookie)
            assert (await c.post("/auth/logout")).status_code == 200
    assert revoked == [USER_A.id, USER_A.id], "the second, already revoked, cookie revoked again"


# ── a plain browser sign-in with the chat off ────────────────────────────────────


async def _plain_sign_in(c: httpx.AsyncClient) -> httpx.Response:
    r = await c.get("/auth/familysearch/login")
    fs_state = parse_qs(urlsplit(r.headers["location"]).query)["state"][0]
    return await c.get("/callback", params={"code": "fs-code-2", "state": fs_state})


async def test_a_new_users_plain_sign_in_is_refused_and_writes_no_row(connector_on):
    _fake_fs(connector_on, email=NEW_EMAIL, fs_id="NEW-1")
    store = _store()
    users = dict(store.users)
    async with _client(store) as c:
        r = await _plain_sign_in(c)
    assert r.status_code == 403 and "no account here yet" in r.text and "connector in Claude" in r.text
    assert store.users == users and store.grants == {} and auth.COOKIE_NAME not in r.cookies


async def test_an_existing_users_plain_sign_in_replaces_the_familysearch_token_only(connector_on):
    _fake_fs(connector_on, access="access-1")
    store = _store()
    async with _client(store) as c:
        token = (await _token(c, await _to_code(c))).json()["access_token"]
        before = dict(store.connector_tokens[connector_auth.sha256_hex(token)])
        _fake_fs(connector_on, access="access-2")
        r = await _plain_sign_in(c)
        assert r.status_code in (302, 307) and urljoin(ISSUER, r.headers["location"]) == f"{ISSUER}/"
        home = await c.get("/")
    assert home.status_code == 200, "a chat-off sign-in ends on the landing, not a 404"
    assert auth.decrypt(store.grants[USER_A.id]["access_token_enc"]) == "access-2"
    assert store.connector_tokens[connector_auth.sha256_hex(token)] == before and len(store.connector_tokens) == 1


# ── the setting ──────────────────────────────────────────────────────────────────


async def test_with_no_issuer_none_of_the_routes_exist(connector_on):
    connector_on.delenv("OAUTH_ISSUER")
    application = create_app(_store(), FakeQueue())
    assert application.state.connector is None
    async with _client(_store(), application) as c:
        assert (await c.get("/.well-known/oauth-authorization-server")).status_code == 404
        assert (await c.get("/authorize", params=AUTHORIZE)).status_code == 404
        assert (await c.get("/connect")).status_code == 404
        assert (await c.post("/connect", data={"request": "x"}, headers={"Origin": ISSUER})).status_code == 404
        assert (await c.post("/token", data=_token_form("x"))).status_code == 404


async def test_with_no_issuer_a_new_identity_is_not_sent_to_a_connector_that_is_not_there(connector_on):
    """A chat-off tier creates no user outside the connector's consent, issuer or not; with
    none, the refusal does not point at a sign-in this server does not serve."""
    connector_on.delenv("OAUTH_ISSUER")
    _fake_fs(connector_on, email=NEW_EMAIL, fs_id="NEW-1")
    store = _store()
    users = dict(store.users)
    async with _client(store) as c:
        r = await _plain_sign_in(c)
    assert r.status_code == 403 and "not creating accounts" in r.text and "connector" not in r.text
    assert store.users == users


@pytest.mark.parametrize("env, why", [
    ({"OAUTH_ISSUER": ISSUER + "/"}, "must equal PUBLIC_URL"),
    ({"OAUTH_ISSUER": "https://other.example"}, "must equal PUBLIC_URL"),
    ({"PUBLIC_URL": "https://host.example/app", "OAUTH_ISSUER": "https://host.example/app"}, "must have no path"),
    ({"FAMILYSEARCH_WEB_ENABLED": "false"}, "FAMILYSEARCH_WEB_ENABLED must be on"),
    ({"GENEALOGY_CHAT": "true"}, "GENEALOGY_CHAT must be false"),
    ({"GENEALOGY_CHAT": ""}, "GENEALOGY_CHAT must be false"),
])
def test_a_misplaced_issuer_refuses_to_start(connector_on, env, why):
    for name, value in env.items():
        connector_on.setenv(name, value)
    with pytest.raises(RuntimeError, match=f"OAUTH_ISSUER.*{why}"):
        auth.preflight()
    with pytest.raises(RuntimeError, match=f"OAUTH_ISSUER.*{why}"):
        create_app(_store(), FakeQueue())


def test_an_https_issuer_equal_to_public_url_starts(connector_on):
    connector_on.setenv("PUBLIC_URL", "https://host.example")
    connector_on.setenv("OAUTH_ISSUER", "https://host.example")
    auth.preflight()
    application = create_app(_store(), FakeQueue())
    assert application.state.connector is connector_auth


def test_the_spa_reserves_the_connector_paths():
    from web import spa

    assert {"authorize", "token", "connect"} <= spa.RESERVED
