"""``make malachi-check``'s signed-in tool calls (malachi's ``signed_in_check.py``) on a real
Postgres and the real tool server: the token it writes is one the door admits, the calls go
through the connector path, and nothing of the check is left behind.

Without ``PROTO_TEST_PG_DSN`` the module skips, except under ``CI``, where it fails.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

import pytest

from tests._proto_pg import PROTO, database, sql
from tests._proto_tools import spawn_tool_server

MALACHI = PROTO / "malachi"
sys.path.insert(0, str(PROTO))
sys.path.insert(0, str(MALACHI))

import signed_in_check  # noqa: E402
from web import auth, connector_auth  # noqa: E402
from web.app import PgStore  # noqa: E402

ISSUER = "http://127.0.0.1:8085"
ENC_KEY = "k" * 32
EMAIL = "checker@example.org"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", ENC_KEY)


@pytest.fixture
def pg_dsn():
    with database(prefix="msc_") as dsn:
        yield dsn


@pytest.fixture
def tools(pg_dsn, tmp_path):
    with spawn_tool_server(pg_dsn, tmp_path, env={"OAUTH_ISSUER": ISSUER, "FS_TOKEN_ENC_KEY": ENC_KEY}) as server:
        yield server


async def _user(dsn: str, email: str = EMAIL, *, signed_in: bool = True) -> str:
    """A user as the connector's consent leaves one, with a FamilySearch token on file."""
    store = PgStore(dsn)
    user = await store.upsert_user(email, "FS-" + email[:4], accept_terms=True)
    if signed_in:
        await store.store_grant(user.id, auth.encrypt("fs-access"), None, datetime.now(timezone.utc) + timedelta(hours=1))
    return user.id


def _check_tokens(dsn: str) -> list[tuple]:
    return sql(dsn, "SELECT user_id FROM connector_tokens WHERE client_id = %s", (signed_in_check.CLIENT_ID,))


async def test_the_calls_pass_through_the_real_door_and_leave_no_token(pg_dsn, tools):
    uid = await _user(pg_dsn)
    # Claude's own token for the same user is not the check's to touch.
    sql(pg_dsn, "INSERT INTO connector_tokens (token_sha256, user_id, client_id, scopes, expires_at) "
                "VALUES ('theirs', %s, 'claude', ARRAY['genealogy'], now() + interval '30 days')", (uid,))
    lines = await _run(pg_dsn, tools.url)
    assert [passed for passed, _ in lines] == [True, True], lines
    assert "project_list (0 projects)" in lines[0][1]
    assert "auth_status (FamilySearch session" in lines[1][1]
    assert _check_tokens(pg_dsn) == []
    assert sql(pg_dsn, "SELECT token_sha256 FROM connector_tokens") == [("theirs",)]


async def _run(dsn: str, url: str, email: str = EMAIL) -> list[tuple[bool, str]]:
    """``signed_in_check.run`` without its own event loop: mint, call, clear."""
    token = signed_in_check.mint(dsn, email)
    if token is None:
        return signed_in_check.run(dsn, url, email)
    try:
        # The token is in the table as its hash only, good for two minutes.
        rows = sql(dsn, "SELECT token_sha256, expires_at - now() <= interval '120 seconds', scopes FROM connector_tokens "
                        "WHERE client_id = %s", (signed_in_check.CLIENT_ID,))
        assert rows == [(connector_auth.sha256_hex(token), True, ["genealogy"])]
        return await signed_in_check.calls(url, token)
    finally:
        signed_in_check.clear(dsn)


def test_run_mints_calls_and_clears_in_one_go(pg_dsn, tools):
    """The entry point ``main`` uses, on its own event loop."""
    import asyncio

    asyncio.run(_user(pg_dsn))
    lines = signed_in_check.run(pg_dsn, tools.url, EMAIL)
    assert all(passed for passed, _ in lines) and len(lines) == 2, lines
    assert _check_tokens(pg_dsn) == []


async def test_an_email_with_no_user_fails_and_writes_nothing(pg_dsn, tools):
    lines = await _run(pg_dsn, tools.url, "nobody@example.org")
    assert lines == [(False, "signed in: no user nobody@example.org: they must connect from Claude once first")]
    assert sql(pg_dsn, "SELECT count(*) FROM connector_tokens") == [(0,)]


async def test_a_user_the_door_refuses_fails_the_check_and_leaves_no_token(pg_dsn, tools):
    """No FamilySearch token on file: the door's lookup finds no row, so it answers 401."""
    await _user(pg_dsn, signed_in=False)
    lines = await _run(pg_dsn, tools.url)
    assert len(lines) == 1 and lines[0][0] is False
    assert "the door refused the check's token" in lines[0][1] and "HTTP 401" in lines[0][1]
    assert _check_tokens(pg_dsn) == []


async def test_a_blocked_user_fails_the_check(pg_dsn, tools):
    uid = await _user(pg_dsn)
    sql(pg_dsn, "UPDATE users SET blocked_at = now() WHERE id = %s", (uid,))
    lines = await _run(pg_dsn, tools.url)
    assert [passed for passed, _ in lines] == [False], lines
    assert _check_tokens(pg_dsn) == []


async def test_a_token_an_interrupted_run_left_is_removed(pg_dsn, tools):
    uid = await _user(pg_dsn)
    sql(pg_dsn, "INSERT INTO connector_tokens (token_sha256, user_id, client_id, scopes, expires_at) "
                "VALUES ('stale', %s, %s, ARRAY['genealogy'], now() + interval '120 seconds')",
        (uid, signed_in_check.CLIENT_ID))
    token = signed_in_check.mint(pg_dsn, EMAIL)
    assert sql(pg_dsn, "SELECT token_sha256 FROM connector_tokens") == [(connector_auth.sha256_hex(token),)]
    signed_in_check.clear(pg_dsn)
    assert sql(pg_dsn, "SELECT count(*) FROM connector_tokens") == [(0,)]


async def test_a_server_that_is_not_there_fails_the_check(pg_dsn):
    await _user(pg_dsn)
    lines = await _run(pg_dsn, "http://127.0.0.1:9/mcp")
    assert [passed for passed, _ in lines] == [False], lines
    assert _check_tokens(pg_dsn) == []
