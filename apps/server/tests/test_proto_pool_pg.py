"""#3980: the web tier's optional query pool (``PG_POOL_MAX_SIZE``) against REAL Postgres.

Neon closes idle connections. The pool checks each connection as it hands it out, so one
the server closed is replaced, not handed to a query. The close is reproduced with
``pg_terminate_backend`` rather than by waiting for an idle timeout, and the test waits until
the backend has actually gone before it borrows again, never on a sleep.

Without the DSN the module skips -- except under ``CI``, where it fails, so the job cannot
pass by skipping. ``make proto-grants-test`` runs it against the compose Postgres.
"""

from __future__ import annotations

import asyncio
import sys
import time

import psycopg
import pytest
from psycopg_pool import AsyncConnectionPool, PoolTimeout

from tests._proto_pg import PROTO, database, require_base_dsn, sql
from tests.test_proto_pg_credentials_pg import fch, require_password_auth, scratch_role
from tests.test_proto_web import refused_pg  # noqa: F401  (a fixture)

sys.path.insert(0, str(PROTO))

import web.app as web_app  # noqa: E402
from web.app import PgStore  # noqa: E402

WAIT_S = 10.0


@pytest.fixture
def pg_dsn():
    with database(prefix="pool_") as dsn:
        yield dsn


async def backend_pid(store: PgStore) -> int:
    async with await store._connect() as conn:
        return (await (await conn.execute("SELECT pg_backend_pid() AS pid")).fetchone())["pid"]


async def terminate(dsn: str, pid: int) -> None:
    """End ``pid``'s backend, as Neon ends an idle one, and wait until it has gone."""
    assert (await asyncio.to_thread(sql, dsn, "SELECT pg_terminate_backend(%s)", (pid,)))[0][0]
    deadline = time.monotonic() + WAIT_S
    while (await asyncio.to_thread(sql, dsn, "SELECT count(*) FROM pg_stat_activity WHERE pid = %s", (pid,)))[0][0]:
        assert time.monotonic() < deadline, f"backend {pid} outlived pg_terminate_backend"
        await asyncio.sleep(0.05)


async def test_store_calls_reuse_one_pooled_connection(pg_dsn):
    store = PgStore(pg_dsn, pool_max_size=1)
    await store.open_pool()
    try:
        first = await backend_pid(store)
        await store.upsert_user("a@example.org", None)
        assert await backend_pid(store) == first, "a pool of one serves every call on one backend"
    finally:
        await store.close_pool()


async def test_a_connection_the_server_closed_is_replaced_on_hand_out(pg_dsn):
    store = PgStore(pg_dsn, pool_max_size=1)
    await store.open_pool()
    try:
        closed = await backend_pid(store)
        await terminate(pg_dsn, closed)
        user = await store.upsert_user("a@example.org", None)
        assert user.email == "a@example.org"
        assert await backend_pid(store) != closed
    finally:
        await store.close_pool()


async def test_connections_that_died_together_are_replaced_without_backoff(pg_dsn):
    """Neon suspends an idle compute and every pooled connection dies at once. The first call
    after that must skip the dead ones promptly, not sleep psycopg_pool's check backoff
    (1 s, 2 s, 4 s...) once per dead connection."""
    store = PgStore(pg_dsn, pool_max_size=3)
    await store.open_pool()
    try:
        async with await store._connect() as a, await store._connect() as b, await store._connect() as c:
            pids = [(await (await x.execute("SELECT pg_backend_pid() AS pid")).fetchone())["pid"] for x in (a, b, c)]
        assert len(set(pids)) == 3
        for pid in pids:
            await terminate(pg_dsn, pid)
        started = time.monotonic()
        await store.upsert_user("a@example.org", None)
        elapsed = time.monotonic() - started
        assert elapsed < 2.0, f"{elapsed:.1f}s: the dead connections were retried on a backoff"
        assert await backend_pid(store) not in pids
    finally:
        await store.close_pool()


async def test_a_borrow_cancelled_mid_check_gives_the_connection_back(pg_dsn, monkeypatch):
    """A client closing its SSE tab cancels a borrow, often during the check's round trip. The
    connection must go back to the pool: a pool of one that lost it would refuse every later
    query while readiness, on its own connection, still answers 200."""
    real = AsyncConnectionPool.check_connection
    checking = asyncio.Event()

    async def slow_check(conn) -> None:
        checking.set()
        await asyncio.sleep(WAIT_S)
        await real(conn)

    store = PgStore(pg_dsn, pool_max_size=1)
    await store.open_pool()
    try:
        await store.upsert_user("a@example.org", None)
        monkeypatch.setattr(AsyncConnectionPool, "check_connection", staticmethod(slow_check))
        call = asyncio.ensure_future(store.upsert_user("b@example.org", None))
        await asyncio.wait_for(checking.wait(), WAIT_S)
        call.cancel()
        with pytest.raises(asyncio.CancelledError):
            await call
        monkeypatch.setattr(AsyncConnectionPool, "check_connection", staticmethod(real))
        user = await asyncio.wait_for(store.upsert_user("c@example.org", None), WAIT_S)
        assert user.email == "c@example.org"
    finally:
        await store.close_pool()


async def test_without_the_check_the_closed_connection_reaches_the_query(pg_dsn, monkeypatch):
    """The control for the test above: the check is what replaces the connection."""
    async def no_check(conn) -> None:
        return None

    monkeypatch.setattr(AsyncConnectionPool, "check_connection", staticmethod(no_check))
    store = PgStore(pg_dsn, pool_max_size=1)
    await store.open_pool()
    try:
        await terminate(pg_dsn, await backend_pid(store))
        with pytest.raises(psycopg.OperationalError):
            await store.upsert_user("a@example.org", None)
    finally:
        await store.close_pool()


async def test_pooled_connections_follow_a_rotated_password():
    """U29 through the pool: the first DSN's password is wrong (rotated away), so the pooled
    connect re-reads SAS once and lands as the role. The pool's own conninfo is never used."""
    base = require_base_dsn()
    with scratch_role(base) as (role, password):
        require_password_auth(base, role)
        objects = [fch(base, role, "rotated-away"), fch(base, role, password)]
        fetched: list[int] = []

        def fetch(name: str) -> dict[str, str]:
            fetched.append(1)
            return objects[min(len(fetched), len(objects)) - 1]

        creds = web_app.PgCredentials(mode="sas", sas_object="fch-web", fetch=fetch, min_interval_s=0)
        store = PgStore(creds, pool_max_size=1)
        await store.open_pool()
        try:
            async with await store._connect() as conn:
                who = (await (await conn.execute("SELECT current_user AS u")).fetchone())["u"]
        finally:
            await store.close_pool()
    assert who == role and len(fetched) == 2


class SwappableCreds:
    """``PgCredentials``' surface with a DSN the test moves: a refused connect is not an
    authentication failure, so the real holder would never re-read it."""

    mode = "env"

    def __init__(self, dsn: str) -> None:
        self.current = dsn

    def cached(self) -> str:
        return self.current

    def dsn(self) -> str:
        return self.current

    def refresh_after(self, failed: str) -> None:
        return None


async def test_the_pool_recovers_after_postgres_returns(pg_dsn, refused_pg, monkeypatch):  # noqa: F811
    """A smoke test of the outage path, not a guard on ``reconnect_timeout``: with an outage
    this short the default would recover as fast. The bounds are shrunk to keep it quick."""
    monkeypatch.setattr(web_app, "POOL_TIMEOUT_S", 1.0)
    monkeypatch.setattr(web_app, "POOL_RECONNECT_TIMEOUT_S", 1.0)
    creds = SwappableCreds(refused_pg.dsn)
    store = PgStore(creds, pool_max_size=1)  # type: ignore[arg-type]
    await store.open_pool()
    try:
        with pytest.raises(PoolTimeout):
            await store.upsert_user("a@example.org", None)
        creds.current = pg_dsn
        started = time.monotonic()
        while True:
            try:
                await store.upsert_user("a@example.org", None)
                break
            except PoolTimeout:
                assert time.monotonic() - started < WAIT_S, "the pool never reconnected after Postgres returned"
        assert time.monotonic() - started < 1.0 + 1.0 + 3.0
    finally:
        await store.close_pool()
    assert sql(pg_dsn, "SELECT email FROM users") == [("a@example.org",)]

