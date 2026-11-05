"""#3988: the OpenRouter key against REAL Postgres (``users.openrouter_key_enc``, 016).

A ``FakeStore`` proves only what the route passed it. This drives the real routes over a
real ``PgStore`` and reads the column back with plain SQL: it holds ciphertext, not the
key, ``auth.decrypt`` returns the key, and an unlink sets it to NULL. OpenRouter itself is
the fake in ``test_proto_openrouter.py``.

Without the DSN the module skips -- except under ``CI``, where it fails, so the job cannot
pass by skipping. ``make proto-grants-test`` runs it against the compose Postgres.
"""

from __future__ import annotations

import functools
import sys

import httpx
import pytest

from tests._proto_pg import PROTO, database, sql
from tests.test_proto_openrouter import KEY, FakeOpenRouter, _env, start_link  # noqa: F401  (_env is autouse)
from tests.test_proto_web import USER_A, USER_B, FakeQueue, make_client

sys.path.insert(0, str(PROTO))

from web import auth  # noqa: E402
from web.app import PgStore  # noqa: E402


@pytest.fixture
def pg_dsn():
    with database(prefix="or_") as dsn:
        for user in (USER_A, USER_B):
            sql(dsn, "INSERT INTO users (id, email) VALUES (%s, %s)", (user.id, user.email))
        yield dsn


@pytest.fixture
def openrouter(monkeypatch) -> FakeOpenRouter:
    fake = FakeOpenRouter()
    monkeypatch.setattr(auth, "exchange_openrouter_code", functools.partial(
        auth.exchange_openrouter_code, transport=httpx.MockTransport(fake.handler)))
    return fake


def stored(dsn: str, user_id: str) -> str | None:
    return sql(dsn, "SELECT openrouter_key_enc FROM users WHERE id = %s", (user_id,))[0][0]


async def test_the_column_holds_ciphertext_that_decrypts_to_the_key(pg_dsn, openrouter):
    async with make_client(PgStore(pg_dsn), FakeQueue()) as c:
        assert (await c.get("/openrouter")).json() == {"linked": False}
        r = await c.get(await start_link(c, openrouter))
        status = (await c.get("/openrouter")).json()
    assert r.status_code == 307, r.text
    value = stored(pg_dsn, USER_A.id)
    assert value is not None and value != KEY and KEY not in value
    assert auth.decrypt(value) == KEY
    assert status == {"linked": True}
    assert stored(pg_dsn, USER_B.id) is None


async def test_unlink_sets_the_column_to_null_and_leaves_other_users_alone(pg_dsn):
    sql(pg_dsn, "UPDATE users SET openrouter_key_enc = %s", (auth.encrypt(KEY),))
    async with make_client(PgStore(pg_dsn), FakeQueue()) as c:
        r = await c.post("/openrouter/unlink")
        status = (await c.get("/openrouter")).json()
    assert r.status_code == 200 and status == {"linked": False}
    assert stored(pg_dsn, USER_A.id) is None
    assert auth.decrypt(stored(pg_dsn, USER_B.id)) == KEY


async def test_a_refused_callback_writes_nothing(pg_dsn, openrouter):
    async with make_client(PgStore(pg_dsn), FakeQueue()) as c:
        callback = await start_link(c, openrouter)
        r = await c.get(callback.replace("state=", "state=x"))
    assert r.status_code == 400
    assert stored(pg_dsn, USER_A.id) is None
