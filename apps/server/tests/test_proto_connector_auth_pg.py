"""Claude's authorization server (#3997) on REAL Postgres and through the REAL tool server.

test_proto_connector_auth.py drives the flow on a fake store. A fake proves nothing about
the SQL, the NOT NULL columns, a row lock or the door, so this file runs the same flow on
``PgStore`` and then spends the token at ``build/http.js``: the tier that issued it and the
tier that admits it are different programs in different languages, joined only by the
``connector_tokens`` table, the Fernet key and the issuer string.

Without the DSN the module skips -- except under ``CI``, where it fails, so the job cannot
pass by skipping. ``make proto-grants-test`` builds the engine and runs it against the
compose Postgres.
"""

from __future__ import annotations

import asyncio
import re
import sys
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from tests._proto_pg import PROTO, AsyncPausingConn, database, sql
from tests._proto_tools import ENGINE, call_tool, result_text, spawn_tool_server
from tests.test_proto_auth import _fake_fs
from tests.test_proto_connector_auth import (
    AUTHORIZE, CLIENT_ID, ISSUER, _agree, _plain_sign_in, _to_code, _token,
)
from tests.test_proto_web import AUTH_ENV, FakeQueue

sys.path.insert(0, str(PROTO))

from web import auth, connector_auth  # noqa: E402
from web.app import PgStore, create_app  # noqa: E402

WAIT_S = 10.0
EMAIL = "patron@example.org"
ENC_KEY = "k" * 32
DOOR_SOURCE = ENGINE / "src" / "store" / "pg-s3-project-store.ts"
PRM_URL = f"{ISSUER}/.well-known/oauth-protected-resource/mcp"


@pytest.fixture
def pg_dsn():
    with database(prefix="ca_") as dsn:
        sql(dsn, "INSERT INTO allowed_emails (email) VALUES (%s)", (EMAIL,))
        yield dsn


@pytest.fixture(autouse=True)
def connector_on(monkeypatch):
    for name in AUTH_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FAMILYSEARCH_WEB_ENABLED", "true")
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", ENC_KEY)
    monkeypatch.setenv("GENEALOGY_CHAT", "false")
    monkeypatch.setenv("OAUTH_ISSUER", ISSUER)
    return monkeypatch


@pytest.fixture
def tools(pg_dsn, tmp_path):
    """The tool server over the same database, with the web tier's issuer and Fernet key."""
    with spawn_tool_server(pg_dsn, tmp_path, env={"OAUTH_ISSUER": ISSUER, "FS_TOKEN_ENC_KEY": ENC_KEY}) as server:
        yield server


def _web(dsn: str) -> httpx.AsyncClient:
    application = create_app(PgStore(dsn), FakeQueue())
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url=ISSUER)


async def _connect(c: httpx.AsyncClient) -> str:
    r = await _token(c, await _to_code(c))
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _door(tools, token: str | None) -> httpx.Response:
    """One raw POST to the door, so a refusal's status and challenge can be read."""
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    async with httpx.AsyncClient(headers={**headers, **(_bearer(token) if token else {})}) as http:
        return await http.post(tools.url, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})


def _door_row(dsn: str, token: str) -> list[tuple]:
    """``lookupConnectorToken``'s own query, read from the engine's source so it cannot drift."""
    query = re.search(r"const CONNECTOR_DOOR_SQL = `([^`]*)`", DOOR_SOURCE.read_text(encoding="utf-8")).group(1)
    return sql(dsn, query.replace("$1", "%s"), (connector_auth.sha256_hex(token),))


# ── the flow, then the door ──────────────────────────────────────────────────────


async def test_a_token_from_the_flow_calls_a_tool_through_the_real_door(pg_dsn, tools, connector_on):
    _fake_fs(connector_on, email=EMAIL, fs_id="PAT-1")
    async with _web(pg_dsn) as c:
        token = await _connect(c)
    result = await call_tool(tools, _bearer(token), "project_list", {})
    assert not result.isError, result_text(result)
    assert "proj_" in result_text(result), "the door bound the caller and listed a fresh project path"
    # Only hashes at rest, and the terms recorded with the user the flow created.
    stored = sql(pg_dsn, "SELECT token_sha256, client_id, scopes, resource, ended_at IS NULL, "
                         "expires_at - now() > interval '29 days' FROM connector_tokens")
    assert stored == [(connector_auth.sha256_hex(token), CLIENT_ID, ["genealogy"], f"{ISSUER}/mcp", True, True)]
    assert sql(pg_dsn, "SELECT count(*) FROM authorization_codes") == [(0,)]
    assert sql(pg_dsn, "SELECT email, familysearch_id, terms_accepted_at IS NOT NULL FROM users") == \
        [(EMAIL, "PAT-1", True)]
    dump = repr(sql(pg_dsn, "SELECT * FROM connector_tokens")) + repr(sql(pg_dsn, "SELECT * FROM familysearch_tokens"))
    assert token not in dump and "access-1" not in dump


async def test_both_tiers_print_one_issuer_and_one_scope(pg_dsn, tools):
    async with _web(pg_dsn) as c:
        web = (await c.get("/.well-known/oauth-authorization-server")).json()
    async with httpx.AsyncClient() as http:
        door = (await http.get(tools.url.removesuffix("/mcp") + "/.well-known/oauth-protected-resource/mcp")).json()
    # Byte for byte: a client compares the issuer it discovered at the door with the one
    # the authorization server prints (RFC 8414 3.3), and the SDK's own metadata route,
    # which this tier does not serve, would print it with a trailing slash.
    assert web["issuer"] == door["authorization_servers"][0] == ISSUER
    assert web["authorization_endpoint"] == f"{ISSUER}/authorize" and web["token_endpoint"] == f"{ISSUER}/token"
    assert web["scopes_supported"] == door["scopes_supported"] == [connector_auth.SCOPE]
    assert door["resource"] == f"{ISSUER}{connector_auth.MCP_PATH}"


async def test_the_door_tells_a_dead_token_from_no_token(pg_dsn, tools):
    none = await _door(tools, None)
    assert none.status_code == 401
    assert none.headers["www-authenticate"] == f'Bearer resource_metadata="{PRM_URL}", scope="genealogy"'
    dead = await _door(tools, "never-issued")
    assert dead.status_code == 401
    assert dead.headers["www-authenticate"] == \
        f'Bearer error="invalid_token", resource_metadata="{PRM_URL}", scope="genealogy"'


async def test_sign_out_gets_the_token_a_401_from_the_door(pg_dsn, tools, connector_on):
    _fake_fs(connector_on, email=EMAIL)
    async with _web(pg_dsn) as c:
        token = await _connect(c)
        assert (await _door(tools, token)).status_code == 200
        assert (await c.post("/auth/logout")).status_code == 200
    refused = await _door(tools, token)
    assert refused.status_code == 401 and 'error="invalid_token"' in refused.headers["www-authenticate"]
    assert sql(pg_dsn, "SELECT ended_at IS NOT NULL FROM connector_tokens") == [(True,)]


async def test_sign_out_deletes_a_code_not_yet_exchanged(pg_dsn, connector_on):
    _fake_fs(connector_on, email=EMAIL)
    async with _web(pg_dsn) as c:
        code = await _to_code(c)
        assert (await c.post("/auth/logout")).status_code == 200
        r = await _token(c, code)
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
    assert sql(pg_dsn, "SELECT count(*) FROM connector_tokens") == [(0,)]


async def test_a_plain_sign_in_replaces_the_familysearch_token_the_door_reads(pg_dsn, tools, connector_on):
    _fake_fs(connector_on, email=EMAIL, access="access-1")
    async with _web(pg_dsn) as c:
        token = await _connect(c)
        before = sql(pg_dsn, "SELECT * FROM connector_tokens")
        (first,) = _door_row(pg_dsn, token)
        assert auth.decrypt(first[2]) == "access-1"
        _fake_fs(connector_on, email=EMAIL, access="access-2")
        assert (await _plain_sign_in(c)).status_code in (302, 307)
    (after,) = _door_row(pg_dsn, token)
    assert auth.decrypt(after[2]) == "access-2", "the same connector token now carries the new FamilySearch token"
    assert sql(pg_dsn, "SELECT * FROM connector_tokens") == before
    result = await call_tool(tools, _bearer(token), "project_list", {})
    assert not result.isError, result_text(result)


async def test_an_authorize_with_no_scope_fits_the_not_null_columns(pg_dsn, connector_on):
    _fake_fs(connector_on, email=EMAIL)
    async with _web(pg_dsn) as c:
        r = await c.get("/authorize", params={k: v for k, v in AUTHORIZE.items() if k != "scope"})
        signed = parse_qs(urlsplit(r.headers["location"]).query)["request"][0]
        fs_state = parse_qs(urlsplit((await _agree(c, signed)).headers["location"]).query)["state"][0]
        r = await c.get("/callback", params={"code": "fs-code", "state": fs_state})
        assert r.status_code == 302, r.text
        code = parse_qs(urlsplit(r.headers["location"]).query)["code"][0]
        assert sql(pg_dsn, "SELECT scopes FROM authorization_codes") == [(["genealogy"],)]
        # Only the code's hash is at rest.
        assert sql(pg_dsn, "SELECT code_sha256 FROM authorization_codes") == [(connector_auth.sha256_hex(code),)]
        assert (await _token(c, code)).status_code == 200
    assert sql(pg_dsn, "SELECT scopes FROM connector_tokens") == [(["genealogy"],)]


# ── the store ────────────────────────────────────────────────────────────────────


def _pending() -> dict:
    return {"client_id": CLIENT_ID, "redirect_uri": connector_auth.CLAUDE_REDIRECT_URI,
            "redirect_uri_provided_explicitly": True, "code_challenge": "c" * 43, "scopes": ["genealogy"],
            "state": "s", "resource": f"{ISSUER}/mcp"}


def _user(dsn: str) -> str:
    sql(dsn, "INSERT INTO users (id, email) VALUES ('usr_1', %s)", (EMAIL,))
    return "usr_1"


async def _blocked(dsn: str, other: asyncio.Future) -> None:
    """Until ``other`` has finished or a backend waits on a lock; fail at the deadline."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + WAIT_S
    waiting = ("SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid "
               "WHERE NOT l.granted AND a.datname = current_database()")
    while loop.time() < deadline:
        if other.done() or (await asyncio.to_thread(sql, dsn, waiting))[0][0]:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("the second exchange neither finished nor waited on a lock")


async def test_two_exchanges_of_one_code_yield_exactly_one_token(pg_dsn):
    """A has deleted the code's row and is about to insert its token; B exchanges the same
    code. B's DELETE waits on A's row lock and, once A commits, finds no row. An exchange
    written as select, insert, delete would let B through while A is paused: two tokens."""
    store = PgStore(pg_dsn)
    await store.issue_authorization_code("code-hash", _user(pg_dsn), _pending(), 120)
    deleted, go = asyncio.Event(), asyncio.Event()

    async def pause():
        deleted.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    held = PgStore(pg_dsn)
    real = held._connect

    async def connect():
        return AsyncPausingConn(await real(), "INSERT INTO connector_tokens", pause)

    held._connect = connect  # type: ignore[method-assign]
    a_side = asyncio.ensure_future(held.exchange_authorization_code("code-hash", "token-a", 60))
    try:
        await asyncio.wait_for(deleted.wait(), WAIT_S)
        b_side = asyncio.ensure_future(store.exchange_authorization_code("code-hash", "token-b", 60))
        await _blocked(pg_dsn, b_side)
    finally:
        go.set()
    assert await asyncio.gather(a_side, b_side) == [True, False]
    assert sql(pg_dsn, "SELECT token_sha256 FROM connector_tokens") == [("token-a",)]
    assert sql(pg_dsn, "SELECT count(*) FROM authorization_codes") == [(0,)]


async def test_an_expired_code_neither_loads_nor_exchanges_by_postgres_clock(pg_dsn):
    store = PgStore(pg_dsn)
    user = _user(pg_dsn)
    await store.issue_authorization_code("old", user, _pending(), 120)
    sql(pg_dsn, "UPDATE authorization_codes SET expires_at = now() - interval '1 second'")
    assert await store.load_authorization_code("old") is None
    assert await store.exchange_authorization_code("old", "token", 60) is False
    assert sql(pg_dsn, "SELECT count(*) FROM connector_tokens") == [(0,)]
    # The next issue sweeps it, so the table holds about two minutes of sign-ins.
    await store.issue_authorization_code("new", user, _pending(), 120)
    assert sql(pg_dsn, "SELECT code_sha256 FROM authorization_codes") == [("new",)]


async def test_the_terms_are_recorded_once_with_the_user_and_never_for_a_blocked_one(pg_dsn):
    """In the transaction that creates the user, so no user the consent created exists
    without them; a plain sign-in records nothing."""
    store = PgStore(pg_dsn)
    created = await store.upsert_user(EMAIL, "PAT-1", accept_terms=True)
    (first,) = sql(pg_dsn, "SELECT terms_accepted_at FROM users")
    assert first[0] is not None
    assert (await store.upsert_user(EMAIL, "PAT-1", accept_terms=True)).id == created.id
    assert sql(pg_dsn, "SELECT terms_accepted_at FROM users") == [first]
    plain = await store.upsert_user("other@example.org", "OTH-1")
    assert sql(pg_dsn, "SELECT terms_accepted_at FROM users WHERE id = %s", (plain.id,)) == [(None,)]
    sql(pg_dsn, "UPDATE users SET blocked_at = now() WHERE id = %s", (plain.id,))
    await store.upsert_user("other@example.org", "OTH-1", accept_terms=True)
    assert sql(pg_dsn, "SELECT terms_accepted_at FROM users WHERE id = %s", (plain.id,)) == [(None,)]


async def test_a_sign_out_that_overlaps_an_exchange_leaves_no_live_token(pg_dsn):
    """Sign-out has stamped the user and is about to delete their codes; an exchange of one
    of those codes runs to completion in the gap. The token it minted must be ended when the
    sign-out finishes. With the tokens ended before the codes are deleted, it stays live."""
    store = PgStore(pg_dsn)
    user = _user(pg_dsn)
    await store.issue_authorization_code("code-hash", user, _pending(), 120)
    paused, go = asyncio.Event(), asyncio.Event()

    async def pause():
        paused.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    signing_out = PgStore(pg_dsn)
    real = signing_out._connect

    async def connect():
        return AsyncPausingConn(await real(), "DELETE FROM authorization_codes", pause)

    signing_out._connect = connect  # type: ignore[method-assign]
    sign_out = asyncio.ensure_future(signing_out.revoke_sessions(user))
    try:
        await asyncio.wait_for(paused.wait(), WAIT_S)
        assert await store.exchange_authorization_code("code-hash", "token", 60) is True
    finally:
        go.set()
    await sign_out
    assert sql(pg_dsn, "SELECT token_sha256, ended_at IS NOT NULL FROM connector_tokens") == [("token", True)]


async def test_a_new_identity_with_create_off_is_refused_and_writes_no_row(pg_dsn):
    from web.app import NoAccount

    store = PgStore(pg_dsn)
    with pytest.raises(NoAccount):
        await store.upsert_user("stranger@example.org", "STR-1", create=False)
    assert sql(pg_dsn, "SELECT count(*) FROM users") == [(0,)]
    created = await store.upsert_user("stranger@example.org", "STR-1", create=True)
    assert (await store.upsert_user("stranger@example.org", "STR-1", create=False)).id == created.id
